import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Appear } from '@/components/ui/motion';
import { Notice } from '@/components/ui/notice';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { formatRange } from '@/lib/dates';
import { iconFor } from '@/lib/icons';
import { formatPaise, parseAmount } from '@/lib/money';
import { useRecurring, type Recurring } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
        {/* On the page, not in a card -- as on Expense details. */}
        {monthlyTotal > 0 ? (
          <Appear index={0} style={styles.hero}>
            <ThemedText themeColor="textSecondary" style={Type.caption}>
              Every month
            </ThemedText>
            <ThemedText style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {formatPaise(monthlyTotal)}
            </ThemedText>
            <ThemedText themeColor="textTertiary" style={Type.caption}>
              {rules.length} bill{rules.length === 1 ? '' : 's'}
            </ThemedText>
          </Appear>
        ) : null}

        {/* Everything waiting on an amount, in one list: bills from earlier
            months that were never entered first (oldest first), then this
            month's. A missed bill says so with a yellow tag, and still posts
            on the day it fell due. */}
        {missed.length + needsConfirming.length > 0 ? (
          <Appear index={1} style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Needs an amount</ThemedText>
            <Card padded={false}>
              {missed.map((m, i) => {
                const key = `${m.rule.id}-${m.year}-${m.month}`;
                const typed = amounts[key] ?? '';
                return (
                  <PostRow
                    key={key}
                    first={i === 0}
                    rule={m.rule}
                    sub={`Due ${formatRange(m.dueDate, m.dueDate)} · ${m.rule.paidByName} pays`}
                    tag={`Missed · ${SHORT[m.month - 1]}`}
                    typed={typed}
                    onType={(t) => setAmounts((a) => ({ ...a, [key]: t }))}
                    paise={m.rule.mode === 'confirm' ? parseAmount(typed) : m.rule.amountPaise}
                    loading={post.isPending && post.variables?.dueDate === m.dueDate}
                    onPost={(paise) => post.mutate({ id: m.rule.id, amountPaise: paise, dueDate: m.dueDate })}
                  />
                );
              })}
              {needsConfirming.map((r, i) => {
                const typed = amounts[r.id] ?? '';
                return (
                  <PostRow
                    key={r.id}
                    first={missed.length === 0 && i === 0}
                    rule={r}
                    sub={`Due ${ordinal(r.dayOfMonth)} · ${r.paidByName} pays`}
                    typed={typed}
                    onType={(t) => setAmounts((a) => ({ ...a, [r.id]: t }))}
                    paise={parseAmount(typed)}
                    loading={post.isPending && post.variables?.id === r.id && !post.variables?.dueDate}
                    onPost={(paise) => post.mutate({ id: r.id, amountPaise: paise })}
                  />
                );
              })}
            </Card>
          </Appear>
        ) : null}

        {error ? (
          <Appear index={2}>
            <Notice tone="danger" message={error} />
          </Appear>
        ) : null}

        <Appear index={3} style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Every month</ThemedText>

          {/* "Nothing recurring yet" is a claim about the data: it used to
              show while the bills loaded, and for good when they could not,
              telling a household with rent set up that it had none. */}
          {queryState(recurring, 'your bills') ??
          (rules.length > 0 ? (
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
          ))}
        </Appear>
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
          <ThemedText style={[Type.body, styles.shrink]} numberOfLines={1}>
            {rule.description || rule.categoryName}
          </ThemedText>
          {/* Grey paused; blue "varies" -- information, not a warning. */}
          {!rule.isActive ? (
            <Tag text="Paused" />
          ) : rule.mode === 'confirm' ? (
            <Tag text="Varies" tone="info" />
          ) : null}
        </View>

        <ThemedText themeColor="textTertiary" style={Type.micro}>
          {ordinal(rule.dayOfMonth)} · {rule.paidByName}
        </ThemedText>
      </View>

      {rule.amountPaise ? <ThemedText style={Type.amount}>{formatPaise(rule.amountPaise)}</ThemedText> : null}

      {/* Green tick: posted this month. */}
      {rule.postedThisMonth ? (
        <Ionicons name="checkmark-circle" size={17} color={theme.primary} accessibilityLabel="Posted this month" />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
      ) : null}
    </Pressable>
  );
}

/**
 * A bill waiting on an amount: what it is, then a small amount box and a
 * green Post pill on one line. A fixed-amount bill that was missed has
 * nothing to type, so it shows the pill alone, with the amount on it.
 */
function PostRow({
  rule,
  sub,
  tag,
  typed,
  onType,
  paise,
  loading,
  onPost,
  first,
}: {
  rule: Recurring;
  sub: string;
  tag?: string;
  typed: string;
  onType: (t: string) => void;
  paise: number | null;
  loading: boolean;
  onPost: (paise: number) => void;
  first: boolean;
}) {
  const theme = useTheme();
  // The amount varies, so it's asked for rather than guessed.
  const asks = rule.mode === 'confirm';

  return (
    <View
      style={[
        styles.postRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
      ]}>
      <View style={styles.rowHead}>
        <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText allowFontScaling={false} style={styles.glyph}>
            {iconFor(rule.categoryIcon)}
          </ThemedText>
        </View>
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <ThemedText style={[Type.body, styles.shrink]} numberOfLines={1}>
              {rule.description || rule.categoryName}
            </ThemedText>
            {tag ? <Tag text={tag} tone="warning" /> : null}
          </View>
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            {sub}
          </ThemedText>
        </View>
      </View>

      <View style={styles.postLine}>
        {asks ? (
          <View style={[styles.amountBox, { backgroundColor: theme.backgroundSunken, borderColor: theme.border }]}>
            <ThemedText themeColor="textTertiary" style={styles.currency}>
              ₹
            </ThemedText>
            <TextInput
              value={typed}
              onChangeText={onType}
              placeholder="Amount"
              placeholderTextColor={theme.textTertiary}
              keyboardType="decimal-pad"
              accessibilityLabel={`Amount for ${rule.description || rule.categoryName}`}
              style={[styles.amountInput, { color: theme.text }]}
            />
          </View>
        ) : (
          <View style={styles.flex} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !paise, busy: loading }}
          disabled={!paise || loading}
          onPress={() => paise && onPost(paise)}
          style={({ pressed }) => [
            styles.postPill,
            { backgroundColor: paise ? theme.primarySoft : theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
          ]}>
          {loading ? (
            <ActivityIndicator size="small" color={theme.brandInk} />
          ) : (
            <ThemedText style={[styles.postText, { color: paise ? theme.brandInk : theme.textTertiary }]}>
              {!asks && paise ? `Post ${formatPaise(paise)}` : 'Post'}
            </ThemedText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** A small pill beside a name. */
function Tag({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'info' | 'warning' }) {
  const theme = useTheme();
  const soft = tone === 'info' ? theme.infoSoft : tone === 'warning' ? theme.warningSoft : theme.backgroundSelected;
  const ink = tone === 'info' ? theme.info : tone === 'warning' ? theme.warning : theme.textSecondary;
  return (
    <View style={[styles.pill, { backgroundColor: soft }]}>
      <ThemedText style={[styles.pillText, { color: ink }]}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  // Round, like the other header icons.
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  shrink: { flexShrink: 1 },

  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  heroAmount: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -1 },

  section: { gap: Spacing.two },
  // Sentence case at heading size, as on Settle up and History.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },

  postRow: { gap: Spacing.two + 2, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  postLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amountBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    minHeight: 40,
  },
  currency: { fontSize: 15, fontWeight: '600' },
  amountInput: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600', padding: 0 },
  postPill: {
    minHeight: 36,
    paddingHorizontal: Spacing.three + 2,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pill: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  pillText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
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
