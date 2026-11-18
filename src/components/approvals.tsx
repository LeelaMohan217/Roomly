import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { categoryColor, categoryIcon, categoryTint } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useAwaitingApproval, usePendingChanges } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type JoinRequest = {
  id: string;
  display_name: string;
  email: string | null;
  claim_member_id: string | null;
};

/**
 * Everything waiting for this member's yes or no: housemates' new expenses
 * they may review, and -- for the owner -- change requests and join requests.
 * Home shows the first two under "Needs you"; the Approvals page shows them
 * all. Both use this, so the buttons and their confirmations are one thing.
 */
export function useApprovals() {
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const awaiting = useAwaitingApproval();
  const changes = usePendingChanges();
  const requests = useQuery({
    queryKey: ['join-requests'],
    enabled: !!member && isOwner,
    queryFn: async (): Promise<JoinRequest[]> => {
      const { data, error } = await supabase
        .from('join_requests')
        .select('id, display_name, email, claim_member_id')
        .eq('status', 'pending')
        .order('requested_at');
      if (error) throw error;
      return data as JoinRequest[];
    },
  });

  const failed = (e: unknown) =>
    void dialog.alert({ tone: 'danger', title: 'That didn’t go through', message: humanError(e) });

  // A housemate's new expense, which counts nowhere until someone other than
  // whoever added it says yes (migration 0039).
  const reviewExpense = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_expense', {
        p_expense: id,
        p_approve: approve,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: (_, { approve }) => {
      dialog.toast(
        approve
          ? { message: 'Approved. It counts now.' }
          : { message: 'Rejected. It won’t count.', tone: 'info' }
      );
      return queryClient.invalidateQueries();
    },
    onError: failed,
  });

  const reviewChange = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_pending_change', {
        p_change: id,
        p_approve: approve,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: (_, { approve }) => {
      dialog.toast(
        approve ? { message: 'Change approved' } : { message: 'Change rejected', tone: 'info' }
      );
      return queryClient.invalidateQueries();
    },
    onError: failed,
  });

  const reviewJoin = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_join_request', {
        p_request: id,
        p_approve: approve,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: (_, { approve }) => {
      dialog.toast(
        approve
          ? { message: 'Request approved. They’re in the household.' }
          : { message: 'Request declined', tone: 'info' }
      );
      return queryClient.invalidateQueries();
    },
    onError: failed,
  });

  async function rejectExpense(id: string) {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'close-circle-outline',
      title: 'Reject this expense?',
      message: 'It won’t count towards anyone’s balance, and stays in History marked rejected.',
      confirmLabel: 'Reject',
    });
    if (ok) reviewExpense.mutate({ id, approve: false });
  }

  async function rejectChange(id: string, kind: string) {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'close-circle-outline',
      title: kind === 'void' ? 'Keep the expense?' : 'Reject this change?',
      message:
        kind === 'void'
          ? 'The expense stays as it is, and whoever asked is told you said no.'
          : 'The expense stays as it was, and whoever asked is told you said no.',
      confirmLabel: 'Reject',
    });
    if (ok) reviewChange.mutate({ id, approve: false });
  }

  async function declineJoin(id: string, name: string) {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'person-remove-outline',
      title: `Decline ${name}?`,
      message: 'They won’t join the household. They can ask again with a new invite.',
      confirmLabel: 'Decline',
    });
    if (ok) reviewJoin.mutate({ id, approve: false });
  }

  const expenses = (awaiting.data ?? []).filter((e) => e.canReview);
  const changeList = isOwner ? (changes.data ?? []) : [];
  const joinList = isOwner ? (requests.data ?? []) : [];

  // One list, in the order they are shown: new expenses, changes, joins.
  const items: ApprovalItem[] = [
    ...expenses.map((e) => ({ kind: 'expense' as const, id: e.id, expense: e })),
    ...changeList.map((c) => ({ kind: 'change' as const, id: c.id, change: c })),
    ...joinList.map((r) => ({ kind: 'join' as const, id: r.id, request: r })),
  ];

  return {
    items,
    count: items.length,
    loading: awaiting.isLoading,
    actions: {
      reviewExpense,
      reviewChange,
      reviewJoin,
      rejectExpense,
      rejectChange,
      declineJoin,
    },
  };
}

type Approvals = ReturnType<typeof useApprovals>;
type AwaitingExpense = NonNullable<ReturnType<typeof useAwaitingApproval>['data']>[number];
type PendingChange = NonNullable<ReturnType<typeof usePendingChanges>['data']>[number];

export type ApprovalItem =
  | { kind: 'expense'; id: string; expense: AwaitingExpense }
  | { kind: 'change'; id: string; change: PendingChange }
  | { kind: 'join'; id: string; request: JoinRequest };

/** The cards themselves, each with Approve and Reject. `limit` shows only the first few. */
export function ApprovalCards({ approvals, limit }: { approvals: Approvals; limit?: number }) {
  const { items, actions } = approvals;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <>
      {shown.map((item) => (
        <ApprovalCard key={`${item.kind}-${item.id}`} item={item} actions={actions} />
      ))}
    </>
  );
}

/**
 * Home's version: a slim card each, with small round ✓ and ✕
 * buttons instead of full-width Approve and Reject. Tapping the row opens
 * the expense; Reject still asks first.
 */
export function ApprovalRows({ approvals, limit }: { approvals: Approvals; limit: number }) {
  const { items, actions } = approvals;
  return (
    <View style={styles.rows}>
      {items.slice(0, limit).map((item) => (
        <Card key={`${item.kind}-${item.id}`} padded={false}>
          <ApprovalRow item={item} actions={actions} />
        </Card>
      ))}
    </View>
  );
}

function ApprovalRow({ item, actions }: { item: ApprovalItem; actions: Approvals['actions'] }) {
  const theme = useTheme();
  const router = useRouter();

  let title: string;
  let sub: string;
  let tile: React.ReactNode;
  let onOpen: (() => void) | undefined;
  let busy: boolean;
  let approve: () => void;
  let reject: () => void;

  if (item.kind === 'expense') {
    const e = item.expense;
    title = `${e.createdByName} added ${formatPaise(e.totalPaise)}`;
    sub = `${e.description || e.categoryName} · paid by ${e.paidByName}`;
    tile = (
      <View style={[styles.rowTile, { backgroundColor: categoryTint(e.categoryIcon) }]}>
        <Icon name={categoryIcon(e.categoryIcon)} size={16} color={categoryColor(e.categoryIcon)} />
      </View>
    );
    onOpen = () => router.push({ pathname: '/expense/[id]', params: { id: e.id } });
    busy = actions.reviewExpense.isPending;
    approve = () => actions.reviewExpense.mutate({ id: e.id, approve: true });
    reject = () => void actions.rejectExpense(e.id);
  } else if (item.kind === 'change') {
    const c = item.change;
    title = `${c.requestedByName} wants to ${c.kind === 'void' ? 'delete' : 'change'} an expense`;
    sub =
      c.kind === 'update' && typeof c.payload.total_paise === 'number'
        ? `New amount ${formatPaise(c.payload.total_paise)}`
        : 'Tap to review';
    tile = (
      <View style={[styles.rowTile, { backgroundColor: theme.warningSoft }]}>
        <Icon
          name={c.kind === 'void' ? 'trash-outline' : 'create-outline'}
          size={16}
          color={theme.warning}
        />
      </View>
    );
    onOpen = () => router.push({ pathname: '/expense/[id]', params: { id: c.entityId } });
    busy = actions.reviewChange.isPending;
    approve = () => actions.reviewChange.mutate({ id: c.id, approve: true });
    reject = () => void actions.rejectChange(c.id, c.kind);
  } else {
    const r = item.request;
    title = `${r.display_name} wants to join`;
    sub = r.email ?? 'no email';
    tile = <Avatar name={r.display_name} seed={r.id} size={32} />;
    onOpen = undefined;
    busy = actions.reviewJoin.isPending;
    approve = () => actions.reviewJoin.mutate({ id: r.id, approve: true });
    reject = () => void actions.declineJoin(r.id, r.display_name);
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.6 : 1 }]}>
        {tile}
        <View style={styles.flex}>
          <ThemedText style={[Type.body, styles.semi]} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
            {sub}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reject"
        onPress={reject}
        disabled={busy}
        hitSlop={6}
        // See-through: just an outline and the mark, in red.
        style={({ pressed }) => [
          styles.round,
          { borderColor: `${theme.danger}66`, opacity: busy ? 0.4 : pressed ? 0.6 : 1 },
        ]}>
        <Icon name="close" size={17} color={theme.danger} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Approve"
        onPress={approve}
        disabled={busy}
        hitSlop={6}
        // See-through: just an outline and the tick, in green.
        style={({ pressed }) => [
          styles.round,
          { borderColor: `${theme.primary}88`, opacity: busy ? 0.4 : pressed ? 0.6 : 1 },
        ]}>
        <Icon name="checkmark" size={17} color={theme.primary} />
      </Pressable>
    </View>
  );
}

function ApprovalCard({ item, actions }: { item: ApprovalItem; actions: Approvals['actions'] }) {
  const theme = useTheme();
  const router = useRouter();

  if (item.kind === 'expense') {
    const e = item.expense;
    const { reviewExpense, rejectExpense } = actions;
    const busy = reviewExpense.isPending && reviewExpense.variables?.id === e.id;
    return (
      <Card style={styles.approval}>
        <Pressable
          onPress={() => router.push({ pathname: '/expense/[id]', params: { id: e.id } })}
          style={styles.approvalHead}>
          <View style={[styles.tile, { backgroundColor: categoryTint(e.categoryIcon) }]}>
            <Icon name={categoryIcon(e.categoryIcon)} size={18} color={categoryColor(e.categoryIcon)} />
          </View>
          <View style={styles.flex}>
            <ThemedText style={Type.headline}>
              {e.createdByName} added {formatPaise(e.totalPaise)}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.caption} numberOfLines={1}>
              {e.description || e.categoryName} · paid by {e.paidByName} · tap to review
            </ThemedText>
          </View>
        </Pressable>
        <View style={styles.approvalActions}>
          <Button
            title="Approve"
            onPress={() => reviewExpense.mutate({ id: e.id, approve: true })}
            loading={busy}
            disabled={reviewExpense.isPending}
            style={styles.flex}
          />
          <Button
            title="Reject"
            variant="ghost"
            onPress={() => void rejectExpense(e.id)}
            disabled={reviewExpense.isPending}
            style={styles.flex}
          />
        </View>
      </Card>
    );
  }

  if (item.kind === 'change') {
    const c = item.change;
    const { reviewChange, rejectChange } = actions;
    return (
      <Card style={styles.approval}>
        <Pressable
          onPress={() => router.push({ pathname: '/expense/[id]', params: { id: c.entityId } })}
          style={styles.approvalHead}>
          <View style={[styles.tile, { backgroundColor: theme.warningSoft }]}>
            <Icon
              name={c.kind === 'void' ? 'trash-outline' : 'create-outline'}
              size={18}
              color={theme.warning}
            />
          </View>
          <View style={styles.flex}>
            <ThemedText style={Type.headline}>
              {c.requestedByName} wants to{' '}
              {c.kind === 'void' ? 'delete an expense' : 'change an expense'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.caption}>
              {c.kind === 'update' && typeof c.payload.total_paise === 'number'
                ? `New amount ${formatPaise(c.payload.total_paise)} · tap to review`
                : 'Tap to review'}
            </ThemedText>
          </View>
        </Pressable>
        <View style={styles.approvalActions}>
          <Button
            title="Approve"
            onPress={() => reviewChange.mutate({ id: c.id, approve: true })}
            loading={reviewChange.isPending && reviewChange.variables?.id === c.id}
            disabled={reviewChange.isPending}
            style={styles.flex}
          />
          <Button
            title="Reject"
            variant="ghost"
            onPress={() => void rejectChange(c.id, c.kind)}
            disabled={reviewChange.isPending}
            style={styles.flex}
          />
        </View>
      </Card>
    );
  }

  const r = item.request;
  const { reviewJoin, declineJoin } = actions;
  return (
    <Card style={styles.approval}>
      <View style={styles.approvalHead}>
        <Avatar name={r.display_name} seed={r.id} size={36} />
        <View style={styles.flex}>
          <ThemedText style={Type.headline}>{r.display_name} wants to join</ThemedText>
          <ThemedText themeColor="textSecondary" style={Type.caption}>
            {r.email ?? 'no email'}
          </ThemedText>
        </View>
      </View>
      <View style={styles.approvalActions}>
        <Button
          title="Approve"
          onPress={() => reviewJoin.mutate({ id: r.id, approve: true })}
          loading={reviewJoin.isPending && reviewJoin.variables?.id === r.id}
          disabled={reviewJoin.isPending}
          style={styles.flex}
        />
        <Button
          title="Reject"
          variant="ghost"
          onPress={() => void declineJoin(r.id, r.display_name)}
          disabled={reviewJoin.isPending}
          style={styles.flex}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  rows: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowTile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  round: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approval: { gap: Spacing.three },
  approvalHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  approvalActions: { flexDirection: 'row', gap: Spacing.two },
  tile: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
