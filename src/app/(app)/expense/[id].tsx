import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpensePhotos, useExpenseAttachments } from '@/components/bill-photos';
import { ExpenseForm, type ExpenseFormValues } from '@/components/expense-form';
import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDialog, type Tone } from '@/components/ui/dialog';
import { Appear } from '@/components/ui/motion';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MAX_PHOTOS, uploadBillPhotos } from '@/lib/attachments';
import { humanError } from '@/lib/errors';
import { formatRange } from '@/lib/dates';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useExpense, useMembers, usePendingChanges } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ExpenseDetailScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const expense = useExpense(id);
  const members = useMembers();
  const pending = usePendingChanges();
  const attachments = useExpenseAttachments(id);

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

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

    // Photos need no approval -- they move no money -- so they go straight
    // on, whether the edit itself was saved or only requested.
    if (values.photos.length > 0) {
      const { failed, reason } = await uploadBillPhotos(member!.household_id, member!.id, id, values.photos);
      if (failed > 0) {
        void dialog.alert({
          tone: 'warning',
          icon: 'image-outline',
          title: 'Not every photo uploaded',
          message: `${failed === 1 ? 'One photo' : `${failed} photos`} did not upload${reason ? ` (${reason})` : ''}. Try adding ${failed === 1 ? 'it' : 'them'} again below.`,
        });
      }
    }

    await queryClient.invalidateQueries();
    setBusy(false);
    setEditing(false);
  }

  /**
   * Approve or reject a housemate's expense (migration 0039). The server
   * decides who may -- e.canReview is its answer -- and rejecting voids it, as
   * a rejected payment is.
   */
  const review = useMutation({
    mutationFn: async ({ approve, note }: { approve: boolean; note: string | null }) => {
      const { error: rpcError } = await supabase.rpc('review_expense', {
        p_expense: id,
        p_approve: approve,
        p_note: note,
      });
      if (rpcError) throw rpcError;
    },
    onMutate: () => setError(null),
    onSuccess: (_, { approve }) => {
      setRejecting(false);
      setRejectNote('');
      dialog.toast({
        message: approve ? 'Approved. It counts now.' : 'Rejected. It won’t count.',
        tone: approve ? 'success' : 'info',
      });
      // Returned, so the buttons stay busy until the expense shows its new
      // state, rather than inviting a second tap the server would refuse.
      return queryClient.invalidateQueries();
    },
    onError: (err) => {
      setRejecting(false);
      setError(humanError(err));
    },
  });

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
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err) => setError(humanError(err)),
  });

  async function confirmRemove() {
    // Red when it happens now; amber when it is only a request the owner
    // still has to approve.
    const ok = await dialog.confirm(
      canEditNow
        ? {
            tone: 'danger',
            icon: 'trash-outline',
            title: 'Delete this expense?',
            message: 'It stays in the history as deleted, and drops out of everyone’s balance.',
            confirmLabel: 'Delete',
          }
        : {
            tone: 'warning',
            icon: 'hand-left-outline',
            title: 'Request deletion?',
            message: 'The owner has to approve before it is removed.',
            confirmLabel: 'Send request',
          }
    );
    if (ok) remove.mutate();
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
  const actionable = !e.voidedAt && !locked && !pendingOnThis;

  // Each notice is one line; the full story is a tap away, in a popup, so the
  // expense itself stays at the top of the screen.
  const explain = (tone: Tone, icon: keyof typeof Ionicons.glyphMap, title: string, message: string) =>
    void dialog.alert({ tone, icon, title, message });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        {/* Edit and delete live in the header as icons: two full-width buttons
            at the bottom were the loudest thing on a screen you mostly read.
            A member outside the edit window gets the same icons, which send a
            request instead -- the labels say so to a screen reader, and the
            confirm popup says so to everyone. */}
        <ScreenHeader
          title={editing ? 'Edit expense' : 'Expense'}
          action={
            editing ? (
              <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} />
            ) : actionable ? (
              <View style={styles.headerIcons}>
                <HeaderIcon
                  icon="pencil-outline"
                  label={canEditNow ? 'Edit' : 'Request a change'}
                  onPress={() => setEditing(true)}
                />
                <HeaderIcon
                  icon="trash-outline"
                  label={canEditNow ? 'Delete' : 'Request delete'}
                  danger
                  busy={remove.isPending}
                  onPress={confirmRemove}
                />
              </View>
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
              photoRoom={attachments.data ? MAX_PHOTOS - attachments.data.length : undefined}
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
              {/* The expense itself, on the page rather than in a card: it is
                  the whole point of the screen, and a box around it only
                  added an edge. */}
              <Appear index={0} style={styles.hero}>
                <View style={[styles.heroTile, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText allowFontScaling={false} style={styles.heroGlyph}>{iconFor(e.categoryIcon)}</ThemedText>
                </View>
                <ThemedText
                  style={[styles.heroAmount, e.voidedAt ? { color: theme.textTertiary } : null]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {formatPaise(e.totalPaise)}
                </ThemedText>
                <ThemedText style={[Type.body, styles.centered]}>{e.description || e.categoryName}</ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.caption}>
                  {e.categoryName} · {formatRange(e.expenseDate, e.expenseDate)}
                </ThemedText>
              </Appear>

              {e.approvalStatus === 'rejected' ? (
                <Appear index={1}>
                <Note
                  tone="danger"
                  icon="close-circle-outline"
                  text={`Rejected${e.reviewedByName ? ` by ${e.reviewedByName}` : ''}`}
                  onPress={() =>
                    explain(
                      'danger',
                      'close-circle-outline',
                      'Rejected',
                      `It never counted towards anyone's balance.${e.voidReason ? ` Reason: ${e.voidReason}` : ''}${
                        canEditNow && !locked
                          ? ' If it was a mistake, you can send it for approval again below.'
                          : ''
                      }`
                    )
                  }
                />
                </Appear>
              ) : e.voidedAt ? (
                <Appear index={1}>
                <Note
                  tone="danger"
                  icon="trash-outline"
                  text="Deleted"
                  onPress={() =>
                    explain(
                      'danger',
                      'trash-outline',
                      'Deleted',
                      `It no longer counts towards anyone's balance.${e.voidReason ? ` Reason: ${e.voidReason}` : ''}`
                    )
                  }
                />
                </Appear>
              ) : null}

              {e.approvalStatus === 'pending' && !e.voidedAt ? (
                <Appear index={2}>
                <Note
                  tone="warning"
                  icon="time-outline"
                  text={e.canReview ? 'Waiting for your approval' : 'Waiting for approval'}
                  onPress={() =>
                    explain(
                      'warning',
                      'time-outline',
                      'Waiting for approval',
                      e.createdBy === member?.id
                        ? 'It doesn’t count towards anyone’s balance yet. Someone else in the split has to approve it first.'
                        : 'It doesn’t count towards anyone’s balance until someone other than the person who added it approves it.'
                    )
                  }
                />
                </Appear>
              ) : null}

              {/* The approver's place to answer, right under the notice that
                  asks: Home's "Needs you" card leads here too. */}
              {e.canReview ? (
                <Appear index={3} style={styles.reviewActions}>
                  <Button
                    title="Approve"
                    onPress={() => review.mutate({ approve: true, note: null })}
                    loading={review.isPending && review.variables?.approve === true}
                    disabled={review.isPending}
                    style={styles.flex}
                  />
                  <Button
                    title="Reject"
                    variant="ghost"
                    onPress={() => setRejecting(true)}
                    disabled={review.isPending}
                    style={styles.flex}
                  />
                </Appear>
              ) : null}

              {locked ? (
                <Appear index={4}>
                <Note
                  tone="neutral"
                  icon="lock-closed-outline"
                  text="This month is closed"
                  onPress={() =>
                    explain(
                      'info',
                      'lock-closed-outline',
                      'This month is closed',
                      'Settled months are frozen. If this genuinely needs correcting, the owner can reopen the month from its statement — Settle up, then the month, then Reopen.'
                    )
                  }
                />
                </Appear>
              ) : null}

              {pendingOnThis ? (
                <Appear index={5}>
                <Note
                  tone="warning"
                  icon="time-outline"
                  text={`${pendingOnThis.requestedByName} asked to ${
                    pendingOnThis.kind === 'void' ? 'delete' : 'change'
                  } this`}
                  onPress={() =>
                    explain(
                      'warning',
                      'time-outline',
                      'Waiting for the owner',
                      'The figures here are still the ones that count until the owner approves.'
                    )
                  }
                />
                </Appear>
              ) : null}

              <Appear index={6} style={styles.section}>
                <ThemedText style={styles.sectionTitle}>Split between {e.splits.length}</ThemedText>
                <Card padded={false}>
                  {e.splits.map((s, i) => (
                    <View
                      key={s.memberId}
                      accessible
                      accessibilityLabel={`${nameOf(s.memberId)}${s.memberId === e.paidBy ? ', paid' : ''}, ${formatPaise(s.amountPaise)}`}
                      style={[
                        styles.row,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      ]}>
                      <Avatar name={nameOf(s.memberId)} seed={s.memberId} size={32} />
                      <View style={[styles.flex, styles.nameRow]}>
                        <ThemedText style={Type.body} numberOfLines={1}>
                          {nameOf(s.memberId)}
                        </ThemedText>
                        {/* Green: this person's money went out for everyone. */}
                        {s.memberId === e.paidBy ? (
                          <View style={[styles.tag, { backgroundColor: theme.primarySoft }]}>
                            <ThemedText style={[styles.tagText, { color: theme.brandInk }]}>Paid</ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <ThemedText style={Type.amount}>{formatPaise(s.amountPaise)}</ThemedText>
                    </View>
                  ))}
                </Card>
                {/* One quiet line rather than a struck-through row each. */}
                {excluded.length > 0 ? (
                  <ThemedText themeColor="textTertiary" style={[Type.caption, styles.aside]}>
                    Not in this: {excluded.map((m) => m.displayName).join(', ')}
                  </ThemedText>
                ) : null}
                {/* The payer is a housemate outside the split -- paid for the
                    others, owes nothing of it. Said here, since no row above
                    carries the tag. */}
                {!e.splits.some((s) => s.memberId === e.paidBy) ? (
                  <ThemedText themeColor="textTertiary" style={[Type.caption, styles.aside]}>
                    Paid by {e.paidByName}
                  </ThemedText>
                ) : null}
              </Appear>

              <Appear index={7}>
              <Card padded={false}>
                <View
                  accessible
                  accessibilityLabel={`Added by ${e.createdByName}, ${addedOn(e.createdAt)}`}
                  style={styles.row}>
                  <Ionicons name="person-add-outline" size={17} color={theme.textSecondary} />
                  <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                    Added by {e.createdByName}
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.caption}>
                    {addedOn(e.createdAt)}
                  </ThemedText>
                </View>
                {/* Only when a person approved it: automatic approvals and
                    everything from before approvals existed have no name. */}
                {e.approvalStatus === 'approved' && e.reviewedByName && e.reviewedAt ? (
                  <View
                    accessible
                    accessibilityLabel={`Approved by ${e.reviewedByName}, ${addedOn(e.reviewedAt)}`}
                    style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                    <Ionicons name="checkmark-circle-outline" size={17} color={theme.textSecondary} />
                    <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                      Approved by {e.reviewedByName}
                    </ThemedText>
                    <ThemedText themeColor="textTertiary" style={Type.caption}>
                      {addedOn(e.reviewedAt)}
                    </ThemedText>
                  </View>
                ) : null}
              </Card>
              </Appear>

              <Appear index={8}>
                <ExpensePhotos expenseId={id} canAdd={!e.voidedAt} />
              </Appear>

              {error ? (
                <Appear index={9}>
                  <Note tone="danger" icon="alert-circle-outline" text={error} />
                </Appear>
              ) : null}

              {/* Restoring a rejected expense sends it back for approval
                  rather than straight into the balances (0039). */}
              {e.voidedAt && canEditNow && !locked ? (
                <Appear index={10}>
                <Button
                  title={e.approvalStatus === 'rejected' ? 'Send for approval again' : 'Restore this expense'}
                  variant="secondary"
                  loading={restore.isPending}
                  onPress={() => restore.mutate()}
                />
                </Appear>
              ) : null}
            </>
          )}
        </KeyboardAwareScrollView>

        <Sheet
          visible={rejecting}
          title="Reject this expense?"
          subtitle="It won’t count towards anyone’s balance, and stays in History marked rejected."
          onClose={() => setRejecting(false)}>
          <View style={styles.rejectSheet}>
            <TextInput
              value={rejectNote}
              onChangeText={setRejectNote}
              placeholder="Why? (optional)"
              placeholderTextColor={theme.textTertiary}
              accessibilityLabel="Reason for rejecting"
              maxLength={200}
              multiline
              style={[
                Type.body,
                styles.rejectInput,
                { color: theme.text, backgroundColor: theme.backgroundSunken, borderColor: theme.border },
              ]}
            />
            <Button
              title="Reject"
              variant="danger"
              loading={review.isPending}
              onPress={() => review.mutate({ approve: false, note: rejectNote.trim() || null })}
            />
          </View>
        </Sheet>
    </SafeAreaView>
  );
}

/** "25 Oct, 9:14 pm" -- when the expense was entered, not the day it is for. */
function addedOn(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * One tinted line, Home's notice: red deleted or failed, yellow waiting on
 * someone, grey for a closed month. Tappable when there is more to say.
 */
function Note({
  tone,
  icon,
  text,
  onPress,
}: {
  tone: 'danger' | 'warning' | 'neutral';
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const soft =
    tone === 'danger' ? theme.dangerSoft : tone === 'warning' ? theme.warningSoft : theme.backgroundSunken;
  const ink =
    tone === 'danger' ? theme.danger : tone === 'warning' ? theme.warning : theme.textSecondary;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.note, { backgroundColor: soft, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={16} color={ink} />
      <ThemedText style={[Type.caption, styles.medium, styles.flex, { color: ink }]}>{text}</ThemedText>
      {onPress ? <Ionicons name="chevron-forward" size={14} color={ink} /> : null}
    </Pressable>
  );
}

/** A round icon button for the header, the same size as the back button. */
function HeaderIcon({
  icon,
  label,
  onPress,
  danger = false,
  busy = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  const theme = useTheme();
  const ink = danger ? theme.danger : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.headerIcon,
        {
          backgroundColor: danger ? theme.dangerSoft : theme.backgroundElement,
          borderColor: danger ? theme.dangerSoft : theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      {busy ? <ActivityIndicator size="small" color={ink} /> : <Ionicons name={icon} size={18} color={ink} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centeredFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  medium: { fontWeight: '500' },
  centered: { textAlign: 'center' },

  headerIcons: { flexDirection: 'row', gap: Spacing.two },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  hero: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  heroTile: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  heroGlyph: { fontSize: 24 },
  heroAmount: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -1 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },

  reviewActions: { flexDirection: 'row', gap: Spacing.two },
  rejectSheet: { gap: Spacing.three },
  rejectInput: {
    minHeight: 72,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    textAlignVertical: 'top',
  },

  section: { gap: Spacing.two },
  // Sentence case at heading size, as on Settle up and History.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  aside: { paddingHorizontal: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tag: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  tagText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
});
