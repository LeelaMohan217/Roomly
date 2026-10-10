import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpenseForm, type ExpenseFormValues } from '@/components/expense-form';
import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { formatRange } from '@/lib/dates';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useExpense, useMembers, usePendingChanges } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ExpenseDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const expense = useExpense(id);
  const members = useMembers();
  const pending = usePendingChanges();

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const e = expense.data;

  /**
   * Answered by the server, not re-derived here — `can_edit_now` is the same
   * SQL function the RLS policy uses, so a button that appears will work and a
   * button that is hidden would have been refused.
   *
   * The owner is always inside this; a member is inside it for
   * households.self_edit_minutes after creating the expense. Outside it, every
   * change still goes through pending_changes.
   */
  const canEditNow = e?.canEditDirectly ?? false;
  const locked = e?.periodStatus === 'closed';
  const pendingOnThis = pending.data?.find((c) => c.entityId === id) ?? null;
  const nameOf = (mid: string) => members.data?.find((m) => m.id === mid)?.displayName ?? '—';

  /**
   * Members can't rewrite the ledger directly — they raise a change for the
   * owner. The owner edits straight through, because approving your own edit
   * is theatre.
   */
  async function submit(values: ExpenseFormValues) {
    setError(null);
    setBusy(true);

    const splits = values.splits.map((s) => ({
      member_id: s.memberId,
      amount_paise: s.amountPaise,
    }));

    if (canEditNow) {
      const { error: rpcError } = await supabase.rpc('update_expense', {
        p_expense: id,
        p_total_paise: values.amountPaise,
        p_category: values.categoryId,
        p_expense_date: values.date,
        p_paid_by: values.paidBy,
        p_splits: splits,
        p_description: values.description.trim() || null,
        p_payment_method: null,
      });
      if (rpcError) {
        // humanError, not the raw message. This is the most-used write after
        // Add, and it was one of the places that went around errors.ts —
        // "new row violates row-level security policy for table \"expenses\""
        // is not something to show a flatmate.
        setError(humanError(rpcError));
        setBusy(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from('pending_changes').insert({
        household_id: member!.household_id,
        entity_type: 'expense',
        entity_id: id,
        kind: 'update',
        payload: {
          total_paise: values.amountPaise,
          category_id: values.categoryId,
          expense_date: values.date,
          description: values.description.trim() || null,
          splits,
        },
        requested_by: member!.id,
      });
      if (insertError) {
        setError(
          insertError.code === '23505'
            ? 'There is already a change waiting on this expense.'
            : humanError(insertError)
        );
        setBusy(false);
        return;
      }
    }

    await queryClient.invalidateQueries();
    setBusy(false);
    setEditing(false);
  }

  const remove = useMutation({
    mutationFn: async () => {
      if (canEditNow) {
        const { error: rpcError } = await supabase.rpc('void_expense', {
          p_expense: id,
          p_reason: null,
        });
        if (rpcError) throw rpcError;
      } else {
        const { error: insertError } = await supabase.from('pending_changes').insert({
          household_id: member!.household_id,
          entity_type: 'expense',
          entity_id: id,
          kind: 'void',
          payload: {},
          requested_by: member!.id,
        });
        if (insertError) throw insertError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      if (canEditNow) router.back();
    },
    onError: (err) => setError(humanError(err)),
  });

  /**
   * Restoring used to be a bare `await supabase.rpc(...)` with the result
   * discarded and no loading state — so on a closed month, or offline, the
   * button simply did nothing, twice, forever.
   */
  const restore = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await supabase.rpc('unvoid_expense', { p_expense: id });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (err) => setError(humanError(err)),
  });

  function confirmRemove() {
    Alert.alert(
      canEditNow ? 'Delete this expense?' : 'Request deletion?',
      canEditNow
        ? 'It stays in the history as deleted, and drops out of everyone’s balance.'
        : 'The owner has to approve before it is removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: canEditNow ? 'Delete' : 'Request',
          style: canEditNow ? 'destructive' : 'default',
          onPress: () => remove.mutate(),
        },
      ]
    );
  }

  if (!e) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Expense" />
        <View style={styles.centeredFill}>
          <ThemedText themeColor="textSecondary" style={Type.body}>
            {expense.isLoading ? 'Loading…' : 'Expense not found.'}
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  const excluded = (members.data ?? []).filter((m) => !e.splits.some((s) => s.memberId === m.id));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ScreenHeader
          title={editing ? 'Edit expense' : 'Expense'}
          action={
            editing ? (
              <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} />
            ) : undefined
          }
        />

        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          {editing ? (
            <ExpenseForm
              submitLabel={canEditNow ? 'Save' : 'Request change of'}
              onSubmit={submit}
              busy={busy}
              error={error}
              initial={{
                amount: String(e.totalPaise / 100),
                categoryId: e.categoryId,
                description: e.description ?? '',
                paidBy: e.paidBy,
                date: e.expenseDate,
                participants: e.splits.map((s) => s.memberId),
              }}
            />
          ) : (
            <>
              <Card style={styles.hero}>
                <View style={[styles.heroTile, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText allowFontScaling={false} style={styles.heroGlyph}>{iconFor(e.categoryIcon)}</ThemedText>
                </View>
                <ThemedText style={Type.display} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatPaise(e.totalPaise)}</ThemedText>
                <ThemedText style={Type.body}>{e.description || e.categoryName}</ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {e.categoryName} · {formatRange(e.expenseDate, e.expenseDate)}
                </ThemedText>
              </Card>

              {e.voidedAt ? (
                <Notice
                  tone="danger"
                  icon="trash-outline"
                  title="Deleted"
                  body={`It no longer counts towards anyone's balance.${e.voidReason ? ` Reason: ${e.voidReason}` : ''}`}
                />
              ) : null}

              {locked ? (
                <Notice
                  tone="neutral"
                  icon="lock-closed-outline"
                  title="This month is closed"
                  body="Settled months are frozen. If this genuinely needs correcting, the owner can reopen the month from its statement — Settle up, then the month, then Reopen."
                />
              ) : null}

              {pendingOnThis ? (
                <Notice
                  tone="primary"
                  icon="time-outline"
                  title="Change awaiting approval"
                  body={`${pendingOnThis.requestedByName} asked to ${
                    pendingOnThis.kind === 'void' ? 'delete this' : 'change this'
                  }. The figures below are still the ones that count until the owner approves.`}
                />
              ) : null}

              <Section title={`SPLIT BETWEEN (${e.splits.length})`}>
                <Card padded={false}>
                  {e.splits.map((s, i) => (
                    <View
                      key={s.memberId}
                      style={[
                        styles.row,
                        (i < e.splits.length - 1 || excluded.length > 0) && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: theme.border,
                        },
                      ]}>
                      <Avatar name={nameOf(s.memberId)} seed={s.memberId} size={36} />
                      <View style={styles.flex}>
                        <ThemedText style={Type.body}>{nameOf(s.memberId)}</ThemedText>
                        {s.memberId === e.paidBy ? (
                          <ThemedText style={[Type.micro, { color: theme.primary }]}>
                            paid for this
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText style={Type.amount}>{formatPaise(s.amountPaise)}</ThemedText>
                    </View>
                  ))}

                  {excluded.map((m, i) => (
                    <View
                      key={m.id}
                      style={[
                        styles.row,
                        i < excluded.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: theme.border,
                        },
                      ]}>
                      <Avatar name={m.displayName} seed={m.id} size={36} style={styles.dim} />
                      <View style={styles.flex}>
                        <ThemedText
                          themeColor="textTertiary"
                          style={[Type.body, styles.struck]}>
                          {m.displayName}
                        </ThemedText>
                      </View>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        not included
                      </ThemedText>
                    </View>
                  ))}
                </Card>
              </Section>

              <Section title="DETAILS">
                <Card padded={false}>
                  <Detail label="Paid by" value={e.paidByName} />
                  <Detail label="Added by" value={e.createdByName} />
                  <Detail
                    label="Added on"
                    value={new Date(e.createdAt).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    last
                  />
                </Card>
              </Section>

              {error ? (
                <Notice tone="danger" icon="alert-circle-outline" title="Error" body={error} />
              ) : null}

              {!e.voidedAt && !locked && !pendingOnThis ? (
                <View style={styles.actions}>
                  <Button
                    title={canEditNow ? 'Edit' : 'Request a change'}
                    onPress={() => setEditing(true)}
                    style={styles.flex}
                  />
                  <Button
                    title={canEditNow ? 'Delete' : 'Request delete'}
                    variant="danger"
                    onPress={confirmRemove}
                    loading={remove.isPending}
                    style={styles.flex}
                  />
                </View>
              ) : null}

              {e.voidedAt && canEditNow && !locked ? (
                <Button
                  title="Restore this expense"
                  variant="secondary"
                  loading={restore.isPending}
                  onPress={() => restore.mutate()}
                />
              ) : null}
            </>
          )}
        </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function Notice({
  tone,
  icon,
  title,
  body,
}: {
  tone: 'danger' | 'primary' | 'neutral';
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const theme = useTheme();
  const bg =
    tone === 'danger'
      ? theme.dangerSoft
      : tone === 'primary'
        ? theme.primarySoft
        : theme.backgroundSunken;
  const fg = tone === 'danger' ? theme.danger : tone === 'primary' ? theme.primary : theme.text;

  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={16} color={fg} />
      <View style={styles.flex}>
        <ThemedText style={[Type.caption, styles.semi, { color: fg }]}>{title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={Type.micro}>
          {body}
        </ThemedText>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText themeColor="textTertiary" style={Type.label}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function Detail({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
      ]}>
      <ThemedText themeColor="textSecondary" style={[Type.body, styles.flex]}>
        {label}
      </ThemedText>
      <ThemedText style={Type.body}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centeredFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  semi: { fontWeight: '700' },
  dim: { opacity: 0.4 },
  struck: { textDecorationLine: 'line-through' },

  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five },
  heroTile: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  heroGlyph: { fontSize: 26 },

  notice: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },

  section: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
