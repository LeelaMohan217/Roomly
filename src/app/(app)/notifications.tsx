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
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, dayOf } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { useNotifications, type AppNotification } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

/**
 * Wording lives here, not in SQL — money formatting has one home.
 *
 * The amount is returned on its own, for the right-hand column where every
 * other list in the app puts money; `needsYou` marks the one notification
 * that is a request rather than news.
 */
function describe(n: AppNotification): { title: string; amount: string; needsYou?: boolean } {
  const who = n.actorName ?? 'Someone';
  const amount = n.amountPaise !== null ? formatPaise(n.amountPaise) : '';

  switch (n.kind) {
    case 'expense_added':
      return { title: `${who} added ${n.subject}`, amount };
    case 'expense_changed':
      return { title: `${who} changed ${n.subject}`, amount };
    case 'expense_deleted':
      return { title: `${who} deleted ${n.subject}`, amount };
    case 'settlement': {
      const [from, to] = (n.subject ?? '').split(' -> ');
      return { title: `${from} paid ${to}`, amount };
    }
    case 'settlement_pending': {
      const [from, to] = (n.subject ?? '').split(' -> ');
      return { title: `${from} says they paid ${to}`, amount, needsYou: true };
    }
    case 'settlement_rejected': {
      const [from, to] = (n.subject ?? '').split(' -> ');
      return { title: `${from} to ${to} was not confirmed`, amount };
    }
    case 'member_added':
      return { title: `${who} added ${n.subject}`, amount: '' };
    case 'member_joined':
      return { title: `${n.subject} joined`, amount: '' };
    case 'ownership_transferred':
      return { title: `${n.subject} is now the owner`, amount: '' };
    default:
      // The kinds are a CHECK constraint in Postgres (0019:75-81), not a type
      // the client controls, so a migration can add one this build has never
      // heard of. Without this the switch returned undefined, the caller
      // destructured it, and the whole Activity screen crashed on a
      // notification it simply did not need to render.
      return { title: n.subject ?? 'Something changed', amount: '' };
  }
}

/** Same reasoning as describe()'s default: an unknown kind gets a shrug, not
 *  an undefined icon name that renders as a blank box. */
const FALLBACK_ICON: keyof typeof Ionicons.glyphMap = 'ellipse-outline';

const ICONS: Record<AppNotification['kind'], keyof typeof Ionicons.glyphMap> = {
  expense_added: 'add',
  expense_changed: 'pencil',
  expense_deleted: 'trash-outline',
  settlement: 'swap-horizontal',
  settlement_pending: 'hourglass-outline',
  settlement_rejected: 'close',
  member_added: 'person-add-outline',
  member_joined: 'person-outline',
  ownership_transferred: 'key-outline',
};

/**
 * The app's colours, by what the notification means: green added or paid,
 * blue a change or a person, red deleted or refused, yellow waiting on you.
 */
type Tint = 'success' | 'info' | 'danger' | 'warning' | 'neutral';
const TINTS: Record<AppNotification['kind'], Tint> = {
  expense_added: 'success',
  expense_changed: 'info',
  expense_deleted: 'danger',
  settlement: 'success',
  settlement_pending: 'warning',
  settlement_rejected: 'danger',
  member_added: 'info',
  member_joined: 'info',
  ownership_transferred: 'info',
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
  const pull = usePullRefresh(() => notifications.refetch());

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

  // One group per day, newest first, as History lays out expenses.
  const days: { day: string; items: AppNotification[] }[] = [];
  for (const n of items) {
    const day = dayOf(n.createdAt);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(n);
    else days.push({ day, items: [n] });
  }

  const tint = (t: Tint) =>
    t === 'success'
      ? { soft: theme.successSoft, ink: theme.success }
      : t === 'info'
        ? { soft: theme.infoSoft, ink: theme.info }
        : t === 'danger'
          ? { soft: theme.dangerSoft, ink: theme.danger }
          : t === 'warning'
            ? { soft: theme.warningSoft, ink: theme.warning }
            : { soft: theme.backgroundSelected, ink: theme.textSecondary };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Activity" />

      <FlatList
        data={days}
        keyExtractor={(d) => d.day}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
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
        renderItem={({ item: group }) => (
          <View style={styles.day}>
            <ThemedText style={styles.dayTitle}>{dayLabel(group.day)}</ThemedText>
            <Card padded={false}>
              {group.items.map((item, index) => {
                const { title, amount, needsYou } = describe(item);
                const tappable = item.kind.startsWith('expense') && item.entityId;
                const { soft, ink } = tint(TINTS[item.kind] ?? 'neutral');

                return (
                  <Pressable
                    key={item.id}
                    disabled={!tappable}
                    onPress={() =>
                      router.push({ pathname: '/expense/[id]', params: { id: item.entityId! } })
                    }
                    accessibilityLabel={
                      `${item.unread ? 'New. ' : ''}${title}` +
                      `${amount ? `, ${amount}` : ''}${needsYou ? ', needs confirming' : ''}` +
                      `, ${relative(item.createdAt)}`
                    }
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      { opacity: pressed && tappable ? 0.6 : 1 },
                    ]}>
                    <View style={[styles.tile, { backgroundColor: soft }]}>
                      <Ionicons name={ICONS[item.kind] ?? FALLBACK_ICON} size={16} color={ink} />
                    </View>

                    <View style={styles.flex}>
                      {/* Unread: a bolder title and a dot. The whole row used
                          to turn green, which here means money. */}
                      <ThemedText style={[Type.body, item.unread && styles.unread]} numberOfLines={2}>
                        {title}
                      </ThemedText>
                      <View style={styles.subRow}>
                        <ThemedText themeColor="textTertiary" style={Type.micro}>
                          {relative(item.createdAt)}
                        </ThemedText>
                        {needsYou ? (
                          <View style={[styles.tag, { backgroundColor: theme.warningSoft }]}>
                            <ThemedText style={[styles.tagText, { color: theme.warning }]}>
                              Needs confirming
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    {amount ? (
                      <ThemedText
                        themeColor={item.kind === 'expense_deleted' ? 'textTertiary' : 'text'}
                        style={Type.amount}>
                        {amount}
                      </ThemedText>
                    ) : null}

                    {item.unread ? (
                      <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                    ) : null}
                  </Pressable>
                );
              })}
            </Card>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  unread: { fontWeight: '600' },

  day: { gap: Spacing.two },
  // Sentence case at heading size, as on History.
  dayTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
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
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tag: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  tagText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4 },

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
