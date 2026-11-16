import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Appear } from '@/components/ui/motion';
import { Notice } from '@/components/ui/notice';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { formatPaise } from '@/lib/money';
import { usePairwiseLedger, useSettlements, type Settlement } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const ENTRANCE_STEPS = 10;
const SETTLE_MS = 800;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SettlementsScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const settlements = useSettlements();
  const pull = usePullRefresh(() => settlements.refetch());
  const [error, setError] = useState<string | null>(null);

  /**
   * How much of each payment was only passing through, keyed by payment id.
   *
   * This list is household-wide but usePairwiseLedger is MY view, so the map
   * only covers payments I am one half of. That is the right limit rather than
   * a gap: the routed split is reconstructed from the debt between two people,
   * and I cannot see the debt between two others. Rows not in the map render
   * exactly as they did before.
   *
   * Voided payments are already filtered out of the pairwise query, so an
   * undone payment carries no routing note -- which is correct, it settled
   * nothing.
   */
  const pairwise = usePairwiseLedger(member?.id);

  const routedById = new Map<string, { directPaise: number; routedPaise: number }>();
  // All-time, not since the last settle-up: a payment that went through
  // somebody else still did, whatever has been squared since.
  for (const pair of pairwise.data?.allTime ?? []) {
    for (const line of pair.lines) {
      if (line.kind !== 'settlement' || !line.routedPaise) continue;
      routedById.set(line.id, {
        directPaise: line.directPaise ?? 0,
        routedPaise: line.routedPaise,
      });
    }
  }

  const undo = useMutation({
    mutationFn: async (id: string) => {
      const { error: upError } = await supabase
        .from('settlements')
        .update({ voided_at: new Date().toISOString() })
        .eq('id', id);
      if (upError) throw upError;
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) => setError(humanError(e)),
  });

  async function confirmUndo(s: Settlement) {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'arrow-undo-outline',
      title: 'Undo this payment?',
      message:
        `${s.fromName} → ${s.toName}, ${formatPaise(s.amountPaise)}.\n\n` +
        'The record is kept but stops counting, so both balances go back to where they were.',
      confirmLabel: 'Undo payment',
    });
    if (ok) undo.mutate(s.id);
  }

  const live = (settlements.data ?? []).filter((s) => !s.voidedAt);
  const totalSettled = live.reduce((sum, s) => sum + s.amountPaise, 0);

  // Group by the month the payment was made in.
  const sections = Object.entries(
    (settlements.data ?? []).reduce<Record<string, Settlement[]>>((acc, s) => {
      const [y, m] = s.settledOn.split('-');
      const key = `${y}-${m}`;
      (acc[key] ??= []).push(s);
      return acc;
    }, {})
  )
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, data]) => {
      const [y, m] = key.split('-').map(Number);
      return {
        title: `${MONTHS[m - 1]} ${y}`,
        total: data.filter((s) => !s.voidedAt).reduce((sum, s) => sum + s.amountPaise, 0),
        data,
      };
    });

  // As on History: only the first screenful rises in; after SETTLE_MS rows mount still.
  const order = new Map<string, number>();
  let step = 2;
  for (const s of sections) {
    order.set(`m${s.title}`, step++);
    for (const item of s.data) order.set(item.id, step++);
  }
  const hasData = !!settlements.data;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!hasData) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [hasData]);
  const entrance = (key: string) => {
    const index = order.get(key) ?? 0;
    return { index, still: settled || index > ENTRANCE_STEPS };
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Payments" />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        ListHeaderComponent={
          <>
            {/* On the page, not in a card -- as on Expense details. */}
            {live.length > 0 ? (
              <Appear index={0} still={settled} style={styles.hero}>
                <ThemedText themeColor="textSecondary" style={Type.caption}>
                  Settled so far
                </ThemedText>
                <ThemedText
                  style={styles.heroAmount}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {formatPaise(totalSettled)}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.caption}>
                  {live.length} payment{live.length === 1 ? '' : 's'}
                </ThemedText>
              </Appear>
            ) : null}

            {error ? (
              <Appear index={1}>
                <Notice tone="danger" message={error} />
              </Appear>
            ) : null}
          </>
        }
        ListEmptyComponent={
          queryState(settlements, 'the payment history') ?? (
            <Appear>
              <Card style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
                  <Ionicons name="swap-horizontal" size={22} color={theme.brandInk} />
                </View>
                <ThemedText style={Type.headline}>No payments yet</ThemedText>
                <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                  When someone marks a payment on Settle up, it appears here so nobody has to
                  remember whether it happened.
                </ThemedText>
              </Card>
            </Appear>
          )
        }
        renderSectionHeader={({ section }) => (
          <Appear {...entrance(`m${section.title}`)} style={styles.sectionHeader}>
            {/* Sentence case at heading size, as on History. */}
            <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
            <ThemedText themeColor="textTertiary" style={Type.caption}>
              {formatPaise(section.total)}
            </ThemedText>
          </Appear>
        )}
        renderItem={({ item, index, section }) => {
          const voided = !!item.voidedAt;
          const last = index === section.data.length - 1;
          const routed = routedById.get(item.id);
          const day = new Date(`${item.settledOn}T00:00:00`).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          });
          // Undo is the owner's, and lives behind a tap on the row rather
          // than a small cross on every one of them.
          const undoable = isOwner && !voided;

          return (
            <Appear {...entrance(item.id)}>
              <Pressable
                disabled={!undoable}
                onPress={() => confirmUndo(item)}
                accessibilityRole={undoable ? 'button' : 'text'}
                accessibilityHint={undoable ? 'Opens undo' : undefined}
                accessibilityLabel={
                  `${item.fromName} paid ${item.toName}, ${formatPaise(item.amountPaise)}, ${day}` +
                  (voided ? ', undone, no longer counted' : `, recorded by ${item.recordedByName}`) +
                  (routed && !voided
                    ? `. ${formatPaise(routed.directPaise)} settled up, ${formatPaise(routed.routedPaise)} routed onward`
                    : '')
                }
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                  index === 0 && styles.first,
                  last && styles.last,
                  !last && { borderBottomWidth: 0 },
                ]}>
                {/* Payer over payee, overlapping: who to whom at a glance. */}
                <View style={[styles.pair, voided && styles.faded]}>
                  <Avatar name={item.fromName} seed={item.fromMember} size={30} ring ringColor={theme.backgroundElement} />
                  <Avatar
                    name={item.toName}
                    seed={item.toMember}
                    size={30}
                    ring
                    ringColor={theme.backgroundElement}
                    style={styles.overlap}
                  />
                </View>

                <View style={styles.flex}>
                  <ThemedText
                    themeColor={voided ? 'textTertiary' : 'text'}
                    style={Type.body}
                    numberOfLines={1}>
                    {item.fromName} → {item.toName}
                  </ThemedText>
                  <View style={styles.subRow}>
                    <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
                      {/* The date alone beside a tag: there is room for one or
                          the other, and the tag is the one that explains the
                          amount. */}
                      {voided || (routed && !voided) ? day : `${day} · by ${item.recordedByName}`}
                    </ThemedText>
                    {voided ? (
                      <View style={[styles.tag, { backgroundColor: theme.backgroundSelected }]}>
                        <ThemedText themeColor="textSecondary" style={styles.tagText}>
                          Undone
                        </ThemedText>
                      </View>
                    ) : null}
                    {/* The figure on the right is what left somebody's bank, and
                        on a plan payment that is not the same as what it
                        settled between these two. Yellow, as on Person details. */}
                    {routed && !voided ? (
                      <View style={[styles.tag, { backgroundColor: theme.warningSoft }]}>
                        <ThemedText style={[styles.tagText, { color: theme.warning }]}>
                          {formatPaise(routed.routedPaise)} onward
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                </View>

                <ThemedText themeColor={voided ? 'textTertiary' : 'text'} style={Type.amount}>
                  {formatPaise(item.amountPaise)}
                </ThemedText>
              </Pressable>
            </Appear>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  // No gap: a month's rows join into one grouped card (first/last round the
  // corners), and the section header carries the space between months.
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  faded: { opacity: 0.45 },

  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  heroAmount: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -1 },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4 },
  overlap: { marginLeft: -10 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tag: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  tagText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  first: { borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  last: { borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  pair: { flexDirection: 'row', alignItems: 'center' },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
});
