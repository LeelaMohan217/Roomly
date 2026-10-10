import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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

  function confirmClose() {
    Alert.alert(
      `Close ${MONTHS[month - 1]}?`,
      'Expenses in a closed month can no longer be edited without your approval. This is the point everyone squares up.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close month', style: 'destructive', onPress: () => close.mutate() },
      ]
    );
  }

  function confirmReopen() {
    Alert.alert(
      `Reopen ${MONTHS[month - 1]}?`,
      'Everyone agreed on these figures when the month closed. Reopening lets them change again — do it to correct a genuine mistake, then close it back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reopen month', onPress: () => reopen.mutate() },
      ]
    );
  }

  const label = `${MONTHS[month - 1]} ${year}`;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title={label}
        subtitle={
          s?.status === 'closed' ? 'Closed and frozen' : s?.status === 'open' ? 'Still open' : undefined
        }
        action={
          s?.status === 'closed' ? (
            <View style={[styles.pill, { backgroundColor: theme.backgroundSelected }]}>
              <Ionicons name="lock-closed" size={11} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={Type.micro}>
                Closed
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
        <Card style={styles.hero}>
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            Household spent
          </ThemedText>
          <ThemedText style={Type.display} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatPaise(s?.totalPaise ?? 0)}</ThemedText>
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            across {s?.expenseCount ?? 0} expense{s?.expenseCount === 1 ? '' : 's'}
          </ThemedText>
        </Card>

        {(s?.expenseCount ?? 0) === 0 ? (
          <Card style={styles.empty}>
            <Ionicons name="calendar-outline" size={22} color={theme.textTertiary} />
            <ThemedText style={Type.headline}>Nothing this month</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
              No expenses were recorded in {label}.
            </ThemedText>
          </Card>
        ) : (
          <>
            <View style={styles.section}>
              <ThemedText themeColor="textTertiary" style={Type.label}>
                WHO PAID WHAT
              </ThemedText>
              {/* This is the month in isolation, not the running balance —
                  someone can be up in August and still owe overall. Saying so
                  prevents the obvious misreading. */}
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.blurb]}>
                This month only. Your overall balance is on Home.
              </ThemedText>

              <Card padded={false}>
                {s?.perMember.map((p, i) => (
                  <View
                    key={p.memberId}
                    style={[
                      styles.memberRow,
                      i < (s?.perMember.length ?? 0) - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                      },
                    ]}>
                    <Avatar name={p.name} seed={p.memberId} size={36} />

                    <View style={styles.flex}>
                      <ThemedText style={Type.body}>{p.name}</ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        paid {formatPaise(p.paidPaise)} · share {formatPaise(p.owedPaise)}
                        {/* Someone who has since moved out still took part in
                            this month, and the totals above include them — so
                            omitting their row, as this used to, left the
                            columns not adding up to the household figure. */}
                        {p.hasLeft ? ' · moved out since' : ''}
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
                        : `${p.netPaise > 0 ? '+' : '−'}${formatPaise(Math.abs(p.netPaise))}`}
                    </ThemedText>
                  </View>
                ))}
              </Card>
            </View>

            <View style={styles.section}>
              <ThemedText themeColor="textTertiary" style={Type.label}>
                WHERE IT WENT
              </ThemedText>
              <Card padded={false}>
                {s?.byCategory.map((c, i) => (
                  <View
                    key={c.name}
                    style={[
                      styles.row,
                      i < (s?.byCategory.length ?? 0) - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                      },
                    ]}>
                    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(c.icon)}</ThemedText>
                    </View>
                    <ThemedText style={[Type.body, styles.flex]}>{c.name}</ThemedText>
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      {Math.round((c.totalPaise / (s?.totalPaise || 1)) * 100)}%
                    </ThemedText>
                    <ThemedText style={Type.amount}>{formatPaise(c.totalPaise)}</ThemedText>
                  </View>
                ))}
              </Card>
            </View>
          </>
        )}

        <View style={styles.section}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            PAYMENTS THIS MONTH
          </ThemedText>

          {s && s.settlements.length > 0 ? (
            <Card padded={false}>
              {s.settlements.map((t, i) => (
                <View
                  key={t.id}
                  style={[
                    styles.row,
                    i < s.settlements.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.border,
                    },
                  ]}>
                  <View style={[styles.tile, { backgroundColor: theme.primarySoft }]}>
                    <Ionicons name="checkmark" size={16} color={theme.primary} />
                  </View>
                  <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                    {t.fromName} paid {t.toName}
                  </ThemedText>
                  <ThemedText style={Type.amount}>{formatPaise(t.amountPaise)}</ThemedText>
                </View>
              ))}
            </Card>
          ) : (
            <Card>
              <ThemedText themeColor="textSecondary" style={Type.caption}>
                Nobody has settled up in {label} yet.
              </ThemedText>
            </Card>
          )}
        </View>

          </>
        )}

        {error ? (
          <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
            <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
              {error}
            </ThemedText>
          </View>
        ) : null}

        <Button
          title="See all payments"
          variant="secondary"
          onPress={() => router.push('/settlements')}
        />

        {isOwner && period && s?.status === 'open' ? (
          <>
            <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
              <Ionicons name="lock-closed-outline" size={15} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
                Closing freezes {label}. Anyone wanting to change an expense from it will need
                your approval, and corrections post as adjustments rather than rewriting history.
              </ThemedText>
            </View>
            <Button
              title={`Close ${MONTHS[month - 1]}`}
              onPress={confirmClose}
              loading={close.isPending}
            />
          </>
        ) : null}

        {isOwner && period && s?.status === 'closed' ? (
          <>
            <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
              <Ionicons name="lock-open-outline" size={15} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
                {label} is frozen. Nothing in it can be added, edited, voided or confirmed until
                it is reopened — including a change someone has already requested.
              </ThemedText>
            </View>
            <Button
              title={`Reopen ${MONTHS[month - 1]}`}
              variant="secondary"
              onPress={confirmReopen}
              loading={reopen.isPending}
            />
          </>
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

  hero: { alignItems: 'center', gap: Spacing.one },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },

  section: { gap: Spacing.two },
  blurb: { marginTop: -2, marginBottom: Spacing.one },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 17 },

  note: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
