import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Reveal } from '@/components/ui/motion';
import { queryState } from '@/components/ui/query-state';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { committed, rejected } from '@/lib/haptics';
import { exportPairStatement } from '@/lib/backup';
import { dayOf, formatRange, todayIso } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import {
  canPayByUpi,
  listPayApps,
  openPayApp,
  type PayApp,
} from '@/lib/pay-apps';
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

/** Who you are square with, or how the house squares up. */
type SettleView = 'balances' | 'plan';

export default function SettleScreen() {
  const theme = useTheme();
  const dialog = useDialog();
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

  // The summary card's three figures. The overall one is the balance itself,
  // so it holds even when the pairwise lists are withheld for drift; the two
  // halves are those lists summed, and they add up to it by construction
  // (assertPairwiseReconciles above).
  const myBalance = balances.data?.find((b) => b.memberId === member?.id)?.balancePaise;
  const iOweTotal = iOwe.reduce((sum, p) => sum - p.netPaise, 0);
  const owedTotal = owedToMe.reduce((sum, p) => sum + p.netPaise, 0);

  /**
   * Balances when there are any, else the plan.
   *
   * Derived rather than stored in state: the lists arrive asynchronously, so a
   * useState initialiser would always run against empty data and land on the
   * wrong tab. `picked` records a deliberate choice and wins from then on.
   */
  const auto: SettleView = pairs.rows.length > 0 ? 'balances' : 'plan';
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

  async function confirmPaid(t: Transfer, kind: TransferKind) {
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

    // Green: recording money that moved is the good outcome, not a risk.
    const ok = await dialog.confirm({
      tone: 'success',
      icon: 'cash-outline',
      title,
      message: body + note,
      confirmLabel: action,
    });
    if (ok) markPaid.mutate(t);
  }

  /**
   * Pay: the phone's own UPI apps, one tap from the payment you owe.
   *
   * Roomly opens the app; who to pay and how much are entered inside it,
   * since Roomly keeps no UPI IDs. Whether the money moved cannot be
   * read back, so coming back to Roomly asks -- and a yes records it exactly
   * as "I have paid this" does, still for the payee to confirm.
   */
  const upi = canPayByUpi();
  const [payFor, setPayFor] = useState<Transfer | null>(null);
  const [payApps, setPayApps] = useState<PayApp[] | null>(null);
  // Set when an app is opened, cleared the moment Roomly is back in front.
  const awayFor = useRef<Transfer | null>(null);

  function startPay(t: Transfer) {
    setPayFor(t);
    setPayApps(null);
    void listPayApps().then(setPayApps);
  }

  function payWith(t: Transfer, app: PayApp) {
    setPayFor(null);
    awayFor.current = t;
    if (!openPayApp(app.packageName)) {
      awayFor.current = null;
      dialog.toast({ message: `Could not open ${app.label}` });
    }
  }

  async function askIfPaid(t: Transfer) {
    const ok = await dialog.confirm({
      tone: 'success',
      icon: 'cash-outline',
      title: `Did you pay ${nameOf(t.to)} ${formatPaise(t.amountPaise)}?`,
      message: `${nameOf(t.to)} will be asked to confirm it arrived.`,
      confirmLabel: 'Yes, I paid',
      cancelLabel: 'Not yet',
    });
    if (ok) markPaid.mutate(t);
  }

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !awayFor.current) return;
      const t = awayFor.current;
      awayFor.current = null;
      void askIfPaid(t);
    });
    return () => sub.remove();
  });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Settle up" />

      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {/* Where you stand overall, before anything else -- the answer the
            three tabs otherwise left you to add up. The same green card as
            Home's, so the two screens agree on what the headline is. */}
        {myBalance !== undefined ? (
          <View
            style={[
              styles.summary,
              { backgroundColor: theme.balanceCard, borderColor: theme.balanceEdge },
            ]}>
            <ThemedText style={[Type.caption, { color: theme.onBalanceMuted }]}>
              {myBalance > 0
                ? 'Overall, you get back'
                : myBalance < 0
                  ? 'Overall, you owe'
                  : 'You’re all square'}
            </ThemedText>
            <View style={styles.summaryAction}>
              <ThemedText
                style={[
                  styles.summaryValue,
                  styles.flex,
                  {
                    color:
                      myBalance > 0
                        ? theme.balancePositive
                        : myBalance < 0
                          ? theme.balanceNegative
                          : theme.onBalance,
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}>
                {formatPaise(Math.abs(myBalance))}
              </ThemedText>
              {/* The way to act, beside the amount it settles. Only when the
                  plan actually asks you to pay: pairwise nets SUM to your
                  balance, so you can owe one person and still have nothing to
                  pay, and then this would open a plan with nothing of yours. */}
              {view !== 'plan' && iPayInPlan ? (
                <PillButton title="Settle up" onTint onPress={() => show('plan')} />
              ) : null}
            </View>
            {/* Only with lists to sum: when they are withheld for drift, two
                zeros here would contradict the figure above. */}
            {pairs.rows.length > 0 ? (
              <View style={[styles.summarySplit, { borderTopColor: theme.balanceRule }]}>
                <View style={styles.flex}>
                  <ThemedText style={[Type.micro, { color: theme.onBalanceMuted }]}>You owe</ThemedText>
                  <ThemedText style={[styles.summaryPart, { color: theme.onBalance }]}>
                    {formatPaise(iOweTotal)}
                  </ThemedText>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: theme.balanceRule }]} />
                <View style={[styles.flex, styles.summaryRight]}>
                  <ThemedText style={[Type.micro, { color: theme.onBalanceMuted }]}>
                    Owed to you
                  </ThemedText>
                  <ThemedText style={[styles.summaryPart, { color: theme.onBalance }]}>
                    {formatPaise(owedTotal)}
                  </ThemedText>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Money somebody says they sent you. Above the plan, because it is the
            only thing on this screen waiting on a person rather than on money.
            You are asked because you are the one who was paid — you can see it
            arrive; nobody else can. */}
        {toConfirm.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle title={`Did you get this? (${toConfirm.length})`} />

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
                      Recorded by {q.recordedByName}
                    </ThemedText>
                  </View>

                  <ThemedText style={styles.transferAmount}>
                    {formatPaise(q.amountPaise)}
                  </ThemedText>
                </View>

                <View style={styles.pillRow}>
                  <PillButton
                    title="Not received"
                    tone="neutral"
                    onPress={() => review.mutate({ id: q.id, approve: false })}
                    loading={reviewing(q.id)}
                  />
                  <PillButton
                    title="Got it"
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
            <SectionTitle title={`Waiting to be confirmed (${watching.length})`} />

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
                      Waiting for {q.toName}
                    </ThemedText>
                  </View>

                  <ThemedText style={styles.transferAmount}>
                    {formatPaise(q.amountPaise)}
                  </ThemedText>
                </View>

                {isOwner ? (
                  <View style={styles.pillRow}>
                    <PillButton
                      title="Reject"
                      tone="neutral"
                      onPress={() => review.mutate({ id: q.id, approve: false })}
                      loading={reviewing(q.id)}
                    />
                    <PillButton
                      title="Confirm for them"
                      tone="neutral"
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
            {/* Two views, not a stack: your balances person by person, or the
                household's plan. They are different arithmetic on the same
                money, and side by side their amounts looked contradictory. */}
            <Segmented
              options={[
                { value: 'balances', label: 'Balances' },
                { value: 'plan', label: 'Best plan' },
              ]}
              value={view}
              onChange={show}
            />

            {view === 'balances' ? (
              pairs.rows.length > 0 ? (
                <>
                  {/* "Since" once, under whichever heading comes first. */}
                  {renderPairs('Owed to you', owedToMe, true)}
                  {renderPairs('You owe', iOwe, owedToMe.length === 0)}
                </>
              ) : (
                <EmptyView icon="thumbs-up-outline" text="You're square with everyone." />
              )
            ) : null}

            {view === 'plan' ? (
              <View style={styles.section}>
                {/* The heading and a ? -- the explanation is a popup, not a
                    paragraph on the screen that most people read once and then
                    scroll past for good. */}
                <View style={styles.titleRow}>
                  <ThemedText style={styles.sectionTitle}>
                    {`Square up in ${visible.length} payment${visible.length === 1 ? '' : 's'}`}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="How the plan works"
                    hitSlop={10}
                    onPress={() =>
                      void dialog.alert({
                        tone: 'info',
                        icon: 'help-circle-outline',
                        title: 'Fewest payments',
                        message:
                          'Fewer transfers than everyone paying everyone, with the same totals. ' +
                          'Amounts here will not match Balances, because a payment can ' +
                          'be routed through somebody else.',
                        buttonLabel: 'Got it',
                      })
                    }
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                    <Ionicons name="help-circle-outline" size={20} color={theme.textTertiary} />
                  </Pressable>
                </View>
                {renderSection(visible)}
              </View>
            ) : null}
          </>
          ))}

        {(error ?? ledgerError) ? (
          <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
            <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
              {error ?? ledgerError}
            </ThemedText>
          </View>
        ) : null}

        {/* Links to other screens, grouped like a settings list: grey icons
            and chevrons, so nothing here competes with the money above. */}
        <View style={styles.section}>
          <SectionTitle title="More" />

          <Card padded={false}>
            {(() => {
              const months = isOwner ? (periods.data ?? []) : [];
              const count = months.length + 1;

              return (
                <>
                  <LinkRow
                    icon="receipt-outline"
                    title="Payment history"
                    edge={rowEdge(0, count)}
                    onPress={() => router.push('/settlements')}
                  />
                  {/* Tapping a month opens its statement, where closing has
                      the context to be a considered decision rather than a
                      one-tap action next to a list. */}
                  {months.map((p, i) => {
                    const closed = p.status === 'closed';
                    return (
                      <LinkRow
                        key={p.id}
                        icon={closed ? 'lock-closed-outline' : 'lock-open-outline'}
                        title={`${MONTHS[p.month - 1]} ${p.year}`}
                        subtitle={closed ? 'Closed — frozen' : 'Open'}
                        edge={rowEdge(i + 1, count)}
                        onPress={() =>
                          router.push({
                            pathname: '/month-statement',
                            params: { year: String(p.year), month: String(p.month) },
                          })
                        }
                      />
                    );
                  })}
                </>
              );
            })()}
          </Card>
        </View>
      </ScrollView>

      <Sheet visible={payFor != null} title="Pay with" onClose={() => setPayFor(null)}>
        {payFor ? (
          <>
            <View style={styles.payAmount}>
              <ThemedText themeColor="textSecondary" style={Type.caption}>
                {nameOf(payFor.to)}
              </ThemedText>
              <ThemedText style={styles.payAmountText}>{formatPaise(payFor.amountPaise)}</ThemedText>
            </View>

            {payApps == null ? (
              <ActivityIndicator color={theme.textSecondary} />
            ) : payApps.length === 0 ? (
              <ThemedText themeColor="textSecondary" style={[Type.body, { textAlign: 'center' }]}>
                No UPI apps on this phone.
              </ThemedText>
            ) : (
              <View style={styles.payGrid}>
                {payApps.map((app) => (
                  <Pressable
                    key={app.packageName}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay with ${app.label}`}
                    onPress={() => payWith(payFor, app)}
                    style={({ pressed }) => [styles.payTile, { opacity: pressed ? 0.6 : 1 }]}>
                    {app.icon ? (
                      <Image source={{ uri: app.icon }} style={styles.payIcon} contentFit="contain" />
                    ) : (
                      <View
                        style={[
                          styles.payIcon,
                          styles.payIconBlank,
                          { backgroundColor: theme.backgroundSelected },
                        ]}>
                        <Ionicons name="wallet-outline" size={22} color={theme.textSecondary} />
                      </View>
                    )}
                    <ThemedText style={styles.payLabel} numberOfLines={1}>
                      {app.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : null}
      </Sheet>
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
  function renderPairs(title: string, rows: PairNet[], withSince: boolean) {
    if (rows.length === 0) return null;

    return (
      <View style={styles.section}>
        <SectionTitle
          title={title}
          hint={withSince && squaredOn ? `Since ${squaredOn}` : undefined}
        />

        {/* One grouped list, not a card per person: a row is a name and an
            amount, and a stack of cards made three people look like a page. */}
        <Card padded={false}>
        {rows.map((pair, i) => {
          const key = `pair-${pair.memberId}`;
          const isOpen = expanded === key;
          const them = nameOf(pair.memberId);
          const owesMe = pair.netPaise > 0;
          const bills = pair.lines.filter((l) => l.kind !== 'settlement').length;
          const paid = pair.lines.length - bills;

          // Retroactive, and the reason this card is worth reading at all for
          // an already-settled pair: payments in the ledger get replayed to
          // work out how much of each one was only passing through. Nothing
          // was stored about this at the time (record_settlement keeps the
          // amount and nothing else), so it is reconstructed here.
          const notes = routingNotes(pair, them);

          return (
            <View
              key={key}
              style={i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
              {/* The whole row opens the breakdown; the chevron says so. */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                onPress={() => setExpanded(isOpen ? null : key)}
                style={({ pressed }) => [
                  styles.listRow,
                  pressed && { backgroundColor: theme.backgroundSelected },
                  pressed && rowEdge(i, isOpen ? rows.length + 1 : rows.length),
                ]}>
                {/* Neutral, as in Home's Balances: green means the money, not
                    the person. */}
                <Avatar name={them} seed={pair.memberId} size={34} />

                <View style={styles.flex}>
                  <ThemedText style={[Type.body, styles.medium]} numberOfLines={1}>
                    {them}
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.micro}>
                    {bills > 0
                      ? `${bills} bill${bills === 1 ? '' : 's'}`
                      : `${paid} payment${paid === 1 ? '' : 's'}`}
                  </ThemedText>
                </View>

                {/* Green for money coming to you, red for money you owe --
                    the same two colours every balance in the app uses. */}
                <ThemedText
                  style={[styles.rowAmount, { color: owesMe ? theme.positive : theme.negative }]}
                  accessibilityLabel={
                    owesMe
                      ? `${them} owes you ${formatPaise(pair.netPaise)}`
                      : `You owe ${them} ${formatPaise(-pair.netPaise)}`
                  }>
                  {owesMe ? '+ ' : '− '}
                  {formatPaise(Math.abs(pair.netPaise))}
                </ThemedText>
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={theme.textTertiary}
                />
              </Pressable>

              {isOpen ? (
                <Reveal style={[styles.why, styles.rowBody, { backgroundColor: theme.backgroundSunken }]}>
                  {/* The explanations, first: why there is no "Settle this"
                      when you come out ahead overall, and any routing that
                      makes this pair look unsettled. */}
                  {!owesMe && !iPayInPlan ? (
                    <ThemedText themeColor="textSecondary" style={Type.micro}>
                      You come out ahead overall, so the plan settles this by paying you less — not
                      by you paying {them}.
                    </ThemedText>
                  ) : null}
                  {notes.map((note) => (
                    <ThemedText key={note} themeColor="textSecondary" style={Type.micro}>
                      {note}
                    </ThemedText>
                  ))}

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
                          { color: l.deltaPaise >= 0 ? theme.positive : theme.negative },
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
                    <PillButton
                      title={exporting === pair.memberId ? 'Saving…' : 'Download'}
                      tone="neutral"
                      loading={exporting === pair.memberId}
                      onPress={() => void downloadPair(pair)}
                    />
                    <PillButton
                      title="View all"
                      // The object form rather than a template literal: it is
                      // expo-router's documented way to pass a dynamic segment,
                      // and it does not depend on how the typed-routes
                      // generator happens to have emitted this route.
                      onPress={() =>
                        router.push({ pathname: '/pair/[id]', params: { id: pair.memberId } })
                      }
                    />
                  </View>
                </Reveal>
              ) : null}
            </View>
          );
        })}
        </Card>
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
        // No paragraph under it: the button's own words say the state, and
        // for the payee the confirm card at the top of this screen is the
        // next step, with its own buttons.
        title: kind === 'owed' ? `${nameOf(t.from)} says they paid` : `Waiting for ${nameOf(t.to)}`,
        disabled: true,
      };
    }

    return {
      title:
        kind === 'owed'
          ? 'Mark as received'
          : kind === 'owe'
            ? 'I have paid this'
            : 'Record this payment',
      // Green: this is the one thing to do on the card. It was once the same
      // muted grey as the disabled state above, which left opacity as the
      // only difference between "do this" and "already done" -- PillButton
      // keeps the two apart by colour as well.
      disabled: false,
    };
  }

  function renderSection(rows: Transfer[]) {
    if (rows.length === 0) return null;

    // Your own payments first and apart: an owner sees the whole household's
    // plan, and the one or two that need you were lost among the rest. A
    // display grouping only -- the plan itself is untouched. Labels only when
    // there are two groups; a member only ever sees their own.
    const groups = [
      { label: 'Yours', items: rows.filter(mine) },
      { label: 'Others', items: rows.filter((t) => !mine(t)) },
    ].filter((g) => g.items.length > 0);

    return (
      <>
        {groups.map((g) => (
          <View key={g.label} style={styles.section}>
            {groups.length > 1 ? (
              <ThemedText themeColor="textTertiary" style={Type.caption}>
                {g.label}
              </ThemedText>
            ) : null}
            <Card padded={false}>
          {g.items.map((t, i) => {
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

              // Green icon on your own payments, grey on everybody else's.
              const yours = kind !== 'other';

              return (
                <View
                  key={key}
                  style={[
                    styles.planRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  ]}>
                  <View style={styles.transferHead}>
                    {/* One icon for the transaction, not two faces. Two
                        avatars plus an arrow read as a relationship between
                        people; the row is about a single payment, and the
                        names already say who is involved. */}
                    <View
                      style={[
                        styles.roundIcon,
                        { backgroundColor: yours ? theme.primarySoft : theme.backgroundSelected },
                      ]}>
                      <Ionicons
                        name={kind === 'owed' ? 'arrow-down' : kind === 'owe' ? 'arrow-up' : 'arrow-forward'}
                        size={16}
                        color={yours ? theme.brandInk : theme.textSecondary}
                      />
                    </View>

                    <View style={styles.flex}>
                      {/* "Mani pays you", not "Mani → Lee": your own name in
                          a list is the one you read past. */}
                      <ThemedText style={[Type.body, styles.medium]} numberOfLines={1}>
                        {kind === 'owed'
                          ? `${nameOf(t.from)} pays you`
                          : kind === 'owe'
                            ? `You pay ${nameOf(t.to)}`
                            : `${nameOf(t.from)} → ${nameOf(t.to)}`}
                      </ThemedText>
                      {/* Only when it matters: an ordinary payment needs no
                          caption, a routed one gets two words and its
                          details behind "Show details". */}
                      {routed ? (
                        <ThemedText themeColor="textTertiary" style={Type.micro}>
                          Partly passing through
                        </ThemedText>
                      ) : null}
                    </View>

                    {/* Green coming to you, red going out, plain between
                        two other people -- as on Balances. */}
                    <ThemedText
                      style={[
                        styles.rowAmount,
                        kind === 'owed' && { color: theme.positive },
                        kind === 'owe' && { color: theme.negative },
                      ]}>
                      {kind === 'owed' ? '+ ' : kind === 'owe' ? '− ' : ''}
                      {formatPaise(t.amountPaise)}
                    </ThemedText>
                  </View>

                  {routed && planOpen === key ? (
                    <Reveal style={[styles.why, { backgroundColor: theme.backgroundSunken }]}>
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
                    </Reveal>
                  ) : null}

                  {/* Once it is sent there is nothing more for this person to
                      do, so the button becomes a status rather than inviting
                      them to record the same payment twice. It stays a BUTTON
                      -- greyed out, in the same place, with different words --
                      because a button that turns into a notice reads as the
                      button having disappeared. */}
                  {/* A small pill at the right, not a full-width solid button:
                      three of those down the plan made every row shout, and
                      the one that mattered looked like the rest. The details
                      toggle shares its line, only when something is routed --
                      collapsed, because a paragraph on every row pushed the
                      buttons off the screen. */}
                  <View style={styles.planFoot}>
                    {routed ? (
                      <Pressable
                        onPress={() => setPlanOpen(planOpen === key ? null : key)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: planOpen === key }}
                        style={styles.whyToggle}>
                        <ThemedText style={[Type.micro, { color: theme.brandInk }]}>
                          {planOpen === key ? 'Hide details' : 'Show details'}
                        </ThemedText>
                        <Ionicons
                          name={planOpen === key ? 'chevron-up' : 'chevron-down'}
                          size={13}
                          color={theme.brandInk}
                        />
                      </Pressable>
                    ) : (
                      <View />
                    )}
                    {/* Pay leads when it is offered -- it is the thing to do
                        -- and "I have paid this" steps back to grey beside
                        it, for money already sent some other way. */}
                    <View style={styles.pillRow}>
                      {upi && kind === 'owe' && !action.disabled ? (
                        <PillButton title="Pay" icon="wallet-outline" onPress={() => startPay(t)} />
                      ) : null}
                      <PillButton
                        title={action.title}
                        disabled={action.disabled}
                        loading={paying(t)}
                        tone={
                          yours && !(upi && kind === 'owe' && !action.disabled) ? 'primary' : 'neutral'
                        }
                        onPress={() => confirmPaid(t, kind)}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
            </Card>
          </View>
        ))}
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

/**
 * The one button on this screen: a compact pill. Solid green with white words
 * for the thing to do; outlined for the alternative beside it; flat grey with
 * muted words once it is already sent and waiting -- same place and shape, so
 * a sent payment reads as a status rather than a vanished button.
 *
 * Solid and outlined, not the pale tints this used to be: a pale green pill
 * next to a pale grey one read as two tags, not as something to press. Still
 * compact, so a plan with three payments does not become three slabs.
 */
function PillButton({
  title,
  onPress,
  icon,
  disabled = false,
  loading = false,
  tone = 'primary',
  onTint = false,
}: {
  title: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'neutral';
  /** Sits on a pale green card, where a pale green pill would vanish. */
  onTint?: boolean;
}) {
  const theme = useTheme();
  // On the green balance card a solid green pill would vanish, so there it
  // is white with green words instead.
  const solid = tone === 'primary' && !onTint;
  const ink = disabled
    ? theme.textTertiary
    : solid
      ? theme.onPrimary
      : onTint
        ? theme.brandInk
        : theme.text;
  const fill = disabled
    ? theme.backgroundSelected
    : solid
      ? theme.primary
      : onTint
        ? theme.backgroundElement
        : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: fill, opacity: pressed ? 0.75 : 1 },
        // The alternative is outlined, so it still reads as a button.
        // textTertiary rather than borderStrong: borderStrong is a card edge,
        // and around a pill it was too faint to read as a button.
        !disabled && !solid && !onTint && [styles.pillOutline, { borderColor: theme.textTertiary }],
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={ink} />
      ) : (
        <View style={styles.pillInner}>
          {icon ? <Ionicons name={icon} size={15} color={ink} /> : null}
          <ThemedText style={[styles.pillText, { color: ink }]} numberOfLines={1}>
            {title}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

/**
 * A section heading: sentence case at heading size, with an optional one-line
 * hint. These were spaced capitals at caption size (Type.label), which both
 * read as quiet as the hints under them and clipped their last letter on
 * Android ("YESTERDA") -- the same fix History and Home already had.
 */
function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {hint ? (
        <ThemedText themeColor="textTertiary" style={Type.micro}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * Rounds a pressed row's outer corners to its card's, so the tint does not
 * poke square corners out of the first and last rows.
 */
function rowEdge(index: number, count: number) {
  return {
    ...(index === 0 && { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg }),
    ...(index === count - 1 && {
      borderBottomLeftRadius: Radius.lg,
      borderBottomRightRadius: Radius.lg,
    }),
  };
}

/** A row that opens another screen: grey icon, title, chevron. */
function LinkRow({
  icon,
  title,
  subtitle,
  edge,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  edge: ReturnType<typeof rowEdge>;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.periodRow,
        edge.borderTopLeftRadius === undefined && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.border,
        },
        pressed && [{ backgroundColor: theme.backgroundSelected }, edge],
      ]}>
      <View style={[styles.periodIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name={icon} size={16} color={theme.textSecondary} />
      </View>
      <View style={styles.flex}>
        <ThemedText style={Type.body}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
    </Pressable>
  );
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
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  semi: { fontWeight: '600' },
  medium: { fontWeight: '500' },

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
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },

  summary: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three + Spacing.one,
    gap: Spacing.one,
  },
  summaryValue: { fontSize: 30, lineHeight: 38, fontWeight: '600', letterSpacing: -1 },
  summarySplit: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
    paddingTop: Spacing.two + Spacing.one,
  },
  summaryDivider: { width: StyleSheet.hairlineWidth },
  summaryRight: { paddingLeft: Spacing.three },
  summaryPart: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  // The amount on the left, Settle up on the right of it.
  summaryAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },

  // One row of a grouped list (Balances, the plan).
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  rowAmount: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  rowBody: { marginHorizontal: Spacing.three, marginBottom: Spacing.three },
  planRow: { padding: Spacing.three, gap: Spacing.two },
  roundIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: {
    minHeight: 36,
    paddingHorizontal: Spacing.three + 2,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 1px, not a hairline: a hairline on a dark card was too faint to read as
  // an edge.
  pillOutline: { borderWidth: 1 },
  pillText: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  pillInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },

  payAmount: { alignItems: 'center', gap: 2 },
  payAmountText: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.6 },
  // Four to a row, like a phone's own app drawer.
  payGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.three },
  payTile: { width: '25%', alignItems: 'center', gap: Spacing.one + 2 },
  payIcon: { width: 52, height: 52, borderRadius: 14 },
  payIconBlank: { alignItems: 'center', justifyContent: 'center' },
  payLabel: { fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: 2 },
  // A row of pills, pushed to the right of the card.
  pillRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // 16 inside, not the Card default 24: these cards are mostly one row.
  transfer: { gap: Spacing.two + Spacing.one, padding: Spacing.three },
  transferHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  transferIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferAmount: { fontSize: 17, fontWeight: '600', letterSpacing: -0.4 },
  reviewRow: { flexDirection: 'row', gap: Spacing.two },

  whyToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  why: { borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.two },
  whyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  // One expense in the "what is this made of" list.
  pairActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
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
