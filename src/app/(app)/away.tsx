import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Appear } from '@/components/ui/motion';
import { useDialog } from '@/components/ui/dialog';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Notice } from '@/components/ui/notice';
import { queryState } from '@/components/ui/query-state';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { daysBetween, daysInMonth, formatRange, isoOf, todayIso, withinRange } from '@/lib/dates';
import { useAwayPeriods, useMembers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { isPresent } from '@/lib/split';
import { supabase } from '@/lib/supabase';

export default function AwayScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { member } = useSession();

  const members = useMembers();
  const away = useAwayPeriods();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [openEnded, setOpenEnded] = useState(false);
  const [note, setNote] = useState('');
  const [forMember, setForMember] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backdated, setBackdated] = useState<number | null>(null);

  const isOwner = member?.role === 'owner';
  const subject = forMember ?? member?.id ?? null;
  const today = todayIso();

  // One yellow dot per person away that day. Each person used to get their own
  // colour (purple and pink among them), but avatars carry no colour any more,
  // so the colours pointed at nobody; yellow says "someone is away" and the
  // trip list below says who.
  //
  // Plain derivation rather than useMemo: React Compiler is enabled and
  // memoizes this itself.
  const marks = (() => {
    const out: Record<string, string[]> = {};
    if (!away.data) return out;

    const lastDay = daysInMonth(year, month);
    for (let d = 1; d <= lastDay; d++) {
      const iso = isoOf(year, month, d);
      const colors = away.data
        .filter((a) => withinRange(iso, a.startDate, a.endDate))
        .map(() => theme.warning);
      if (colors.length) out[iso] = colors;
    }
    return out;
  })();

  function explain() {
    void dialog.alert({
      tone: 'info',
      icon: 'airplane-outline',
      title: 'How away works',
      message:
        "Mark a trip once and day-to-day costs split without you for those days. Rent, wifi and the gas cylinder still split with everyone — your room doesn't disappear.",
    });
  }

  function explainBackdated(count: number) {
    void dialog.alert({
      tone: 'warning',
      icon: 'alert-circle-outline',
      title: 'Past expenses were not changed',
      message:
        count === 0
          ? 'Nothing had already been split against those days, so nothing needs fixing.'
          : `${count} expense${count === 1 ? ' was' : 's were'} already split including them in that window. Re-splitting isn't automatic — edit them from History if they need correcting.`,
    });
  }

  const awayToday = (members.data ?? []).filter(
    (m) => away.data && !isPresent(m.id, today, away.data)
  );

  function pickDay(iso: string) {
    setError(null);
    // A third tap starts a new range rather than extending the old one.
    if (!start || (start && end) || iso < start) {
      setStart(iso);
      setEnd(null);
    } else {
      setEnd(iso);
    }
  }

  /**
   * Marking a trip after you're back is the common case — people remember on
   * the way home. Past splits are never silently rewritten, so say exactly
   * how many expenses were already logged against them in that window.
   */
  async function countBackdated(memberId: string, from: string, to: string) {
    const { data, error: qError } = await supabase
      .from('expenses')
      .select('id, categories!inner ( respects_away_calendar ), expense_splits!inner ( member_id )')
      .gte('expense_date', from)
      .lte('expense_date', to)
      .is('voided_at', null);

    if (qError) return null;

    type Row = {
      categories: { respects_away_calendar: boolean } | null;
      expense_splits: { member_id: string }[];
    };

    return (data as unknown as Row[]).filter(
      (e) =>
        e.categories?.respects_away_calendar && e.expense_splits.some((s) => s.member_id === memberId)
    ).length;
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!member || !subject || !start) throw new Error('Pick a start date first');

      const finalEnd = openEnded ? null : (end ?? start);

      const { error: insertError } = await supabase.from('away_periods').insert({
        household_id: member.household_id,
        member_id: subject,
        start_date: start,
        end_date: finalEnd,
        note: note.trim() || null,
      });

      if (insertError) {
        // The GiST exclusion constraint stops overlapping trips for one person.
        if (insertError.message.includes('exclusion') || insertError.code === '23P01') {
          throw new Error('That overlaps a trip already marked for this person.');
        }
        throw insertError;
      }

      return start < today ? await countBackdated(subject, start, finalEnd ?? today) : null;
    },
    onSuccess: (affected) => {
      dialog.toast({ message: 'Away dates saved', icon: 'airplane-outline' });
      setBackdated(affected);
      setStart(null);
      setEnd(null);
      setNote('');
      setOpenEnded(false);
      void queryClient.invalidateQueries();
    },
    onError: (e) => setError(humanError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error: delError } = await supabase.from('away_periods').delete().eq('id', id);
      if (delError) throw delError;
    },
    onSuccess: () => {
      dialog.toast({ message: 'Trip removed', icon: 'trash-outline' });
      return queryClient.invalidateQueries();
    },
    onError: (e) => setError(humanError(e)),
  });

  async function confirmRemove(id: string, label: string) {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'trash-outline',
      title: 'Remove this trip?',
      message: `${label}\n\nSplits already saved won't change.`,
      confirmLabel: 'Remove',
    });
    if (ok) remove.mutate(id);
  }

  const nights = start && end ? daysBetween(start, end) : start ? 1 : 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* The explanation behind an icon: it was a paragraph above the
          calendar on every visit, for something you learn once. */}
      <ScreenHeader
        title="Away"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="How away works"
            onPress={explain}
            hitSlop={6}
            style={({ pressed }) => [
              styles.headerIcon,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Ionicons name="information-circle-outline" size={19} color={theme.text} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {awayToday.length > 0 ? (
          <Appear index={0} style={[styles.note, { backgroundColor: theme.warningSoft }]}>
            <Ionicons name="airplane-outline" size={15} color={theme.warning} />
            <ThemedText style={[Type.caption, styles.medium, styles.flex, { color: theme.warning }]}>
              Away today: {awayToday.map((m) => m.displayName).join(', ')}
            </ThemedText>
          </Appear>
        ) : null}

        {isOwner && members.data && members.data.length > 1 ? (
          <Appear index={1} style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Who is away</ThemedText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.peopleRow}>
              {members.data.map((m) => {
                const selected = (subject ?? member?.id) === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setForMember(m.id)}
                    style={({ pressed }) => [styles.person, { opacity: pressed ? 0.7 : 1 }]}>
                    <Avatar
                      name={m.displayName}
                      seed={m.id}
                      size={42}
                      ring={selected}
                      ringColor={theme.primary}
                      style={selected ? undefined : styles.dim}
                    />
                    <ThemedText
                      themeColor={selected ? 'text' : 'textTertiary'}
                      style={[Type.micro, selected && styles.semi]}
                      numberOfLines={1}>
                      {m.id === member?.id ? 'Me' : m.displayName}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Appear>
        ) : null}

        <Appear index={2}>
          <Card>
            <MonthCalendar
              year={year}
              month={month}
              onMonthChange={(y, m) => {
                setYear(y);
                setMonth(m);
              }}
              start={start}
              end={end}
              onDayPress={pickDay}
              marks={marks}
            />
          </Card>
        </Appear>

        {/* One wrapper for both, so picking a day swaps them in place. */}
        <Appear index={3}>
          {start ? (
            <Card padded={false}>
              <View style={[styles.formRow, styles.selectionHead]}>
                <View style={styles.flex}>
                  <ThemedText style={styles.rangeTitle}>
                    {openEnded ? formatRange(start, null) : formatRange(start, end ?? start)}
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.micro}>
                    {openEnded
                      ? 'Until you remove it'
                      : `${nights} day${nights === 1 ? '' : 's'}${end ? '' : ' · tap another day for a range'}`}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear the dates"
                  onPress={() => {
                    setStart(null);
                    setEnd(null);
                  }}
                  hitSlop={8}>
                  <Ionicons name="close" size={19} color={theme.textTertiary} />
                </Pressable>
              </View>

              <View style={[styles.formRow, styles.switchRow, { borderTopColor: theme.border }]}>
                <ThemedText style={[Type.body, styles.flex]}>No end date yet</ThemedText>
                <Switch
                  value={openEnded}
                  onValueChange={setOpenEnded}
                  trackColor={{ false: theme.backgroundSelected, true: theme.primary }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="No end date yet"
                />
              </View>

              <View style={[styles.formRow, styles.formFoot, { borderTopColor: theme.border }]}>
                <TextField
                  value={note}
                  onChangeText={setNote}
                  placeholder="Note: hometown, wedding…"
                  editable={!save.isPending}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: save.isPending }}
                  disabled={save.isPending}
                  onPress={() => save.mutate()}
                  style={({ pressed }) => [
                    styles.pill,
                    { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 },
                  ]}>
                  {save.isPending ? (
                    <ActivityIndicator size="small" color={theme.brandInk} />
                  ) : (
                    <ThemedText style={[styles.pillText, { color: theme.brandInk }]}>Mark away</ThemedText>
                  )}
                </Pressable>
              </View>
            </Card>
          ) : (
            <ThemedText themeColor="textTertiary" style={[Type.caption, styles.hint]}>
              Tap a day to start, then another for a range
            </ThemedText>
          )}
        </Appear>

        {/* One line once it is saved; the detail is a tap away. */}
        {backdated !== null ? (
          <Appear index={4}>
            <Pressable
              accessibilityRole="button"
              onPress={() => explainBackdated(backdated)}
              style={({ pressed }) => [
                styles.note,
                { backgroundColor: theme.warningSoft, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Ionicons name="alert-circle-outline" size={15} color={theme.warning} />
              <ThemedText style={[Type.caption, styles.medium, styles.flex, { color: theme.warning }]}>
                Saved · past expenses were not changed
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                onPress={() => setBackdated(null)}
                hitSlop={10}>
                <Ionicons name="close" size={16} color={theme.warning} />
              </Pressable>
            </Pressable>
          </Appear>
        ) : null}

        {error ? (
          <Appear index={5}>
            <Notice tone="danger" message={error} />
          </Appear>
        ) : null}

        <Appear index={6} style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Trips</ThemedText>

          {/* Loading is not "no trips": that used to show until the list
              arrived, and for good if it never did. */}
          {queryState(away, 'the trips') ??
          (away.data && away.data.length > 0 ? (
            <Card padded={false}>
              {away.data.map((a, i) => {
                const current = withinRange(today, a.startDate, a.endDate);
                // Removing is behind a tap on the row, with the same popup --
                // a bin on every trip was the loudest thing in the list.
                const canRemove = isOwner || a.memberId === member?.id;
                const label = `${a.memberName} · ${formatRange(a.startDate, a.endDate)}`;

                return (
                  <Pressable
                    key={a.id}
                    disabled={!canRemove}
                    onPress={() => confirmRemove(a.id, label)}
                    accessibilityRole={canRemove ? 'button' : 'text'}
                    accessibilityHint={canRemove ? 'Opens remove' : undefined}
                    style={({ pressed }) => [
                      styles.tripRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}>
                    <Avatar name={a.memberName} seed={a.memberId} size={36} />

                    <View style={styles.flex}>
                      <View style={styles.tripName}>
                        <ThemedText style={[Type.body, styles.shrink]} numberOfLines={1}>
                          {a.memberName}
                        </ThemedText>
                        {a.memberId === member?.id ? (
                          <View style={[styles.tag, { backgroundColor: theme.backgroundSelected }]}>
                            <ThemedText themeColor="textSecondary" style={styles.tagText}>
                              You
                            </ThemedText>
                          </View>
                        ) : null}
                        {current ? (
                          <View style={[styles.tag, { backgroundColor: theme.warningSoft }]}>
                            <ThemedText style={[styles.tagText, { color: theme.warning }]}>Away now</ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
                        {formatRange(a.startDate, a.endDate)}
                        {a.note ? ` · ${a.note}` : ''}
                      </ThemedText>
                    </View>

                    {canRemove ? (
                      <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </Card>
          ) : (
            <Card style={styles.empty}>
              <Ionicons name="airplane-outline" size={20} color={theme.textTertiary} />
              <ThemedText themeColor="textSecondary" style={Type.caption}>
                No trips marked yet.
              </ThemedText>
            </Card>
          ))}
        </Appear>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  medium: { fontWeight: '500' },
  shrink: { flexShrink: 1 },
  dim: { opacity: 0.4 },
  hint: { textAlign: 'center' },

  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },

  section: { gap: Spacing.two },
  // Sentence case at heading size, as on Settle up and History.
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4 },
  peopleRow: { gap: Spacing.four, paddingVertical: Spacing.one, paddingRight: Spacing.four },
  person: { alignItems: 'center', gap: Spacing.two, width: 58 },

  formRow: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  selectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  rangeTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
  },
  formFoot: { gap: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  pill: {
    alignSelf: 'flex-end',
    minHeight: 36,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },

  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  tripName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tag: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  tagText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
});
