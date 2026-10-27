import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, daysInMonth, formatRange, isoOf, todayIso } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { useMembers, useMonthlyTotals } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { canMakePdf, exportStatement, type StatementFormat } from '@/lib/statement';
import { supabase } from '@/lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Tab = 'month' | 'range';
type RangeKey = '30' | '90' | '180' | 'all' | 'custom';

const RANGES: { key: Exclude<RangeKey, 'custom'>; label: string; days: number | null }[] = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '180', label: 'Last 6 months', days: 182 },
  { key: 'all', label: 'Everything', days: null },
];

// Months shown before "Earlier months": the last three are what people
// download nearly every time.
const RECENT_MONTHS = 3;

/**
 * Download a statement: pick a period, pick PDF or CSV, download.
 *
 * Months first, because a household settles up month by month -- that is the
 * statement people send to the group chat. Range covers everything else, down
 * to any two days on a calendar. Every expense in the house for the period;
 * the file says which part was yours.
 */
export default function StatementScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const { member } = useSession();
  const totals = useMonthlyTotals();
  const members = useMembers();

  const household = useQuery({
    queryKey: ['household', member?.household_id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('households')
        .select('name, currency')
        .eq('id', member!.household_id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Months that have expenses, newest first, each with its total. The current
  // month is always offered, even before anything is in it.
  const now = new Date();
  const thisKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
  const monthTotals = new Map<string, number>([[thisKey, 0]]);
  for (const r of totals.data ?? []) {
    const k = `${r.year}-${r.month}`;
    monthTotals.set(k, (monthTotals.get(k) ?? 0) + r.totalPaise);
  }
  const months = [...monthTotals.entries()]
    .map(([k, total]) => {
      const [y, m] = k.split('-').map(Number);
      return { key: k, year: y, month: m, total };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);

  const pdfReady = canMakePdf();
  const [tab, setTab] = useState<Tab>('month');
  const [monthKey, setMonthKey] = useState(thisKey);
  const [showEarlier, setShowEarlier] = useState(false);
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [custom, setCustom] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [picking, setPicking] = useState(false);
  const [cal, setCal] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  // PDF by default where this build can make one; older APKs start on CSV.
  const [format, setFormat] = useState<StatementFormat>(pdfReady ? 'pdf' : 'csv');
  const [busy, setBusy] = useState(false);

  /**
   * Whose expenses: the people whose payments go in. null means everyone --
   * the default, and kept as "everyone" rather than a list of today's ids, so
   * it still means everyone if the member list arrives after this mounts.
   */
  const [payers, setPayers] = useState<string[] | null>(null);
  const everyone = (members.data ?? []).map((m) => m.id);
  const picked = payers ?? everyone;
  const allPicked = everyone.length > 0 && everyone.every((id) => picked.includes(id));

  function togglePayer(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPayers(everyone.every((x) => next.includes(x)) ? null : next);
  }

  /** The chosen period as dates, and in words for the summary line. */
  const period = (() => {
    const today = todayIso();
    if (tab === 'month') {
      const m = months.find((x) => x.key === monthKey) ?? months[0];
      return {
        from: isoOf(m.year, m.month, 1),
        to: isoOf(m.year, m.month, daysInMonth(m.year, m.month)),
        label: `${MONTHS[m.month - 1]} ${m.year}`,
      };
    }
    if (rangeKey === 'custom') {
      return custom.from
        ? {
            from: custom.from,
            to: custom.to ?? custom.from,
            label: formatRange(custom.from, custom.to ?? custom.from),
          }
        : { from: null, to: null, label: 'Pick the dates' };
    }
    const r = RANGES.find((x) => x.key === rangeKey)!;
    if (r.days === null) return { from: null, to: null, label: 'Everything' };
    const from = addDays(today, -(r.days - 1));
    return { from, to: today, label: formatRange(from, today) };
  })();

  const needsDates = tab === 'range' && rangeKey === 'custom' && !custom.from;
  const canDownload =
    !busy && !needsDates && !!member && picked.length > 0 && (format === 'csv' || pdfReady);

  // In words, for the line above the button and the PDF's header.
  const nameOf = (id: string) =>
    id === member?.id ? 'you' : (members.data?.find((m) => m.id === id)?.displayName ?? '—');
  const whose = allPicked
    ? 'everyone'
    : picked.length === 0
      ? 'nobody'
      : `paid by ${picked.map(nameOf).join(', ')}`;

  async function download() {
    if (!canDownload || !member) return;
    setBusy(true);
    const result = await exportStatement(format, {
      householdName: household.data?.name ?? 'Roomly',
      myName: member.display_name,
      myId: member.id,
      // Everyone means no payer filter at all, so expenses paid by someone
      // who has since moved out still come in.
      filters: { from: period.from, to: period.to, categoryIds: [], paidByIds: allPicked ? [] : picked },
      search: '',
      summary: allPicked ? '' : `Paid by ${picked.map((id) => (id === member.id ? member.display_name : nameOf(id))).join(', ')}`,
    });
    setBusy(false);
    if (!result.ok) {
      void dialog.alert({ tone: 'warning', title: 'Could not make the statement', message: result.reason });
    }
  }

  // Same tapping rule as History's filters and Away: first tap starts the
  // range, the second ends it, a third (or one before the start) starts again.
  function pickDay(iso: string) {
    setCustom((c) => (!c.from || c.to || iso < c.from ? { from: iso, to: null } : { from: c.from, to: iso }));
  }

  const shownMonths = showEarlier ? months : months.slice(0, RECENT_MONTHS);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Statement" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Period</ThemedText>
          <Segmented
            options={[
              { value: 'month', label: 'Month' },
              { value: 'range', label: 'Range' },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'month' ? (
            <Card padded={false}>
              {shownMonths.map((m, i) => (
                <Option
                  key={m.key}
                  first={i === 0}
                  label={`${MONTHS[m.month - 1]} ${m.year}`}
                  hint={m.key === thisKey ? `This month · ${formatPaise(m.total)}` : formatPaise(m.total)}
                  selected={monthKey === m.key}
                  onPress={() => setMonthKey(m.key)}
                />
              ))}
              {months.length > RECENT_MONTHS ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showEarlier }}
                  onPress={() => setShowEarlier((v) => !v)}
                  style={({ pressed }) => [
                    styles.row,
                    { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <ThemedText themeColor="textSecondary" style={[Type.body, styles.flex]}>
                    {showEarlier ? 'Fewer months' : 'Earlier months'}
                  </ThemedText>
                  <Ionicons
                    name={showEarlier ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color={theme.textTertiary}
                  />
                </Pressable>
              ) : null}
            </Card>
          ) : (
            <Card padded={false}>
              {RANGES.map((r, i) => (
                <Option
                  key={r.key}
                  first={i === 0}
                  label={r.label}
                  selected={rangeKey === r.key}
                  onPress={() => setRangeKey(r.key)}
                />
              ))}
              <Option
                first={false}
                label="Pick dates"
                hint={custom.from ? formatRange(custom.from, custom.to ?? custom.from) : 'Opens a calendar'}
                selected={rangeKey === 'custom'}
                onPress={() => {
                  setRangeKey('custom');
                  setPicking(true);
                }}
              />
            </Card>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.headRow}>
            <ThemedText style={[styles.sectionTitle, styles.flex]}>Whose expenses</ThemedText>
            {/* One tap to tick everyone, or to clear them all and pick one. */}
            <Pressable
              accessibilityRole="button"
              onPress={() => setPayers(allPicked ? [] : null)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <ThemedText style={[Type.caption, { color: theme.brandInk }]}>
                {allPicked ? 'Clear all' : 'Select all'}
              </ThemedText>
            </Pressable>
          </View>
          <Card padded={false}>
            {(members.data ?? []).map((m, i) => {
              const on = picked.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => togglePayer(m.id)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <Avatar name={m.displayName} seed={m.id} size={32} />
                  <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                    {m.displayName}
                    {m.id === member?.id ? ' (you)' : ''}
                  </ThemedText>
                  {/* More than one can be ticked; Select all above says so. */}
                  <View
                    style={[
                      styles.box,
                      on
                        ? { backgroundColor: theme.primary, borderColor: theme.primary }
                        : { borderColor: theme.borderStrong },
                    ]}>
                    {on ? <Ionicons name="checkmark" size={14} color={theme.onPrimary} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>File type</ThemedText>
          <Card padded={false}>
            <Option
              first
              icon="document-text-outline"
              label="PDF"
              // On an APK without the print module the choice stays visible,
              // saying what it needs, rather than vanishing.
              hint={pdfReady ? 'To read and share' : 'Needs the latest version of the app'}
              selected={format === 'pdf'}
              disabled={!pdfReady}
              onPress={() => setFormat('pdf')}
            />
            <Option
              first={false}
              icon="grid-outline"
              label="CSV"
              hint="To sum and sort in Excel or Sheets"
              selected={format === 'csv'}
              onPress={() => setFormat('csv')}
            />
          </Card>
        </View>
      </ScrollView>

      {/* Pinned, so the button is where the thumb is however long the month
          list grows. The line above it says exactly what will come out. */}
      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
        <ThemedText themeColor="textTertiary" style={[Type.caption, styles.centered]} numberOfLines={1}>
          {picked.length === 0
            ? 'Pick at least one person'
            : `${period.label} · ${format === 'pdf' ? 'PDF' : 'CSV'} · ${whose}`}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canDownload, busy }}
          disabled={!canDownload}
          onPress={() => void download()}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: canDownload ? theme.primary : theme.backgroundSelected,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          {busy ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <>
              <Ionicons
                name="download-outline"
                size={18}
                color={canDownload ? theme.onPrimary : theme.textTertiary}
              />
              <ThemedText
                style={[styles.buttonText, { color: canDownload ? theme.onPrimary : theme.textTertiary }]}>
                Download statement
              </ThemedText>
            </>
          )}
        </Pressable>
      </View>

      <Sheet
        visible={picking}
        title="Pick dates"
        subtitle={
          custom.from
            ? formatRange(custom.from, custom.to ?? custom.from)
            : 'Tap a start day, then an end day'
        }
        onClose={() => setPicking(false)}>
        <MonthCalendar
          year={cal.year}
          month={cal.month}
          onMonthChange={(year, month) => setCal({ year, month })}
          start={custom.from}
          end={custom.to ?? custom.from}
          onDayPress={pickDay}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!custom.from}
          onPress={() => setPicking(false)}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: custom.from ? theme.primary : theme.backgroundSelected, opacity: pressed ? 0.85 : 1 },
          ]}>
          <ThemedText style={[styles.buttonText, { color: custom.from ? theme.onPrimary : theme.textTertiary }]}>
            Done
          </ThemedText>
        </Pressable>
      </Sheet>
    </SafeAreaView>
  );
}

/** One choice: an optional grey icon tile, a label and hint, a green tick. */
function Option({
  label,
  hint,
  icon,
  selected,
  onPress,
  first,
  disabled = false,
}: {
  label: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
  first: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 },
      ]}>
      {icon ? (
        <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name={icon} size={17} color={theme.text} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <ThemedText style={Type.body}>{label}</ThemedText>
        {hint ? (
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {selected ? (
        <View style={[styles.tick, { backgroundColor: theme.primary }]}>
          <Ionicons name="checkmark" size={14} color={theme.onPrimary} />
        </View>
      ) : (
        <View style={[styles.ring, { borderColor: theme.borderStrong }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.four },

  section: { gap: Spacing.two },
  // Sentence case at heading size, as on the other redesigned screens.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
  // Round, like every other choice on this screen.
  box: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two + 2,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    minHeight: 50,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  buttonText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
});
