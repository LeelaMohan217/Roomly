import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { formatPaise } from '@/lib/money';
import { usePairwiseLedger, useSettlements, type Settlement } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function SettlementsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const settlements = useSettlements();
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
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (e) => setError(humanError(e)),
  });

  function confirmUndo(s: Settlement) {
    Alert.alert(
      'Undo this payment?',
      `${s.fromName} → ${s.toName}, ${formatPaise(s.amountPaise)}.\n\n` +
        'The record is kept but stops counting, so both balances go back to where they were.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Undo', style: 'destructive', onPress: () => undo.mutate(s.id) },
      ]
    );
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Payments" subtitle="Money that actually moved" />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshing={settlements.isFetching}
        onRefresh={() => void settlements.refetch()}
        ListHeaderComponent={
          <>
            {live.length > 0 ? (
              <Card style={styles.hero}>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  Settled between you so far
                </ThemedText>
                <ThemedText style={Type.display}>{formatPaise(totalSettled)}</ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {live.length} payment{live.length === 1 ? '' : 's'} recorded
                </ThemedText>
              </Card>
            ) : null}

            {error ? (
              <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
                <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
                  {error}
                </ThemedText>
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          queryState(settlements, 'the payment history') ?? (
            <Card style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="swap-horizontal" size={22} color={theme.textTertiary} />
              </View>
              <ThemedText style={Type.headline}>No payments yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                When someone marks a payment on Settle up, it appears here so nobody has to
                remember whether it happened.
              </ThemedText>
            </Card>
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              {section.title.toUpperCase()}
            </ThemedText>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              {formatPaise(section.total)}
            </ThemedText>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const voided = !!item.voidedAt;
          const last = index === section.data.length - 1;
          const routed = routedById.get(item.id);

          return (
            <View
              style={[
                styles.row,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  opacity: voided ? 0.45 : 1,
                },
                index === 0 && styles.first,
                last && styles.last,
                !last && { borderBottomWidth: 0 },
              ]}>
              <View style={styles.pair}>
                <Avatar name={item.fromName} seed={item.fromMember} size={30} />
                <Ionicons name="arrow-forward" size={12} color={theme.textTertiary} />
                <Avatar name={item.toName} seed={item.toMember} size={30} />
              </View>

              <View style={styles.flex}>
                <ThemedText style={[Type.body, voided && styles.struck]} numberOfLines={1}>
                  {item.fromName} paid {item.toName}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {voided
                    ? 'undone — no longer counted'
                    : `${new Date(`${item.settledOn}T00:00:00`).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })} · recorded by ${item.recordedByName}`}
                </ThemedText>

                {/* The figure on the right is what left somebody's bank, and
                    on a plan payment that is not the same as what it settled
                    between these two. Saying so here means nobody has to find
                    Settle up to learn it. */}
                {routed && !voided ? (
                  <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={2}>
                    {formatPaise(routed.directPaise)} settled up ·{' '}
                    <ThemedText style={[Type.micro, { color: theme.warning }]}>
                      {formatPaise(routed.routedPaise)} routed onward
                    </ThemedText>
                  </ThemedText>
                ) : null}
              </View>

              <ThemedText style={[Type.amount, voided && styles.struck]}>
                {formatPaise(item.amountPaise)}
              </ThemedText>

              {isOwner && !voided ? (
                <Pressable onPress={() => confirmUndo(item)} hitSlop={14}>
                  <Ionicons name="close-circle-outline" size={18} color={theme.textTertiary} />
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.one },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  struck: { textDecorationLine: 'line-through' },

  hero: { alignItems: 'center', gap: Spacing.one, marginBottom: Spacing.two },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  first: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  last: { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
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
