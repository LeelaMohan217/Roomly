import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { formatRange } from '@/lib/dates';
import { iconFor } from '@/lib/icons';
import { formatPaise, parseAmount } from '@/lib/money';
import { useRecurring, type Recurring } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export default function RecurringScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const recurring = useRecurring();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: async ({
      id,
      amountPaise,
      dueDate,
    }: {
      id: string;
      amountPaise: number | null;
      // The day the bill FELL DUE, not today. p_date defaults to current_date,
      // so an electricity bill due on the 5th and entered on the 20th used to
      // be dated the 20th — the wrong day, and at a month boundary the wrong
      // month entirely.
      dueDate?: string;
    }) => {
      const { error: rpcError } = await supabase.rpc('post_recurring_now', {
        p_recurring: id,
        p_amount: amountPaise,
        ...(dueDate ? { p_date: dueDate } : {}),
      });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (e) => setError(humanError(e)),
  });

  const rules = recurring.data ?? [];
  // Only 'confirm' rules need a prompt — 'auto' ones post themselves when
  // anyone opens the app.
  const needsConfirming = rules.filter((r) => r.isDue && r.mode === 'confirm');

  /**
   * Bills from earlier months that were never entered.
   *
   * These used to disappear in silence: isDue looked only at the current
   * month, so on 1 October September's electricity simply stopped being asked
   * for. Nobody was told, and the month's Reports were quietly short by a bill.
   */
  const missed = rules
    .flatMap((r) => r.overdue.map((o) => ({ rule: r, ...o })))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const monthlyTotal = rules
    .filter((r) => r.isActive && r.amountPaise)
    .reduce((sum, r) => sum + (r.amountPaise ?? 0), 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Bills"
        action={
          /* A member may add a bill they pay themselves — "I buy the water
             can" (migration 0031). Committing somebody ELSE to paying every
             month is still owner-only, enforced in the policy and by the
             payer picker on the edit screen. */
          (
            <Pressable
              onPress={() => router.push('/recurring-edit')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Ionicons name="add" size={20} color={theme.primary} />
            </Pressable>
          )
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        // Without this the first tap on Post is swallowed dismissing the
        // keyboard, so every varying bill took two taps. Every other form in
        // the app already sets it.
        keyboardShouldPersistTaps="handled">
        {monthlyTotal > 0 ? (
          <Card>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              Fixed every month
            </ThemedText>
            <ThemedText style={Type.display} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatPaise(monthlyTotal)}</ThemedText>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              Posted automatically — you never type these again
            </ThemedText>
          </Card>
        ) : null}

        {missed.length > 0 ? (
          <View style={styles.section}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              NEVER ENTERED ({missed.length})
            </ThemedText>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              These fell due and no amount was ever put in, so they are missing from those
              months. Enter them now and they post on the day they were due.
            </ThemedText>

            {missed.map((m) => {
              const key = `${m.rule.id}-${m.year}-${m.month}`;
              const typed = amounts[key] ?? '';
              const paise = m.rule.mode === 'confirm' ? parseAmount(typed) : m.rule.amountPaise;

              return (
                <Card key={key} style={styles.confirmCard}>
                  <View style={styles.rowHead}>
                    <View style={[styles.tile, { backgroundColor: theme.warningSoft }]}>
                      <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(m.rule.categoryIcon)}</ThemedText>
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={Type.body}>
                        {m.rule.description || m.rule.categoryName}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {MONTHS[m.month - 1]} {m.year} · was due {formatRange(m.dueDate, m.dueDate)}
                      </ThemedText>
                    </View>
                  </View>

                  {m.rule.mode === 'confirm' ? (
                    <View
                      style={[
                        styles.amountBox,
                        { backgroundColor: theme.backgroundSunken, borderColor: theme.border },
                      ]}>
                      <ThemedText themeColor="textTertiary" style={styles.currency}>
                        ₹
                      </ThemedText>
                      <TextInput
                        value={typed}
                        onChangeText={(t) => setAmounts((a) => ({ ...a, [key]: t }))}
                        placeholder={`${MONTHS[m.month - 1]}'s bill`}
                        placeholderTextColor={theme.textTertiary}
                        keyboardType="decimal-pad"
                        style={[styles.amountInput, { color: theme.text }]}
                      />
                    </View>
                  ) : null}

                  <Button
                    title={paise ? `Post ${formatPaise(paise)}` : 'Post'}
                    onPress={() =>
                      post.mutate({ id: m.rule.id, amountPaise: paise, dueDate: m.dueDate })
                    }
                    loading={post.isPending && post.variables?.dueDate === m.dueDate}
                    disabled={!paise}
                  />
                </Card>
              );
            })}
          </View>
        ) : null}

        {needsConfirming.length > 0 ? (
          <View style={styles.section}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              NEEDS AN AMOUNT ({needsConfirming.length})
            </ThemedText>

            {needsConfirming.map((r) => {
              const typed = amounts[r.id] ?? '';
              const paise = parseAmount(typed);

              return (
                <Card key={r.id} style={styles.confirmCard}>
                  <View style={styles.rowHead}>
                    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(r.categoryIcon)}</ThemedText>
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={Type.body}>
                        {r.description || r.categoryName}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        Due {ordinal(r.dayOfMonth)} · {r.paidByName} pays
                      </ThemedText>
                    </View>
                  </View>

                  {/* The amount varies, so it's asked for rather than guessed. */}
                  <View
                    style={[
                      styles.amountBox,
                      { backgroundColor: theme.backgroundSunken, borderColor: theme.border },
                    ]}>
                    <ThemedText themeColor="textTertiary" style={styles.currency}>
                      ₹
                    </ThemedText>
                    <TextInput
                      value={typed}
                      onChangeText={(t) => setAmounts((a) => ({ ...a, [r.id]: t }))}
                      placeholder="This month's bill"
                      placeholderTextColor={theme.textTertiary}
                      keyboardType="decimal-pad"
                      style={[styles.amountInput, { color: theme.text }]}
                    />
                  </View>

                  <Button
                    title={paise ? `Post ${formatPaise(paise)}` : 'Post'}
                    onPress={() => post.mutate({ id: r.id, amountPaise: paise })}
                    loading={post.isPending && post.variables?.id === r.id}
                    disabled={!paise}
                  />
                </Card>
              );
            })}
          </View>
        ) : null}

        {error ? <Notice tone="danger" message={error} /> : null}

        <View style={styles.section}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            EVERY MONTH
          </ThemedText>

          {rules.length > 0 ? (
            <Card padded={false}>
              {rules.map((r, i) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  last={i === rules.length - 1}
                  onPress={
                    isOwner
                      ? () => router.push({ pathname: '/recurring-edit', params: { id: r.id } })
                      : undefined
                  }
                />
              ))}
            </Card>
          ) : (
            <Card style={styles.empty}>
              <Ionicons name="repeat" size={22} color={theme.textTertiary} />
              <ThemedText style={Type.headline}>Nothing recurring yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                Rent, wifi and the maid are the same every month. Add them once and they post
                themselves.
              </ThemedText>
              {isOwner ? (
                <Button
                  title="Add the first one"
                  variant="secondary"
                  onPress={() => router.push('/recurring-edit')}
                />
              ) : null}
            </Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RuleRow({
  rule,
  last,
  onPress,
}: {
  rule: Recurring;
  last: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        { opacity: (pressed && onPress ? 0.6 : 1) * (rule.isActive ? 1 : 0.5) },
      ]}>
      <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(rule.categoryIcon)}</ThemedText>
      </View>

      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <ThemedText style={Type.body} numberOfLines={1}>
            {rule.description || rule.categoryName}
          </ThemedText>
          {!rule.isActive ? (
            <View style={[styles.pill, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText themeColor="textTertiary" style={Type.micro}>
                paused
              </ThemedText>
            </View>
          ) : rule.mode === 'confirm' ? (
            <View style={[styles.pill, { backgroundColor: theme.warningSoft }]}>
              <ThemedText style={[Type.micro, { color: theme.warning }]}>varies</ThemedText>
            </View>
          ) : null}
        </View>

        <ThemedText themeColor="textTertiary" style={Type.micro}>
          {ordinal(rule.dayOfMonth)} of the month · {rule.paidByName}
          {rule.postedThisMonth ? ' · posted' : ''}
        </ThemedText>
      </View>

      {rule.amountPaise ? (
        <ThemedText style={Type.amount}>{formatPaise(rule.amountPaise)}</ThemedText>
      ) : (
        <ThemedText themeColor="textTertiary" style={Type.micro}>
          varies
        </ThemedText>
      )}

      {rule.postedThisMonth ? (
        <Ionicons name="checkmark-circle" size={17} color={theme.primary} />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  addButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: { gap: Spacing.two },
  confirmCard: { gap: Spacing.three },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },

  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  currency: { fontSize: 19, fontWeight: '600' },
  amountInput: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '700', padding: 0 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pill: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  tile: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 18 },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
