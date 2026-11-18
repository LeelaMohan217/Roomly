import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { Appear } from '@/components/ui/motion';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { useTheme } from '@/hooks/use-theme';
import {
  amountOf,
  auditKind,
  changesOf,
  entityLabel,
  subjectOf,
  type AuditKind,
} from '@/lib/audit';
import { dayLabel, dayOf } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { useAllCategories, useAuditLog, useMembers } from '@/lib/queries';
import { Icon, type IconName } from '@/components/ui/icon';

/**
 * Every change to the ledger, and who made it.
 *
 * Called "Edit history" and not "Activity" because the bell already owns that
 * word -- and because this screen's reason to exist is the part the
 * notification feed cannot show: what a number was BEFORE someone changed it.
 *
 * Owner tools tells people "every edit you make is recorded and visible to
 * everyone". That was true in Postgres and invisible in the app until this
 * screen existed.
 */

// Coloured as Activity is: green added, blue changed or restored, red deleted.
const LOOK: Record<
  AuditKind,
  { icon: IconName; verb: string; tone: 'success' | 'danger' | 'info' }
> = {
  added: { icon: 'add', verb: 'added', tone: 'success' },
  edited: { icon: 'pencil', verb: 'changed', tone: 'info' },
  deleted: { icon: 'trash-outline', verb: 'deleted', tone: 'danger' },
  restored: { icon: 'refresh-outline', verb: 'restored', tone: 'info' },
};

const ENTRANCE_STEPS = 10;
const SETTLE_MS = 800;

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / (60 * 24));
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function EditHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();

  const log = useAuditLog();
  const pull = usePullRefresh(() => log.refetch());
  const categories = useAllCategories();
  const members = useMembers();

  const fmt = {
    money: formatPaise,
    category: (id: string) => categories.data?.find((c) => c.id === id)?.name ?? 'a category',
    date: (iso: string) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    member: (id: string) => members.data?.find((m) => m.id === id)?.displayName ?? 'someone',
  };

  const entries = log.data ?? [];

  // One group per day, newest first, as on Activity and History.
  const days: { day: string; entries: typeof entries }[] = [];
  for (const e of entries) {
    const day = dayOf(e.at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else days.push({ day, entries: [e] });
  }

  const tones = {
    success: { soft: theme.successSoft, ink: theme.success },
    info: { soft: theme.infoSoft, ink: theme.info },
    danger: { soft: theme.dangerSoft, ink: theme.danger },
  };

  // As on History: only the first screenful rises in; after SETTLE_MS days mount still.
  const hasData = !!log.data;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!hasData) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [hasData]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Edit history" />

      {/* A FlatList, not a ScrollView. useAuditLog fetches 200 entries and
          each row carries an icon, a title, an N-row diff and a timestamp —
          all mounted eagerly before this. Every other list in the app is
          virtualized; this was both the exception and the longest. Each item
          is now a day's card, so a day mounts as one. */}
      <FlatList
        data={days}
        keyExtractor={(d) => d.day}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.textSecondary}
          />
        }
        ListEmptyComponent={
          queryState(log, 'the change history') ?? (
            <Appear>
              <Card style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
                  <Icon name="document-text-outline" size={22} color={theme.brandInk} />
                </View>
                <ThemedText style={Type.title}>Nothing changed yet</ThemedText>
                <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                  Expenses, payments, housemates, categories and recurring bills all show up here
                  when they change.
                </ThemedText>
              </Card>
            </Appear>
          )
        }
        renderItem={({ item: group, index }) => (
          <Appear index={index} still={settled || index > ENTRANCE_STEPS} style={styles.day}>
            <ThemedText style={styles.dayTitle}>{dayLabel(group.day)}</ThemedText>
            <Card padded={false}>
              {group.entries.map((e, i) => {
                const kind = auditKind(e);
                const look = LOOK[kind];
                const changes = changesOf(e, fmt);
                const amount = amountOf(e);
                // "a category" alone is vague when there are thirteen of them,
                // so name it where the row carries one.
                const subject = subjectOf(e);
                const thing = subject ? `${entityLabel(e.entityType)} · ${subject}` : entityLabel(e.entityType);
                const { soft, ink } = tones[look.tone];

                // Settlements have no detail screen of their own, and a deleted
                // expense still opens -- it is soft-deleted, not gone.
                const openable = e.entityType === 'expenses';

                return (
                  <Pressable
                    key={e.id}
                    disabled={!openable}
                    onPress={() => router.push(`/expense/${e.entityId}`)}
                    style={({ pressed }) => [
                      styles.row,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      { opacity: pressed && openable ? 0.6 : 1 },
                    ]}>
                    <View style={[styles.icon, { backgroundColor: soft }]}>
                      <Icon name={look.icon} size={15} color={ink} />
                    </View>

                    <View style={styles.body}>
                      <ThemedText style={Type.body} numberOfLines={2}>
                        {e.actorName ?? 'Someone'} {look.verb} {thing}
                      </ThemedText>

                      {/* The whole reason this screen exists: the old value,
                          struck through, beside the new one. A change with no
                          listed diff means only fields nobody reads moved. */}
                      {changes.length > 0 ? (
                        <View style={styles.changes}>
                          {changes.map((c) => (
                            <ThemedText
                              key={c.label}
                              themeColor="textSecondary"
                              style={Type.micro}
                              numberOfLines={1}
                              accessibilityLabel={`${c.label} changed from ${c.from} to ${c.to}`}>
                              {c.label}{' '}
                              {/* Struck only when something was there to
                                  replace: an added row's "none" is not a
                                  value that was crossed out. */}
                              <ThemedText
                                themeColor="textTertiary"
                                style={[Type.micro, kind === 'edited' && styles.struck]}>
                                {c.from}
                              </ThemedText>{' '}
                              → {c.to}
                            </ThemedText>
                          ))}
                        </View>
                      ) : null}

                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {relative(e.at)}
                      </ThemedText>
                    </View>

                    {/* Grey once deleted: it no longer counts. */}
                    {amount !== null ? (
                      <ThemedText
                        themeColor={kind === 'deleted' ? 'textTertiary' : 'text'}
                        style={styles.amount}
                        numberOfLines={1}>
                        {formatPaise(amount)}
                      </ThemedText>
                    ) : null}
                  </Pressable>
                );
              })}
            </Card>
          </Appear>
        )}
        ListFooterComponent={
          entries.length > 0 ? (
            <Appear
              index={Math.min(days.length, ENTRANCE_STEPS + 1)}
              still={settled || days.length > ENTRANCE_STEPS}
              style={styles.footer}>
              <Icon name="lock-closed-outline" size={14} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.caption, styles.flex]}>
                Written by the database. Nobody can change this list
              </ThemedText>
            </Appear>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  struck: { textDecorationLine: 'line-through' },

  day: { gap: Spacing.two },
  // Sentence case at heading size, as on Activity and History.
  dayTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  changes: { gap: 1 },
  amount: { fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
});
