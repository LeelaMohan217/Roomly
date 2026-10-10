import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { queryState } from '@/components/ui/query-state';
import { Segmented } from '@/components/ui/segmented';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { committed, rejected } from '@/lib/haptics';
import { exportPairStatement } from '@/lib/backup';
import { dayOf, formatRange, todayIso } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import {
  useBalances,
  usePairwiseLedger,
  usePendingSettlements,
  usePeriods,
} from '@/lib/queries';
import { useSession } from '@/lib/session';
import {
  assertPairwiseReconciles,
  pairRouting,
  splitPayment,
  type PairNet,
} from '@/lib/pairwise';
import { assertSettles, simplifyDebts, type Transfer } from '@/lib/settle';
import { supabase } from '@/lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Which side of a transfer you are on.
 *
 * 'owe'   — you are the payer. Recording it is a claim the payee confirms.
 * 'owed'  — you are the payee. Recording it IS the confirmation (0026), so it
 *           counts immediately and the wording has to make that obvious.
 * 'other' — neither, so you are the owner looking at somebody else's payment.
 *           Recording it still goes to the payee to confirm.
 */
type TransferKind = 'owe' | 'owed' | 'other';

/** Which of the three questions the screen is answering right now. */
type SettleView = 'owe' | 'owed' | 'plan';

export default function SettleScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();

  const balances = useBalances();
  const periods = usePeriods();
  const pending = usePendingSettlements();

  const [expanded, setExpanded] = useState<string | null>(null);
  // Fewest-payments cards whose routing breakdown is open. Separate from
  // `expanded` so opening one does not close a pair list on the other tabs.
  const [planOpen, setPlanOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [picked, setPicked] = useState<SettleView | null>(null);

  const scroller = useRef<ScrollView>(null);

  /**
   * Switching tab shows the top of the new tab.
   *
   * The three lists are different lengths, so changing tab while scrolled down
   * a long one can land you past the end of a short one -- blank space, which
   * reads as a tab that failed to load.
   */
  function show(next: SettleView) {
    setPicked(next);
    scroller.current?.scrollTo({ y: 0, animated: true });
  }

  const pairwise = usePairwiseLedger(member?.id);

  /**
   * The pairwise view is the THIRD view of the same money in this app, after
   * member_balances and the settle plan. Every consequential bug in this
   * project came from two such views drifting apart, so this one is checked
   * against the balance rather than trusted.
   */
  const pairs = useMemo(() => {
    const rows = pairwise.data?.pairs ?? [];
    const myBalance = balances.data?.find((b) => b.memberId === member?.id)?.balancePaise;
    if (rows.length === 0 || myBalance === undefined) return { rows, drift: null as string | null };
    try {
      assertPairwiseReconciles(rows, myBalance);
    } catch (e) {
      return { rows: [] as PairNet[], drift: humanError(e) };
    }
    return { rows, drift: null as string | null };
  }, [pairwise.data, balances.data, member?.id]);

  // Shown on the two pairwise tabs, because "48 things between you" turning
  // into "3 things" after a settle-up needs saying, not discovering.
  const squaredAt = pairwise.data?.squaredAt;
  const squaredOn = squaredAt ? formatRange(dayOf(squaredAt), dayOf(squaredAt)) : null;

  const owedToMe = pairs.rows.filter((p: PairNet) => p.netPaise > 0);
  const iOwe = pairs.rows.filter((p: PairNet) => p.netPaise < 0);

  /**
   * Money going OUT first, because it is the only one of the three that is a
   * task. Falls through to what you are owed, then to the plan.
   *
   * Derived rather than stored in state: the lists arrive asynchronously, so a
   * useState initialiser would always run against empty data and land on the
   * wrong tab. `picked` records a deliberate choice and wins from then on.
   */
  const auto: SettleView = iOwe.length > 0 ? 'owe' : owedToMe.length > 0 ? 'owed' : 'plan';
  const view = picked ?? auto;

  async function downloadPair(pair: PairNet) {
    setExporting(pair.memberId);
    setError(null);
    const result = await exportPairStatement(
      pair,
      member?.display_name ?? 'You',
      nameOf(pair.memberId)
    );
    setExporting(null);
    if (!result.ok) setError(result.reason);
  }

  const isOwner = member?.role === 'owner';
  const nameOf = (id: string) => balances.data?.find((b) => b.memberId === id)?.displayName ?? '—';

  // My position against one person, positive when they owe me. Used to work
  // out how much of a planned payment is really between the two of us.
  const netWith = (id: string) => pairs.rows.find((p) => p.memberId === id)?.netPaise ?? 0;

  // The plan is computed across the whole household -- it has to be, or the
  // transfers would not cancel out -- but a member only sees the rows they are
  // part of. The owner sees all of them, being the one who confirms them.
  const mine = (t: Transfer) => t.from === member?.id || t.to === member?.id;

  // Returns the plan AND any imbalance, rather than setting state from inside
  // the memo. Calling setError() during render is what the React Compiler
  // flagged as "may trigger an infinite loop": the state change re-renders,
  // the memo re-runs, and it sets state again.
  const { transfers, ledgerError } = useMemo(() => {
    if (!balances.data || balances.data.length === 0) {
      return { transfers: [] as Transfer[], ledgerError: null };
    }
    const plan = simplifyDebts(balances.data);
    try {
      // If this throws, the ledger itself is broken — not the plan.
      assertSettles(balances.data, plan);
    } catch (e) {
      return {
        transfers: [] as Transfer[],
        ledgerError: humanError(e),
      };
    }
    return { transfers: plan, ledgerError: null };
  }, [balances.data]);

  const visible = isOwner ? transfers : transfers.filter(mine);

  /**
   * Does the plan actually ask ME to pay anybody?
   *
   * Not the same question as "do I owe anyone", and this is the trap a plain
   * "Pay Madhav" button on the You owe tab would have fallen into. Pairwise
   * nets SUM to your balance (pairwise.ts:184) -- each one is not constrained
   * -- so you can owe Madhav while coming out ahead across everybody. When
   * that is true the plan has no payment for you at all, and simplification
   * settles the debt by paying you LESS rather than by you paying him.
   *
   * So the card only offers to take you to the plan when there is something
   * for you there, and says what is going on when there is not.
   */
  const iPayInPlan = transfers.some((t) => t.from === member?.id);

  // Already sent for approval, so it must not still offer to send it again.
  const awaitingFor = (t: Transfer) =>
    (pending.data ?? []).find((q) => q.fromMember === t.from && q.toMember === t.to);

  // The payee decides, because they are the one who can see the money arrive.
  // This used to be the owner's job, which asked the wrong person: an owner
  // confirming a transfer between two other people is vouching for something
  // they have no evidence about, while the payee -- who can just look at their
  // bank app -- had no say at all.
  //
  // The owner keeps the same power as an override, and is the only route for a
  // placeholder member, who has no account to confirm from.
  const toConfirm = (pending.data ?? []).filter((q) => q.toMember === member?.id);
  const watching = (pending.data ?? []).filter(
    (q) => q.toMember !== member?.id && (isOwner || q.fromMember === member?.id)
  );

  const markPaid = useMutation({
    mutationFn: async (t: Transfer) => {
      // Through an RPC rather than a direct insert, so the month's period row
      // exists before the RLS check reads it.
      const { error: rpcError } = await supabase.rpc('record_settlement', {
        p_from: t.from,
        p_to: t.to,
        p_amount: t.amountPaise,
        p_date: todayIso(),
        p_note: null,
      });
      if (rpcError) throw rpcError;
    },
    // Nothing used to clear this, so a refusal from one transfer stayed on
    // screen under the next one that succeeded -- which is how a single
    // failure came to look like "settle up is broken for everybody".
    onMutate: () => setError(null),
    onSuccess: () => {
      committed();
      setError(null);
      void queryClient.invalidateQueries();
    },
    onError: (e) => {
      rejected();
      setError(humanError(e));
    },
  });

  const review = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error: rpcError } = await supabase.rpc('review_settlement', {
        p_settlement: id,
        p_approve: approve,
        p_note: null,
      });
      if (rpcError) throw rpcError;
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      committed();
      setError(null);
      void queryClient.invalidateQueries();
    },
    onError: (e) => {
      rejected();
      setError(humanError(e));
    },
  });

  // Per-row, not per-screen. A single mutation flag made every button on the
  // list spin at once, so you could not tell which one you had tapped.
  const reviewing = (id: string) => review.isPending && review.variables?.id === id;
  const paying = (t: Transfer) =>
    markPaid.isPending && markPaid.variables?.from === t.from && markPaid.variables?.to === t.to;

  function confirmPaid(t: Transfer, kind: TransferKind) {
    // Whether this counts immediately turns on whether YOU were the one paid,
    // not on whether you are the owner. Recording money you received is its own
    // confirmation; recording money you sent is a claim the payee has to agree
    // to. The old copy promised "once the owner confirms", which is no longer
    // who gets asked.
    const body =
      `${nameOf(t.from)} paid ${nameOf(t.to)} ${formatPaise(t.amountPaise)}.\n\n` +
      'This only records it in the ledger — move the actual money on GPay separately.';

    const [title, note, action] =
      kind === 'owed'
        ? ['Did this land?', ' It counts straight away, because you are the one who was paid.', 'Yes, I got it']
        : kind === 'owe'
          ? [
              `Tell ${nameOf(t.to)} you paid?`,
              ` Balances change once ${nameOf(t.to)} confirms it arrived.`,
              'Send it',
            ]
          : [
              'Record this payment?',
              ` ${nameOf(t.to)} will be asked to confirm it arrived before balances move.`,
              'Record it',
            ];

    Alert.alert(title, body + note, [
      { text: 'Cancel', style: 'cancel' },
      { text: action, onPress: () => markPaid.mutate(t) },
    ]);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Settle up" />

      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {/* Money somebody says they sent you. Above the plan, because it is the
            only thing on this screen waiting on a person rather than on money.
            You are asked because you are the one who was paid — you can see it
            arrive; nobody else can. */}
        {toConfirm.length > 0 ? (
          <View style={styles.section}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              DID YOU GET THIS? ({toConfirm.length})
            </ThemedText>

            {toConfirm.map((q) => (
              <Card key={q.id} style={styles.transfer}>
                <View style={styles.transferHead}>
                  <View style={[styles.transferIcon, { backgroundColor: theme.warningSoft }]}>
                    <Ionicons name="hourglass-outline" size={16} color={theme.warning} />
                  </View>

                  <View style={styles.flex}>
                    <ThemedText style={Type.body} numberOfLines={1}>
                      {q.fromName} → {q.toName}
                    </ThemedText>
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      {q.recordedByName} recorded it · not counted until you confirm
                    </ThemedText>
                  </View>

                  <ThemedText style={styles.transferAmount}>
                    {formatPaise(q.amountPaise)}
                  </ThemedText>
                </View>

                <View style={styles.reviewRow}>
                  <Button
                    title="Not received"
                    variant="ghost"
                    style={styles.flex}
                    onPress={() => review.mutate({ id: q.id, approve: false })}
                    loading={reviewing(q.id)}
                  />
                  <Button
                    title="Got it"
                    style={styles.flex}
                    onPress={() => review.mutate({ id: q.id, approve: true })}
                    loading={reviewing(q.id)}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {/* Payments waiting on somebody else. Shown so a payer can see their
            entry did register, and so the owner can unstick one whose payee is
            a placeholder with no account to confirm from. */}
        {watching.length > 0 ? (
          <View style={styles.section}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              WAITING TO BE CONFIRMED ({watching.length})
            </ThemedText>

            {watching.map((q) => (
              <Card key={q.id} style={styles.transfer}>
                <View style={styles.transferHead}>
                  <View style={[styles.transferIcon, { backgroundColor: theme.backgroundSunken }]}>
                    <Ionicons name="hourglass-outline" size={16} color={theme.textTertiary} />
                  </View>

                  <View style={styles.flex}>
                    <ThemedText style={Type.body} numberOfLines={1}>
                      {q.fromName} → {q.toName}
                    </ThemedText>
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      Waiting on {q.toName} to confirm they got it
                    </ThemedText>
                  </View>

                  <ThemedText style={styles.transferAmount}>
                    {formatPaise(q.amountPaise)}
                  </ThemedText>
                </View>

                {isOwner ? (
                  <View style={styles.reviewRow}>
                    <Button
                      title="Reject"
                      variant="ghost"
                      style={styles.flex}
                      onPress={() => review.mutate({ id: q.id, approve: false })}
                      loading={reviewing(q.id)}
                    />
                    <Button
                      title="Confirm for them"
                      variant="ghost"
                      style={styles.flex}
                      onPress={() => review.mutate({ id: q.id, approve: true })}
                      loading={reviewing(q.id)}
                    />
                  </View>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}

        {pairs.drift ? (
          <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
            <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
              The itemised lists do not add up to your balance ({pairs.drift}). The plan below is
              still correct — please report this.
            </ThemedText>
          </View>
        ) : null}

        {/* "All square" told people their household was settled while the
            balances were still in flight — the headline is the loud part and
            it was the wrong part. A statement about money waits for the money
            to arrive. */}
        {queryState(balances, 'the balances', 'Working out who owes what…') ??
          (visible.length === 0 ? (
          <Card style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
              <Ionicons name="checkmark-done" size={22} color={theme.primary} />
            </View>
            <ThemedText style={Type.title}>All square</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
              Nobody owes anybody anything.
            </ThemedText>
          </Card>
        ) : (
          <>
            {/* One view at a time. All three stacked meant scrolling past two
                lists to reach the one you came for, and the two pairwise lists
                answer opposite questions — there is no reading of the screen
                where both are what you want at once. */}
            <Segmented
              options={[
                { value: 'owe', label: 'You owe', count: iOwe.length },
                { value: 'owed', label: 'Owed to you', count: owedToMe.length },
                // No count on this one. The other two are to-do counts —
                // people who owe you, people you owe — and this one would be a
                // transfer count, which the section heading below already
                // states. Dropping it also keeps the longest label on one line.
                { value: 'plan', label: 'Fewest payments' },
              ]}
              value={view}
              onChange={show}
            />

            {view === 'owed' ? (
              owedToMe.length > 0 ? (
                renderPairs('OWED TO YOU', owedToMe)
              ) : (
                <EmptyView icon="happy-outline" text="Nobody owes you anything right now." />
              )
            ) : null}

            {view === 'owe' ? (
              iOwe.length > 0 ? (
                renderPairs('YOU OWE', iOwe)
              ) : (
                <EmptyView icon="thumbs-up-outline" text="You don't owe anyone anything." />
              )
            ) : null}

            {view === 'plan' ? (
              <View style={styles.section}>
                <ThemedText themeColor="textTertiary" style={Type.label}>
                  {`SQUARE IT IN ${visible.length} PAYMENT${visible.length === 1 ? '' : 'S'}`}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  Fewer transfers than paying everyone directly — the totals are the same. Amounts
                  here will not match the other two tabs, because a payment can be routed through
                  somebody else.
                </ThemedText>
                {renderSection(visible)}
              </View>
            ) : null}
          </>
          ))}

        <Button
          title="Payment history"
          variant="secondary"
          onPress={() => router.push('/settlements')}
        />

        {(error ?? ledgerError) ? (
          <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
            <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
              {error ?? ledgerError}
            </ThemedText>
          </View>
        ) : null}

        {isOwner && periods.data && periods.data.length > 0 ? (
          <View style={styles.section}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              MONTHS
            </ThemedText>

            <Card padded={false}>
              {periods.data.map((p, i) => {
                const label = `${MONTHS[p.month - 1]} ${p.year}`;
                const closed = p.status === 'closed';

                return (
                  <Pressable
                    key={p.id}
                    onPress={() =>
                      router.push({
                        pathname: '/month-statement',
                        params: { year: String(p.year), month: String(p.month) },
                      })
                    }
                    style={({ pressed }) => [
                      styles.periodRow,
                      i < (periods.data?.length ?? 0) - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                      },
                      { opacity: pressed ? 0.6 : 1 },
                    ]}>
                    <View
                      style={[
                        styles.periodIcon,
                        {
                          backgroundColor: closed ? theme.backgroundSelected : theme.primarySoft,
                        },
                      ]}>
                      <Ionicons
                        name={closed ? 'lock-closed' : 'lock-open-outline'}
                        size={15}
                        color={closed ? theme.textTertiary : theme.primary}
                      />
                    </View>

                    <View style={styles.flex}>
                      <ThemedText style={Type.body}>{label}</ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {closed ? 'Closed — frozen' : 'Open'}
                      </ThemedText>
                    </View>

                    {/* Tapping opens the statement, where closing has the
                        context to be a considered decision rather than a
                        one-tap action next to a list. */}
                    <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
                  </Pressable>
                );
              })}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );

  /**
   * One card renderer, three framings. `kind` decides the wording and what
   * the button actually does — the old screen had a single button whose label
   * keyed off isOwner and so said "I have paid this" on money coming IN.
   */

  /**
   * A real relationship, with the expenses behind it.
   *
   * This is what replaced the old "Why this amount?" panel. That panel showed
   * four aggregate figures for the DEBTOR'S WHOLE POSITION -- so a card reading
   * "Vinod -> Lee Rs 52.99" concluded "Vinod owes overall Rs 107.00", two
   * different true numbers with nothing explaining the gap. It could also never
   * show WHICH six expenses, only that there were six.
   */
  function renderPairs(title: string, rows: PairNet[]) {
    if (rows.length === 0) return null;

    return (
      <View style={styles.section}>
        <ThemedText themeColor="textTertiary" style={Type.label}>
          {title}
        </ThemedText>
        {squaredOn ? (
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            {`Counting from ${squaredOn}, when everyone was last square.`}
          </ThemedText>
        ) : null}

        {rows.map((pair) => {
          const key = `pair-${pair.memberId}`;
          const isOpen = expanded === key;
          const them = nameOf(pair.memberId);
          const owesMe = pair.netPaise > 0;

          // Retroactive, and the reason this card is worth reading at all for
          // an already-settled pair: payments in the ledger get replayed to
          // work out how much of each one was only passing through. Nothing
          // was stored about this at the time (record_settlement keeps the
          // amount and nothing else), so it is reconstructed here.
          const notes = routingNotes(pair, them);

          return (
            <Card key={key} style={styles.transfer}>
              <View style={styles.transferHead}>
                <Avatar name={them} seed={pair.memberId} size={36} />

                <View style={styles.flex}>
                  <ThemedText style={Type.body} numberOfLines={1}>
                    {owesMe ? `${them} owes you` : `You owe ${them}`}
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.micro}>
                    {pair.lines.length} thing{pair.lines.length === 1 ? '' : 's'} between you
                  </ThemedText>
                </View>

                <ThemedText
                  style={[
                    styles.transferAmount,
                    { color: owesMe ? theme.primary : theme.negative },
                  ]}>
                  {formatPaise(Math.abs(pair.netPaise))}
                </ThemedText>
              </View>

              {/* The action, above the breakdown.
                  `auto` lands anybody who owes money on this tab by default,
                  and it had nothing to tap at all -- a screen called Settle up,
                  opened by the person who came to pay, offering only "View
                  all" and "Download".
                  It routes to the plan rather than recording the pairwise
                  amount directly. The plan is the app's answer to "who pays
                  whom": paying everyone individually is more transfers for the
                  same money, and a second payment path would need its own copy
                  of the netting arithmetic in SQL to guard the direction, which
                  is the drift migrations 0020 and 0024 both exist to undo. */}
              {notes.length > 0 ? (
                <View style={[styles.why, { backgroundColor: theme.backgroundSunken }]}>
                  {notes.map((note) => (
                    <ThemedText key={note} themeColor="textSecondary" style={Type.micro}>
                      {note}
                    </ThemedText>
                  ))}
                </View>
              ) : null}

              {!owesMe ? (
                iPayInPlan ? (
                  <>
                    <Button title="Settle this" onPress={() => show('plan')} />
                    <ThemedText
                      themeColor="textTertiary"
                      style={[Type.micro, styles.centered]}>
                      Opens the plan, which may route your payment through somebody else —
                      fewer transfers, same totals.
                    </ThemedText>
                  </>
                ) : (
                  <ThemedText themeColor="textTertiary" style={[Type.micro, styles.centered]}>
                    Across everybody you come out ahead, so the plan settles this by paying you
                    less rather than by you paying {them}.
                  </ThemedText>
                )
              ) : null}

              <Pressable onPress={() => setExpanded(isOpen ? null : key)} hitSlop={6}>
                <View style={styles.whyToggle}>
                  <ThemedText style={[Type.micro, { color: theme.primary, fontWeight: '700' }]}>
                    {isOpen ? 'Hide the list' : 'What is this made of?'}
                  </ThemedText>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={13}
                    color={theme.primary}
                  />
                </View>
              </Pressable>

              {isOpen ? (
                <View style={[styles.why, { backgroundColor: theme.backgroundSunken }]}>
                  {/* The three most recent, not all of them. A pair with forty
                      shared expenses turned one card into a screen of its own,
                      and the point of this list is "roughly why", not the
                      whole record — that is what the two buttons below are
                      for. Lines arrive newest first from pairwiseNets(). */}
                  {pair.lines.slice(0, 3).map((l) => (
                    <View key={`${l.kind}-${l.id}`} style={styles.lineRow}>
                      <View style={styles.flex}>
                        <ThemedText style={Type.caption} numberOfLines={1}>
                          {l.description || l.categoryName}
                        </ThemedText>
                        <ThemedText themeColor="textTertiary" style={Type.micro}>
                          {formatRange(l.date, l.date)} ·{' '}
                          {l.kind === 'settlement'
                            ? l.iPaid
                              ? 'you paid them'
                              : 'they paid you'
                            : `${l.iPaid ? 'you' : them} paid ${formatPaise(l.totalPaise)}`}
                        </ThemedText>
                      </View>
                      <ThemedText
                        style={[
                          Type.caption,
                          styles.semi,
                          { color: l.deltaPaise >= 0 ? theme.primary : theme.negative },
                        ]}>
                        {l.deltaPaise >= 0 ? '+' : '−'}
                        {formatPaise(Math.abs(l.deltaPaise))}
                      </ThemedText>
                    </View>
                  ))}

                  {pair.lines.length > 3 ? (
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      and {pair.lines.length - 3} more
                    </ThemedText>
                  ) : null}

                  <View style={[styles.whyTotal, { borderTopColor: theme.border }]}>
                    <ThemedText style={[Type.caption, styles.semi]}>
                      {owesMe ? `${them} owes you` : `You owe ${them}`}
                    </ThemedText>
                    <ThemedText style={[Type.caption, styles.semi]}>
                      {formatPaise(Math.abs(pair.netPaise))}
                    </ThemedText>
                  </View>

                  {/* Side by side, two short verbs, equal weight. "See all 5
                      things" read as a sentence rather than a button, and the
                      count is already on this card twice. */}
                  <View style={styles.pairActions}>
                    <Button
                      title="View all"
                      style={styles.flex}
                      // The object form rather than a template literal: it is
                      // expo-router's documented way to pass a dynamic segment,
                      // and it does not depend on how the typed-routes
                      // generator happens to have emitted this route.
                      onPress={() =>
                        router.push({ pathname: '/pair/[id]', params: { id: pair.memberId } })
                      }
                    />
                    <Button
                      title={exporting === pair.memberId ? 'Saving…' : 'Download'}
                      variant="secondary"
                      style={styles.flex}
                      loading={exporting === pair.memberId}
                      onPress={() => void downloadPair(pair)}
                    />
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>
    );
  }

  /**
   * The card's action: its words, its colour, and whether it still does
   * anything. One function, because these three have to agree — a button that
   * looks pressable and is not is worse than either.
   *
   * The reason this state is needed at all: recording a payment does NOT move a
   * balance until the payee confirms it arrived (0026), and the plan is built
   * from confirmed balances only. So the transfer stays on this list afterwards
   * with the SAME amount. With nothing on the card to say "already sent", the
   * only available conclusion is that the tap failed — so people tap again, and
   * the second entry is a real duplicate awaiting the same confirmation.
   */
  function planAction(t: Transfer, kind: TransferKind) {
    if (awaitingFor(t)) {
      return {
        // Greyed out and unpressable, saying who it is now waiting on. The
        // payee's version names the payer instead, because for them the next
        // move is theirs, at the top of this screen.
        title: kind === 'owed' ? `${nameOf(t.from)} says they paid` : `Waiting for ${nameOf(t.to)}`,
        variant: 'secondary' as const,
        disabled: true,
        note:
          kind === 'owed'
            ? 'Confirm it at the top of this screen once it lands.'
            : kind === 'owe'
              ? `Sent. Balances change once ${nameOf(t.to)} confirms it arrived.`
              : `Recorded. Balances change once ${nameOf(t.to)} confirms it arrived.`,
      };
    }

    return {
      title:
        kind === 'owed'
          ? 'Mark as received'
          : kind === 'owe'
            ? 'I have paid this'
            : 'Record this payment',
      // Filled green: this is the one thing to do on the card. It was the same
      // muted grey as the disabled state above, which left opacity as the only
      // difference between "do this" and "already done".
      variant: 'primary' as const,
      disabled: false,
      note: null as string | null,
    };
  }

  function renderSection(rows: Transfer[]) {
    if (rows.length === 0) return null;

    return (
      <>
          {rows.map((t) => {
              const key = `${t.from}-${t.to}`;
              const kind: TransferKind =
                t.to === member?.id ? 'owed' : t.from === member?.id ? 'owe' : 'other';
              const action = planAction(t, kind);

              /**
               * What this payment is actually made of.
               *
               * This card used to say only "Settles both of them", and that
               * omission is the whole reason this screen was rewritten:
               * simplifyDebts() plans from HOUSEHOLD balances, so the amount
               * it names is the payer's entire balance, not what they owe the
               * person it names. Madhav was asked for Rs 1,590.75 when he owed
               * Mani Rs 1,182.33 -- the other Rs 408.42 was his debt to Lee
               * and Vinod, routed through Mani. Neither of them was told, so
               * both had to reconstruct it by hand afterwards.
               *
               * Only computed for the two people in the transfer. An owner
               * looking at somebody else's row has no pairwise ledger for
               * them -- usePairwiseLedger is MY view of the world -- and a
               * guess would be worse than the silence.
               */
              const split =
                kind === 'owe'
                  ? splitPayment(-netWith(t.to), t.amountPaise)
                  : kind === 'owed'
                    ? splitPayment(netWith(t.from), t.amountPaise)
                    : null;

              const routed = split && split.routedPaise > 0 ? split : null;

              // Named only on the paying side. I know who I owe; I cannot know
              // who the payer owes when the money is coming to me.
              const onwards =
                kind === 'owe'
                  ? nameList(iOwe.filter((p) => p.memberId !== t.to).map((p) => nameOf(p.memberId)))
                  : 'somebody else';

              return (
                <Card key={key} style={styles.transfer}>
                  <View style={styles.transferHead}>
                    {/* One icon for the transaction, not two faces. Two
                        avatars plus an arrow read as a relationship between
                        people; the row is about a single payment, and the
                        names already say who is involved. */}
                    <View style={[styles.transferIcon, { backgroundColor: theme.primarySoft }]}>
                      <Ionicons name="arrow-forward" size={16} color={theme.primary} />
                    </View>

                    <View style={styles.flex}>
                      <ThemedText style={Type.body} numberOfLines={1}>
                        {nameOf(t.from)} → {nameOf(t.to)}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {routed ? 'Part of this is passing through' : 'Settles both of them'}
                      </ThemedText>
                    </View>

                    <ThemedText style={styles.transferAmount}>
                      {formatPaise(t.amountPaise)}
                    </ThemedText>
                  </View>

                  {/* Collapsed by default: the amount and the button are what
                      most people need, and three cards each carrying a
                      paragraph pushed the buttons off the screen. */}
                  {routed ? (
                    <Pressable
                      onPress={() => setPlanOpen(planOpen === key ? null : key)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: planOpen === key }}>
                      <View style={styles.whyToggle}>
                        <ThemedText style={[Type.micro, { color: theme.primary, fontWeight: '700' }]}>
                          {planOpen === key ? 'Hide details' : 'Show details'}
                        </ThemedText>
                        <Ionicons
                          name={planOpen === key ? 'chevron-up' : 'chevron-down'}
                          size={13}
                          color={theme.primary}
                        />
                      </View>
                    </Pressable>
                  ) : null}

                  {routed && planOpen === key ? (
                    <View style={[styles.why, { backgroundColor: theme.backgroundSunken }]}>
                      <View style={styles.whyRow}>
                        <ThemedText
                          themeColor="textSecondary"
                          style={[Type.micro, styles.flex]}
                          numberOfLines={2}>
                          {kind === 'owe'
                            ? `Clears what you owe ${nameOf(t.to)}`
                            : `Clears what ${nameOf(t.from)} owes you`}
                        </ThemedText>
                        <ThemedText style={[Type.micro, styles.semi]}>
                          {formatPaise(routed.directPaise)}
                        </ThemedText>
                      </View>

                      <View style={styles.whyRow}>
                        <ThemedText
                          themeColor="textSecondary"
                          style={[Type.micro, styles.flex]}
                          numberOfLines={2}>
                          {kind === 'owe'
                            ? `Routed through ${nameOf(t.to)} to ${onwards}`
                            : `Routed through you for ${onwards}`}
                        </ThemedText>
                        <ThemedText style={[Type.micro, styles.semi]}>
                          {formatPaise(routed.routedPaise)}
                        </ThemedText>
                      </View>

                      {/* The consequence, stated before it happens rather than
                          discovered on the other tab a week later. After this
                          lands the pair net is exactly the routed amount, in
                          the payer's favour -- so say so, by name. */}
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {kind === 'owe'
                          ? `Pay the full ${formatPaise(t.amountPaise)} — it is fewer transfers for the same money. Afterwards "Owed to you" will show ${nameOf(t.to)} owing you ${formatPaise(routed.routedPaise)} until ${onwards} settle up.`
                          : `Only ${formatPaise(routed.directPaise)} of this is yours. Afterwards "You owe" will show ${formatPaise(routed.routedPaise)} against ${nameOf(t.from)} until the rest of the plan goes through — it is money passing through you, not money you spent.`}
                      </ThemedText>
                    </View>
                  ) : null}

                  {/* Once it is sent there is nothing more for this person to
                      do, so the button becomes a status rather than inviting
                      them to record the same payment twice. It stays a BUTTON
                      -- greyed out, in the same place, with different words --
                      because a button that turns into a notice reads as the
                      button having disappeared. */}
                  <Button
                    title={action.title}
                    variant={action.variant}
                    disabled={action.disabled}
                    onPress={action.disabled ? undefined : () => confirmPaid(t, kind)}
                    loading={paying(t)}
                  />

                  {action.note ? (
                    <ThemedText
                      themeColor="textTertiary"
                      style={[Type.micro, styles.centered, styles.noteUnderButton]}>
                      {action.note}
                    </ThemedText>
                  ) : null}
                </Card>
              );
            })}
      </>
    );
  }
}

/** "Lee and Vinod", "Lee, Vinod and Madhav". Empty falls back to a pronoun. */
function nameList(names: string[]): string {
  if (names.length === 0) return 'somebody else';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Why a settled-looking pair is not at zero.
 *
 * The complaint this answers, in full: Mani opened "You owe" and found Rs
 * 408.42 against Madhav, who had just PAID him Rs 1,590.75 and was square with
 * the house. Nothing on the screen connected the two. The ledger was right --
 * Rs 408.42 of that payment was Madhav's debt to Lee and Vinod, routed through
 * Mani by the plan -- but the only way to learn that was to do the subtraction
 * by hand, which is exactly the work this app exists to remove.
 *
 * Written from the pair's own lines rather than the plan, so it keeps working
 * for payments made months ago and for a household that is otherwise settled.
 * Says nothing at all when nothing was routed, which is the ordinary case.
 */
function routingNotes(pair: PairNet, them: string): string[] {
  const routed = pairRouting(pair);
  const out: string[] = [];

  const paidTotal = (iPaid: boolean) =>
    pair.lines.reduce(
      (sum, l) => (l.kind === 'settlement' && l.iPaid === iPaid ? sum + l.totalPaise : sum),
      0
    );

  if (routed.receivedPaise > 0) {
    const total = paidTotal(false);
    out.push(
      `${them} has paid you ${formatPaise(total)}, but only ` +
        `${formatPaise(total - routed.receivedPaise)} of that was owed to you. The other ` +
        `${formatPaise(routed.receivedPaise)} came through you for somebody else, because the ` +
        `plan routes payments to whoever clears the house fastest — which is why this line ` +
        `shows you owing ${them}.`
    );
  }

  if (routed.sentPaise > 0) {
    const total = paidTotal(true);
    out.push(
      `You have paid ${them} ${formatPaise(total)}, and ${formatPaise(routed.sentPaise)} of ` +
        `that was never a debt between you two — it went through ${them} to somebody else you ` +
        `owed. You are not out of pocket for it.`
    );
  }

  return out;
}

function EmptyView({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const theme = useTheme();

  return (
    <Card style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
        <Ionicons name={icon} size={22} color={theme.primary} />
      </View>
      <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
        {text}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  semi: { fontWeight: '700' },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },

  section: { gap: Spacing.two },
  transfer: { gap: Spacing.three },
  transferHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  transferIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferAmount: { fontSize: 17, fontWeight: '700', letterSpacing: -0.4 },
  reviewRow: { flexDirection: 'row', gap: Spacing.two },
  // Card gap is Spacing.three, which reads as a separate block rather than a
  // caption belonging to the button above it.
  noteUnderButton: { marginTop: -Spacing.two },

  whyToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  why: { borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.two },
  whyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  // One expense in the "what is this made of" list.
  pairActions: { flexDirection: 'row', gap: Spacing.two },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  whyTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },

  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  periodIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.sm,
    padding: Spacing.two,
  },
});
