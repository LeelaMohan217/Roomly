import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Notice } from '@/components/ui/notice';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { daysBetween, daysInMonth, formatRange, isoOf, todayIso, withinRange } from '@/lib/dates';
import { useAwayPeriods, useMembers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { isPresent } from '@/lib/split';
import { supabase } from '@/lib/supabase';

const PALETTE = ['#4F7DF0', '#12A594', '#E0862C', '#8B6DE0', '#D9557F', '#3A9E6E'];

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

  const colorOf = (memberId: string) => {
    const i = (members.data ?? []).findIndex((m) => m.id === memberId);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  };

  // Plain derivation rather than useMemo: React Compiler is enabled and
  // memoizes this itself, and the hand-written deps could not list colorOf
  // without rebuilding every render anyway.
  const marks = (() => {
    const out: Record<string, string[]> = {};
    if (!away.data) return out;

    const lastDay = daysInMonth(year, month);
    for (let d = 1; d <= lastDay; d++) {
      const iso = isoOf(year, month, d);
      const colors = away.data
        .filter((a) => withinRange(iso, a.startDate, a.endDate))
        .map((a) => colorOf(a.memberId));
      if (colors.length) out[iso] = colors;
    }
    return out;
  })();

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
    onSuccess: () => void queryClient.invalidateQueries(),
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
      <ScreenHeader title="Away calendar" />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
          <Ionicons name="information-circle-outline" size={15} color={theme.textTertiary} />
          <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
            Mark a trip once and day-to-day costs split without you for those days. Rent, wifi and
            the gas cylinder still split with everyone — your room doesn&apos;t disappear.
          </ThemedText>
        </View>

        {awayToday.length > 0 ? (
          <Card padded={false} style={[styles.banner, { backgroundColor: theme.warningSoft }]}>
            <Ionicons name="airplane" size={15} color={theme.warning} />
            <ThemedText style={[Type.caption, styles.flex]}>
              Away today: {awayToday.map((m) => m.displayName).join(', ')}
            </ThemedText>
          </Card>
        ) : null}

        {isOwner && members.data && members.data.length > 1 ? (
          <View style={styles.section}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              WHO IS THIS FOR
            </ThemedText>
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
          </View>
        ) : null}

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

        {start ? (
          <Card style={[styles.selection, { borderColor: theme.primary }]}>
            <View style={styles.selectionHead}>
              <View style={styles.flex}>
                <ThemedText style={Type.headline}>
                  {openEnded ? formatRange(start, null) : formatRange(start, end ?? start)}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {openEnded
                    ? 'Until you remove it'
                    : `${nights} day${nights === 1 ? '' : 's'}${end ? '' : ' — tap another day for a range'}`}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => {
                  setStart(null);
                  setEnd(null);
                }}
                hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={theme.textTertiary} />
              </Pressable>
            </View>

            <Pressable onPress={() => setOpenEnded((v) => !v)} style={styles.checkRow} hitSlop={8}>
              <Ionicons
                name={openEnded ? 'checkbox' : 'square-outline'}
                size={19}
                color={openEnded ? theme.primary : theme.borderStrong}
              />
              <ThemedText style={Type.caption}>No end date yet</ThemedText>
            </Pressable>

            <TextField
              value={note}
              onChangeText={setNote}
              placeholder="Note — hometown, wedding…"
              editable={!save.isPending}
            />

            <Button title="Mark away" onPress={() => save.mutate()} loading={save.isPending} />
          </Card>
        ) : (
          <ThemedText themeColor="textTertiary" style={[Type.micro, styles.hint]}>
            Tap a day to start, then tap another for a range.
          </ThemedText>
        )}

        {backdated !== null ? (
          <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
            <Ionicons name="alert-circle-outline" size={15} color={theme.warning} />
            <View style={styles.flex}>
              <ThemedText style={[Type.caption, styles.semi]}>
                Saved — past expenses were not changed
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={Type.micro}>
                {backdated === 0
                  ? 'Nothing had already been split against those days, so nothing needs fixing.'
                  : `${backdated} expense${backdated === 1 ? ' was' : 's were'} already split including them in that window. Re-splitting isn't automatic — edit them from History if they need correcting.`}
              </ThemedText>
              <Pressable onPress={() => setBackdated(null)} hitSlop={8}>
                <ThemedText style={[Type.micro, { color: theme.primary, fontWeight: '700' }]}>
                  Dismiss
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}

        {error ? <Notice tone="danger" message={error} /> : null}

        <View style={styles.section}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            TRIPS
          </ThemedText>

          {away.data && away.data.length > 0 ? (
            <Card padded={false}>
              {away.data.map((a, i) => {
                const current = withinRange(today, a.startDate, a.endDate);
                const canRemove = isOwner || a.memberId === member?.id;
                const label = `${a.memberName} · ${formatRange(a.startDate, a.endDate)}`;

                return (
                  <View
                    key={a.id}
                    style={[
                      styles.tripRow,
                      i < (away.data?.length ?? 0) - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                      },
                    ]}>
                    <Avatar name={a.memberName} seed={a.memberId} size={36} />

                    <View style={styles.flex}>
                      <View style={styles.tripName}>
                        <ThemedText style={Type.body} numberOfLines={1}>
                          {a.memberName}
                          {a.memberId === member?.id ? ' (you)' : ''}
                        </ThemedText>
                        {current ? (
                          <View style={[styles.nowPill, { backgroundColor: theme.warningSoft }]}>
                            <ThemedText style={[Type.micro, { color: theme.warning, fontWeight: '700' }]}>
                              away now
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {formatRange(a.startDate, a.endDate)}
                        {a.note ? ` · ${a.note}` : ''}
                      </ThemedText>
                    </View>

                    {canRemove ? (
                      <Pressable onPress={() => confirmRemove(a.id, label)} hitSlop={14}>
                        <Ionicons name="trash-outline" size={17} color={theme.textTertiary} />
                      </Pressable>
                    ) : null}
                  </View>
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
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  semi: { fontWeight: '700' },
  dim: { opacity: 0.4 },
  hint: { textAlign: 'center' },

  note: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },

  section: { gap: Spacing.two },
  peopleRow: { gap: Spacing.four, paddingVertical: Spacing.one, paddingRight: Spacing.four },
  person: { alignItems: 'center', gap: Spacing.two, width: 58 },

  selection: { gap: Spacing.three, borderWidth: 1.4 },
  selectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  tripName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  nowPill: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
});
