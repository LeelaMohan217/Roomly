import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useMonthStatement, usePeriods } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function MonthStatementScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const params = useLocalSearchParams<{ year?: string; month?: string }>();
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1;

  const statement = useMonthStatement(year, month);
  const periods = usePeriods();
  const [error, setError] = useState<string | null>(null);

  const period = periods.data?.find((p) => p.year === year && p.month === month);
  const s = statement.data;

  const close = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await supabase.rpc('close_period', { p_period: period!.id });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (e) => setError(humanError(e)),
  });

  /**
   * reopen_period() has existed and been granted since 0004_functions.sql:328,
   * with no caller anywhere in the app — while the expense detail screen told
   * people to "reopen the month from Settle up", which was not a thing you
   * could do. Once a month closed, it was closed forever.
   *
   * That was survivable while the lock leaked (a pending change could be
   * approved straight through a closed month). Migration 0025 sealed those
   * routes, so the way back out has to actually exist.
   */
  const reopen = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await supabase.rpc('reopen_period', { p_period: period!.id });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (e) => setError(humanError(e)),
  });

  // Amber, not red: closing and reopening are consequential but reversible.
  async function confirmClose() {
    const ok = await dialog.confirm({
      tone: 'warning',
      icon: 'lock-closed-outline',
      title: `Close ${MONTHS[month - 1]}?`,
      message:
        'Expenses in a closed month can no longer be edited without your approval. This is the point everyone squares up.',
      confirmLabel: 'Close month',
    });
    if (ok) close.mutate();
  }

  async function confirmReopen() {
    const ok = await dialog.confirm({
      tone: 'warning',
      icon: 'lock-open-outline',
      title: `Reopen ${MONTHS[month - 1]}?`,
      message:
        'Everyone agreed on these figures when the month closed. Reopening lets them change again — do it to correct a genuine mistake, then close it back.',
      confirmLabel: 'Reopen month',
    });
    if (ok) reopen.mutate();
  }

  const label = `${MONTHS[month - 1]} ${year}`;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* The month's state as one small grey tag, not a subtitle and a pill
          saying the same thing. */}
      <ScreenHeader
        title={label}
        action={
          s?.status ? (
            <View style={[styles.pill, { backgroundColor: theme.backgroundSelected }]}>
              {s.status === 'closed' ? (
                <Ionicons name="lock-closed" size={11} color={theme.textSecondary} />
              ) : null}
              <ThemedText themeColor="textSecondary" style={styles.pillText}>
                {s.status === 'closed' ? 'Closed' : 'Open'}
              </ThemedText>
            </View>
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* This screen had no loading branch at all, so while the statement
            was in flight it asserted "Household spent ₹0.00 across 0 expenses"
            and offered "Nothing this month" underneath. That is a false
            statement about money, not a blank space — and on the one screen
            people open to agree on the figures. */}
        {statement.isLoading || statement.isError ? (
          queryState(statement, 'this month', `Adding up ${label}…`)
        ) : (
          <>
        {/* On the page, not in a card -- as on Expense details. */}
        <Appear index={0} style={styles.hero}>
          <ThemedText themeColor="textSecondary" style={Type.caption}>
            Household spent
          </ThemedText>
          <ThemedText style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {formatPaise(s?.totalPaise ?? 0)}
          </ThemedText>
          <ThemedText themeColor="textTertiary" style={Type.caption}>
            {s?.expenseCount ?? 0} expense{s?.expenseCount === 1 ? '' : 's'}
          </ThemedText>
        </Appear>

        {(s?.expenseCount ?? 0) === 0 ? (
          <Appear index={1}>
          <Card style={styles.empty}>
            <Ionicons name="calendar-outline" size={22} color={theme.textTertiary} />
            <ThemedText style={Type.headline}>Nothing this month</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
              No expenses were recorded in {label}.
            </ThemedText>
          </Card>
          </Appear>
        ) : (
          <>
            <Appear index={1} style={styles.section}>
              <View>
                <ThemedText style={styles.sectionTitle}>Who paid what</ThemedText>
                {/* This is the month in isolation, not the running balance —
                    someone can be up in August and still owe overall. Saying
                    so prevents the obvious misreading. */}
                <ThemedText themeColor="textTertiary" style={Type.caption}>
                  This month only
                </ThemedText>
              </View>

              <Card padded={false}>
                {s?.perMember.map((p, i) => (
                  <View
                    key={p.memberId}
                    style={[
                      styles.memberRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    ]}>
                    <Avatar name={p.name} seed={p.memberId} size={36} />

                    <View style={styles.flex}>
                      <View style={styles.nameRow}>
                        <ThemedText style={[Type.body, styles.shrink]} numberOfLines={1}>
                          {p.name}
                        </ThemedText>
                        {/* Someone who has since moved out still took part in
                            this month, and the totals above include them — so
                            omitting their row, as this used to, left the
                            columns not adding up to the household figure. */}
                        {p.hasLeft ? (
                          <View style={[styles.tag, { backgroundColor: theme.backgroundSelected }]}>
                            <ThemedText themeColor="textSecondary" style={styles.tagText}>
                              Moved out
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        Paid {formatPaise(p.paidPaise)} · share {formatPaise(p.owedPaise)}
                      </ThemedText>
                    </View>

                    <ThemedText
                      style={[
                        Type.amount,
                        {
                          color:
                            p.netPaise > 0
                              ? theme.positive
                              : p.netPaise < 0
                                ? theme.negative
                                : theme.textTertiary,
                        },
                      ]}>
                      {p.netPaise === 0
                        ? '—'
                        : `${p.netPaise > 0 ? '+' : '−'} ${formatPaise(Math.abs(p.netPaise))}`}
                    </ThemedText>
                  </View>
                ))}
              </Card>
            </Appear>

            <Appear index={2} style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Where it went</ThemedText>
              <Card padded={false}>
                {s?.byCategory.map((c, i) => (
                  <View
                    key={c.name}
                    style={[
                      styles.row,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    ]}>
                    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(c.icon)}</ThemedText>
                    </View>
                    <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                      {c.name}
                    </ThemedText>
                    {/* Fixed widths, so the columns line up, as on Reports. */}
                    <ThemedText themeColor="textTertiary" style={[Type.caption, styles.percent]}>
                      {Math.round((c.totalPaise / (s?.totalPaise || 1)) * 100)}%
                    </ThemedText>
                    <ThemedText style={[Type.amount, styles.amount]}>{formatPaise(c.totalPaise)}</ThemedText>
                  </View>
                ))}
              </Card>
            </Appear>
          </>
        )}

        {/* The same rows as Payment history, and the way there is the last
            row of the list rather than a separate button under it. */}
        <Appear index={3} style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Payments</ThemedText>
          <Card padded={false}>
            {s && s.settlements.length > 0 ? (
              s.settlements.map((t, i) => (
                <View
                  key={t.id}
                  accessible
                  accessibilityLabel={`${t.fromName} paid ${t.toName}, ${formatPaise(t.amountPaise)}`}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  ]}>
                  <View style={styles.pair}>
                    <Avatar name={t.fromName} seed={t.fromMember} size={30} ring ringColor={theme.backgroundElement} />
                    <Avatar
                      name={t.toName}
                      seed={t.toMember}
                      size={30}
                      ring
                      ringColor={theme.backgroundElement}
                      style={styles.overlap}
                    />
                  </View>
                  <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                    {t.fromName} → {t.toName}
                  </ThemedText>
                  <ThemedText style={Type.amount}>{formatPaise(t.amountPaise)}</ThemedText>
                </View>
              ))
            ) : (
              <View style={styles.row}>
                <ThemedText themeColor="textSecondary" style={Type.body}>
                  Nobody has settled up in {label} yet
                </ThemedText>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/settlements')}
              style={({ pressed }) => [
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, opacity: pressed ? 0.6 : 1 },
              ]}>
              <ThemedText style={[Type.body, styles.flex, { color: theme.brandInk }]}>See all payments</ThemedText>
              <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
            </Pressable>
          </Card>
        </Appear>

          </>
        )}

        {error ? (
          <Appear index={4}>
            <Notice tone="danger" message={error} />
          </Appear>
        ) : null}

        {/* One pill for the owner. What closing or reopening does is said in
            the confirm popup, at the moment it matters, rather than in a
            paragraph above the button on every visit. */}
        {isOwner && period && (s?.status === 'open' || s?.status === 'closed') ? (
          <Appear index={5}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: close.isPending || reopen.isPending }}
            disabled={close.isPending || reopen.isPending}
            onPress={s.status === 'open' ? confirmClose : confirmReopen}
            style={({ pressed }) => [
              styles.actionPill,
              {
                backgroundColor: s.status === 'open' ? theme.primarySoft : theme.backgroundSelected,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            {close.isPending || reopen.isPending ? (
              <ActivityIndicator size="small" color={theme.brandInk} />
            ) : (
              <>
                <Ionicons
                  name={s.status === 'open' ? 'lock-closed-outline' : 'lock-open-outline'}
                  size={15}
                  color={s.status === 'open' ? theme.brandInk : theme.text}
                />
                <ThemedText
                  style={[styles.actionText, { color: s.status === 'open' ? theme.brandInk : theme.text }]}>
                  {s.status === 'open' ? `Close ${MONTHS[month - 1]}` : `Reopen ${MONTHS[month - 1]}`}
                </ThemedText>
              </>
            )}
          </Pressable>
          </Appear>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  shrink: { flexShrink: 1 },

  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  heroAmount: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 3,
  },
  pillText: { fontSize: 12, lineHeight: 16, fontWeight: '500' },

  section: { gap: Spacing.two },
  // Sentence case at heading size, as on Settle up and History.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tag: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  tagText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 17 },
  percent: { width: 40, textAlign: 'right' },
  amount: { minWidth: 84, textAlign: 'right' },
  pair: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -10 },

  actionPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 40,
    paddingHorizontal: Spacing.four + 2,
    borderRadius: Radius.pill,
  },
  actionText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
