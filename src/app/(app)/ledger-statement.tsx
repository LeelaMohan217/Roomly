import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MONTHS_LONG } from '@/components/month-popover';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Icon, type IconName } from '@/components/ui/icon';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Appear } from '@/components/ui/motion';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, daysInMonth, formatRange, isoOf, todayIso } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { usePersonalMonthTotals } from '@/lib/personal';
import { exportPersonalStatement } from '@/lib/personal-statement';
import { canMakePdf, openDownload, type StatementFormat } from '@/lib/statement';

type Tab = 'month' | 'range';
type RangeKey = '30' | '90' | '180' | 'all' | 'custom';

const RANGES: { key: Exclude<RangeKey, 'custom'>; label: string; days: number | null }[] = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '180', label: 'Last 6 months', days: 182 },
  { key: 'all', label: 'Everything', days: null },
];

// Months shown before "Earlier months".
const RECENT_MONTHS = 3;

/**
 * My ledger's statement: the same page as History's (statement.tsx) -- a
 * month or a range, then PDF or CSV -- without "Whose expenses": every entry
 * in the private ledger is yours.
 */
export default function LedgerStatementScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const totals = usePersonalMonthTotals();
  // The months My ledger was showing, if any were picked there: "2026-10,2026-11".
  const params = useLocalSearchParams<{ months?: string }>();

  const now = new Date();
  const thisKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
  const monthTotals = new Map<string, number>([[thisKey, 0]]);
  for (const r of totals.data ?? []) monthTotals.set(`${r.year}-${r.month}`, r.totalPaise);
  const months = [...monthTotals.entries()]
    .map(([k, total]) => {
      const [y, m] = k.split('-').map(Number);
      return { key: k, year: y, month: m, total };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);

  const fromParams = (params.months ?? '')
    .split(',')
    .map((s) => /^(\d{4})-(\d{1,2})$/.exec(s))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${Number(m[1])}-${Number(m[2])}`);

  const pdfReady = canMakePdf();
  const [tab, setTab] = useState<Tab>('month');
  // Any number of months; a statement of several reads oldest first.
  const [monthKeys, setMonthKeys] = useState<string[]>(
    fromParams.length ? fromParams : [thisKey]
  );
  const toggleMonth = (key: string) =>
    setMonthKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  const pickedMonths = months.filter((m) => monthKeys.includes(m.key));
  const [showEarlier, setShowEarlier] = useState(false);
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [custom, setCustom] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const [picking, setPicking] = useState(false);
  const [cal, setCal] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [format, setFormat] = useState<StatementFormat>(pdfReady ? 'pdf' : 'csv');
  const [busy, setBusy] = useState(false);

  /** The chosen period as dates, and in words. */
  const period = (() => {
    const today = todayIso();
    if (tab === 'month') {
      if (pickedMonths.length === 0) {
        return { from: null, to: null, months: [], label: 'Pick at least one month' };
      }
      if (pickedMonths.length === 1) {
        const m = pickedMonths[0];
        return {
          from: isoOf(m.year, m.month, 1),
          to: isoOf(m.year, m.month, daysInMonth(m.year, m.month)),
          months: undefined,
          label: `${MONTHS_LONG[m.month - 1]} ${m.year}`,
        };
      }
      const oldestFirst = [...pickedMonths].reverse();
      const sameYear = oldestFirst.every((m) => m.year === oldestFirst[0].year);
      return {
        from: null,
        to: null,
        months: oldestFirst.map(({ year, month }) => ({ year, month })),
        label:
          oldestFirst.length > 4
            ? `${oldestFirst.length} months`
            : sameYear
              ? `${oldestFirst.map((m) => MONTHS_LONG[m.month - 1].slice(0, 3)).join(', ')} ${oldestFirst[0].year}`
              : oldestFirst.map((m) => `${MONTHS_LONG[m.month - 1].slice(0, 3)} ${m.year}`).join(', '),
      };
    }
    if (rangeKey === 'custom') {
      return custom.from
        ? {
            from: custom.from,
            to: custom.to ?? custom.from,
            months: undefined,
            label: formatRange(custom.from, custom.to ?? custom.from),
          }
        : { from: null, to: null, months: undefined, label: 'Pick the dates' };
    }
    const r = RANGES.find((x) => x.key === rangeKey)!;
    if (r.days === null) return { from: null, to: null, months: undefined, label: 'Everything' };
    const from = addDays(today, -(r.days - 1));
    return { from, to: today, months: undefined, label: formatRange(from, today) };
  })();

  const needsDates = tab === 'range' && rangeKey === 'custom' && !custom.from;
  const needsMonths = tab === 'month' && pickedMonths.length === 0;
  const canDownload = !busy && !needsDates && !needsMonths && (format === 'csv' || pdfReady);

  async function download() {
    if (!canDownload) return;
    setBusy(true);
    const result = await exportPersonalStatement(format, {
      from: period.from,
      to: period.to,
      months: period.months,
      periodLabel: period.label,
      search: '',
    });
    setBusy(false);
    if (!result.ok) {
      void dialog.alert({ tone: 'warning', title: 'Could not make the statement', message: result.reason });
      return;
    }
    const { saved } = result;
    if (saved) {
      const open = await dialog.confirm({
        tone: 'success',
        icon: 'download-outline',
        title: 'Saved to Downloads',
        message: saved.name,
        confirmLabel: 'Open',
        cancelLabel: 'Done',
      });
      if (open && !openDownload(saved.uri, saved.mimeType)) {
        void dialog.alert({
          tone: 'info',
          title: 'No app to open it',
          message: 'It is in your Downloads folder. Open it from the Files app.',
        });
      }
    }
  }

  // First tap starts the range, the second ends it, a third starts again.
  function pickDay(iso: string) {
    setCustom((c) =>
      !c.from || c.to || iso < c.from ? { from: iso, to: null } : { from: c.from, to: iso }
    );
  }

  // Months picked on My ledger stay in view even if they are older ones.
  const startIndex = Math.max(-1, ...months.map((m, i) => (monthKeys.includes(m.key) ? i : -1)));
  const shownMonths =
    showEarlier || startIndex >= RECENT_MONTHS ? months : months.slice(0, RECENT_MONTHS);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Statement" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Appear index={0} style={styles.section}>
          <View style={styles.headRow}>
            <ThemedText style={[styles.sectionTitle, styles.flex]}>Period</ThemedText>
            {tab === 'month' ? (
              <ThemedText themeColor="textTertiary" style={Type.caption}>
                Pick one or more
              </ThemedText>
            ) : null}
          </View>
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
                  multi
                  label={`${MONTHS_LONG[m.month - 1]} ${m.year}`}
                  hint={
                    m.key === thisKey ? `This month · ${formatPaise(m.total)}` : formatPaise(m.total)
                  }
                  selected={monthKeys.includes(m.key)}
                  onPress={() => toggleMonth(m.key)}
                />
              ))}
              {months.length > RECENT_MONTHS && startIndex < RECENT_MONTHS ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showEarlier }}
                  onPress={() => setShowEarlier((v) => !v)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.border,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}>
                  <ThemedText themeColor="textSecondary" style={[Type.body, styles.flex]}>
                    {showEarlier ? 'Fewer months' : 'Earlier months'}
                  </ThemedText>
                  <Icon
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
                hint={
                  custom.from ? formatRange(custom.from, custom.to ?? custom.from) : 'Opens a calendar'
                }
                selected={rangeKey === 'custom'}
                onPress={() => {
                  setRangeKey('custom');
                  setPicking(true);
                }}
              />
            </Card>
          )}
        </Appear>

        <Appear index={1} style={styles.section}>
          <ThemedText style={styles.sectionTitle}>File type</ThemedText>
          <Card padded={false}>
            <Option
              first
              icon="document-text-outline"
              label="PDF"
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
        </Appear>
      </ScrollView>

      <View
        style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
        <ThemedText
          themeColor="textTertiary"
          style={[Type.caption, styles.centered]}
          numberOfLines={1}>
          {needsMonths
            ? 'Pick at least one month'
            : `${period.label} · ${format === 'pdf' ? 'PDF' : 'CSV'} · My ledger`}
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
              <Icon
                name="download-outline"
                size={18}
                color={canDownload ? theme.onPrimary : theme.textTertiary}
              />
              <ThemedText
                style={[
                  styles.buttonText,
                  { color: canDownload ? theme.onPrimary : theme.textTertiary },
                ]}>
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
            {
              backgroundColor: custom.from ? theme.primary : theme.backgroundSelected,
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <ThemedText
            style={[styles.buttonText, { color: custom.from ? theme.onPrimary : theme.textTertiary }]}>
            Done
          </ThemedText>
        </Pressable>
      </Sheet>
    </SafeAreaView>
  );
}

/** One choice: an optional icon tile, a label and hint, a green tick. As on History's statement. */
function Option({
  label,
  hint,
  icon,
  selected,
  onPress,
  first,
  disabled = false,
  multi = false,
}: {
  label: string;
  hint?: string;
  icon?: IconName;
  selected: boolean;
  onPress: () => void;
  first: boolean;
  disabled?: boolean;
  /** One of several that can all be on: a checkbox rather than a radio. */
  multi?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 },
      ]}>
      {icon ? (
        <View style={[styles.tile, { backgroundColor: theme.primarySoft }]}>
          <Icon name={icon} size={17} color={theme.brandInk} />
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
          <Icon name="checkmark" size={14} color={theme.onPrimary} />
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
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4 },

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
