import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';
import { useNotifications, type AppNotification } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

/** Wording lives here, not in SQL — money formatting has one home. */
function describe(n: AppNotification): { title: string; detail: string } {
  const who = n.actorName ?? 'Someone';
  const amount = n.amountPaise !== null ? formatPaise(n.amountPaise) : '';

  switch (n.kind) {
    case 'expense_added':
      return { title: `${who} added ${n.subject}`, detail: amount };
    case 'expense_changed':
      return { title: `${who} changed ${n.subject}`, detail: `now ${amount}` };
    case 'expense_deleted':
      return { title: `${who} deleted ${n.subject}`, detail: amount };
    case 'settlement': {
      const [from, to] = (n.subject ?? '').split(' -> ');
      return { title: `${from} paid ${to}`, detail: amount };
    }
    case 'settlement_pending': {
      const [from, to] = (n.subject ?? '').split(' -> ');
      // The one notification that is a request rather than news.
      return { title: `${from} says they paid ${to}`, detail: `${amount} - needs confirming` };
    }
    case 'settlement_rejected': {
      const [from, to] = (n.subject ?? '').split(' -> ');
      return { title: `${from} to ${to} was not confirmed`, detail: amount };
    }
    case 'member_added':
      return { title: `${who} added ${n.subject}`, detail: 'new housemate' };
    case 'member_joined':
      return { title: `${n.subject} joined`, detail: 'claimed their account' };
    case 'ownership_transferred':
      return { title: `${n.subject} is now the owner`, detail: 'handed over' };
    default:
      // The kinds are a CHECK constraint in Postgres (0019:75-81), not a type
      // the client controls, so a migration can add one this build has never
      // heard of. Without this the switch returned undefined, the caller
      // destructured it, and the whole Activity screen crashed on a
      // notification it simply did not need to render.
      return { title: n.subject ?? 'Something changed', detail: '' };
  }
}

/** Same reasoning as describe()'s default: an unknown kind gets a shrug, not
 *  an undefined icon name that renders as a blank box. */
const FALLBACK_ICON: keyof typeof Ionicons.glyphMap = 'ellipse-outline';

const ICONS: Record<AppNotification['kind'], keyof typeof Ionicons.glyphMap> = {
  expense_added: 'add-circle',
  expense_changed: 'create',
  expense_deleted: 'trash',
  settlement: 'swap-horizontal',
  settlement_pending: 'hourglass',
  settlement_rejected: 'close-circle',
  member_added: 'person-add',
  member_joined: 'happy',
  ownership_transferred: 'key',
};

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / (60 * 24));
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const notifications = useNotifications();

  const markRead = useMutation({
    mutationFn: async () => {
      await supabase.rpc('mark_notifications_read');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  /**
   * Opening the screen IS reading it. Marking on unmount rather than on mount
   * so the unread highlights stay visible while you're actually looking.
   */
  useEffect(() => {
    return () => {
      markRead.mutate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = notifications.data ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Activity" subtitle="What everyone has been doing" />

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshing={notifications.isFetching}
        onRefresh={() => void notifications.refetch()}
        ListEmptyComponent={
          queryState(notifications, 'your activity') ?? (
            <Card style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="notifications-outline" size={20} color={theme.textTertiary} />
              </View>
              <ThemedText style={Type.headline}>Nothing yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                When anyone adds an expense, records a payment or joins, it shows up here.
              </ThemedText>
            </Card>
          )
        }
        renderItem={({ item, index }) => {
          const { title, detail } = describe(item);
          const last = index === items.length - 1;
          const tappable = item.kind.startsWith('expense') && item.entityId;

          return (
            <Pressable
              disabled={!tappable}
              onPress={() =>
                router.push({ pathname: '/expense/[id]', params: { id: item.entityId! } })
              }
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: item.unread ? theme.primarySoft : theme.backgroundElement,
                  borderColor: theme.border,
                  opacity: pressed && tappable ? 0.6 : 1,
                },
                index === 0 && styles.first,
                last && styles.last,
                !last && { borderBottomWidth: 0 },
              ]}>
              <View
                style={[
                  styles.tile,
                  {
                    backgroundColor: item.unread ? theme.backgroundElement : theme.backgroundSelected,
                  },
                ]}>
                <Ionicons
                  name={(ICONS[item.kind] ?? FALLBACK_ICON)}
                  size={16}
                  color={item.unread ? theme.primary : theme.textSecondary}
                />
              </View>

              <View style={styles.flex}>
                <ThemedText style={Type.body} numberOfLines={2}>
                  {title}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {detail ? `${detail} · ` : ''}
                  {relative(item.createdAt)}
                </ThemedText>
              </View>

              {item.unread ? (
                <View style={[styles.dot, { backgroundColor: theme.primary }]} />
              ) : null}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

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
  tile: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },

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
