import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysInMonth, formatRange, isoOf, todayIso } from '@/lib/dates';
import { NO_FILTERS, useHistoryFilters, type HistoryFilters } from '@/lib/history-filters';
import { categoryIcon } from '@/lib/icons';
import { useCategories, useMembers } from '@/lib/queries';
import { Icon } from '@/components/ui/icon';

type Pane = 'date' | 'category' | 'paidBy';
/** null: no date option picked, which means every date. */
type DateMode = 'this' | 'last' | 'three' | 'custom' | null;

/** The first and last day of a month, `back` months before this one. */
function monthSpan(back: number): { from: string; to: string } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { from: isoOf(y, m, 1), to: isoOf(y, m, daysInMonth(y, m)) };
}

/** Quick date picks, each a range ending today at the latest. */
const PRESETS: Record<'this' | 'last' | 'three', () => { from: string; to: string }> = {
  this: () => ({ from: monthSpan(0).from, to: todayIso() }),
  last: () => monthSpan(1),
  three: () => ({ from: monthSpan(2).from, to: todayIso() }),
};

// No "Any time" option: nothing selected already means every date, and a
// pre-selected default looked like a filter that was on.
const DATE_OPTIONS: { mode: Exclude<DateMode, null>; label: string }[] = [
  { mode: 'this', label: 'This month' },
  { mode: 'last', label: 'Last month' },
  { mode: 'three', label: 'Last 3 months' },
  { mode: 'custom', label: 'Custom range' },
];

/** Which date option a saved range corresponds to. */
function modeOf(f: HistoryFilters): DateMode {
  if (!f.from && !f.to) return null;
  for (const key of ['this', 'last', 'three'] as const) {
    const p = PRESETS[key]();
    if (p.from === f.from && p.to === f.to) return key;
  }
  return 'custom';
}

/** One option row: a label, an optional lead, and a check or radio mark. */
function OptionRow({
  label,
  selected,
  onPress,
  lead,
  radio = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  lead?: React.ReactNode;
  radio?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'checkbox'}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
      ]}>
      {lead}
      <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
        {label}
      </ThemedText>
      {radio ? (
        <View
          style={[
            styles.radio,
            { borderColor: selected ? theme.primary : theme.borderStrong },
          ]}>
          {selected ? <View style={[styles.radioDot, { backgroundColor: theme.primary }]} /> : null}
        </View>
      ) : (
        <View
          style={[
            styles.check,
            selected
              ? { backgroundColor: theme.primary, borderColor: theme.primary }
              : { borderColor: theme.borderStrong },
          ]}>
          {selected ? <Icon name="checkmark" size={15} color={theme.onPrimary} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/**
 * History's filters, full screen and in two panes: the kinds of filter down
 * the left, each with a count of what's picked, and the choices for the
 * selected kind on the right.
 *
 * Full screen because a custom date range needs a whole calendar. Everything
 * here edits a local draft; nothing changes on History until Apply, so
 * backing out leaves the list exactly as it was.
 */
export default function HistoryFiltersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const categories = useCategories();
  const members = useMembers();
  const current = useHistoryFilters();
  const apply = useHistoryFilters((s) => s.apply);

  const [pane, setPane] = useState<Pane>('date');
  const [draft, setDraft] = useState<HistoryFilters>({
    categoryIds: current.categoryIds,
    paidByIds: current.paidByIds,
    from: current.from,
    to: current.to,
  });
  // Held apart from the range: choosing Custom shows the calendar before
  // any day is tapped, when the range itself is still empty.
  const [dateMode, setDateMode] = useState<DateMode>(() => modeOf(current));

  // The calendar opens on the month the range starts in, else this month.
  const opening = draft.from ? new Date(`${draft.from}T00:00:00`) : new Date();
  const [calYear, setCalYear] = useState(opening.getFullYear());
  const [calMonth, setCalMonth] = useState(opening.getMonth() + 1);

  function toggle(key: 'categoryIds' | 'paidByIds', id: string) {
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id],
    }));
  }

  // Tapping the selected option again unselects it, back to every date --
  // with no "Any time" row, that's the way to undo a date pick.
  function chooseDate(mode: Exclude<DateMode, null>) {
    const next = dateMode === mode ? null : mode;
    setDateMode(next);
    if (next === null || next === 'custom') setDraft((d) => ({ ...d, from: null, to: null }));
    else setDraft((d) => ({ ...d, ...PRESETS[next]() }));
  }

  // Same tapping rule as the Away calendar: the first tap starts a range, the
  // second ends it, and a third (or a tap before the start) starts again.
  function pickDay(iso: string) {
    setDraft((d) =>
      !d.from || (d.from && d.to) || iso < d.from
        ? { ...d, from: iso, to: null }
        : { ...d, to: iso }
    );
  }

  const counts: Record<Pane, number> = {
    date: draft.from || draft.to ? 1 : 0,
    category: draft.categoryIds.length,
    paidBy: draft.paidByIds.length,
  };
  // Custom counts as picked as soon as it's chosen, before a day is tapped:
  // Clear all is how you back out of it.
  const anyPicked =
    counts.date + counts.category + counts.paidBy > 0 || dateMode !== null;
  const PANES: { key: Pane; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'category', label: 'Category' },
    { key: 'paidBy', label: 'Paid by' },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Filters"
        action={
          // Grey and inert until something is picked: green would invite a
          // tap that does nothing.
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !anyPicked }}
            disabled={!anyPicked}
            onPress={() => {
              setDraft(NO_FILTERS);
              setDateMode(null);
            }}
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <ThemedText
              style={[
                Type.caption,
                styles.semi,
                { color: anyPicked ? theme.brandInk : theme.textTertiary },
              ]}>
              Clear all
            </ThemedText>
          </Pressable>
        }
      />

      <View style={[styles.panes, { borderTopColor: theme.border }]}>
        {/* The kinds of filter. The current one sits on the options' colour
            with a green bar, so it reads as joined to the pane beside it. */}
        <View style={[styles.rail, { backgroundColor: theme.backgroundSunken }]}>
          {PANES.map((p) => {
            const on = pane === p.key;
            return (
              <Pressable
                key={p.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setPane(p.key)}
                style={[styles.railItem, on && { backgroundColor: theme.backgroundElement }]}>
                <View
                  style={[styles.railBar, { backgroundColor: on ? theme.primary : 'transparent' }]}
                />
                <ThemedText
                  style={[Type.body, styles.flex, on && styles.semi]}
                  themeColor={on ? 'text' : 'textSecondary'}
                  numberOfLines={1}>
                  {p.label}
                </ThemedText>
                {counts[p.key] > 0 ? (
                  <View style={[styles.count, { backgroundColor: theme.primary }]}>
                    <ThemedText style={[styles.countText, { color: theme.onPrimary }]}>
                      {counts[p.key]}
                    </ThemedText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          style={[styles.flex, { backgroundColor: theme.backgroundElement }]}
          contentContainerStyle={styles.paneContent}
          showsVerticalScrollIndicator={false}>
          {pane === 'date' ? (
            <>
              {DATE_OPTIONS.map((o) => (
                <OptionRow
                  key={o.mode}
                  label={o.label}
                  radio
                  selected={dateMode === o.mode}
                  onPress={() => chooseDate(o.mode)}
                />
              ))}
              {dateMode === 'custom' ? (
                <View style={styles.calendar}>
                  <ThemedText themeColor="textSecondary" style={Type.micro}>
                    {draft.from
                      ? formatRange(draft.from, draft.to ?? draft.from)
                      : 'Tap a start day, then an end day.'}
                  </ThemedText>
                  <MonthCalendar
                    year={calYear}
                    month={calMonth}
                    onMonthChange={(y, m) => {
                      setCalYear(y);
                      setCalMonth(m);
                    }}
                    // A single tapped day shows as a one-day range until the end is picked.
                    start={draft.from}
                    end={draft.to ?? draft.from}
                    onDayPress={pickDay}
                  />
                </View>
              ) : null}
            </>
          ) : null}

          {pane === 'category'
            ? (categories.data ?? []).map((c) => (
                <OptionRow
                  key={c.id}
                  label={c.name}
                  selected={draft.categoryIds.includes(c.id)}
                  onPress={() => toggle('categoryIds', c.id)}
                  // Grey tiles and avatars: green on this screen means only
                  // "picked" -- the ticks, the current filter and its count.
                  lead={
                    <View style={[styles.lead, { backgroundColor: theme.primarySoft }]}>
                      <Icon
                        name={categoryIcon(c.icon)}
                        size={16}
                        color={theme.brandInk}
                      />
                    </View>
                  }
                />
              ))
            : null}

          {pane === 'paidBy'
            ? (members.data ?? []).map((m) => (
                <OptionRow
                  key={m.id}
                  label={m.displayName}
                  selected={draft.paidByIds.includes(m.id)}
                  onPress={() => toggle('paidByIds', m.id)}
                  lead={<Avatar name={m.displayName} seed={m.id} size={28} />}
                />
              ))
            : null}
        </ScrollView>
      </View>

      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
        <Button
          title="Apply"
          onPress={() => {
            // An unfinished range (a start with no end) means that one day.
            apply({ ...draft, to: draft.from && !draft.to ? draft.from : draft.to });
            router.back();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  panes: { flex: 1, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  rail: { width: '36%' },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three + 2,
    paddingRight: Spacing.three,
  },
  railBar: { width: 3, alignSelf: 'stretch', borderTopRightRadius: 3, borderBottomRightRadius: 3, marginRight: Spacing.two + 2 },
  count: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countText: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
  paneContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lead: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  calendar: { gap: Spacing.two, paddingTop: Spacing.three },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
