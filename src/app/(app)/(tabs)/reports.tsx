import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BarChart, type Bar } from '@/components/charts/bar-chart';
import { DonutChart, type Slice } from '@/components/charts/donut-chart';
import { ThemedText } from '@/components/themed-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, TabBarClearance, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';
import { useMonthlyTotals, type CategoryTotal } from '@/lib/queries';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const KIND_LABEL: Record<CategoryTotal['kind'], string> = {
  fixed: 'Fixed costs',
  bulk: 'Bulk buys',
  consumption: 'Day to day',
  asset: 'Assets',
};

export default function ReportsScreen() {
  const theme = useTheme();
  const totals = useMonthlyTotals();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const rows = totals.data ?? [];
  const forMonth = (y: number, m: number) => rows.filter((r) => r.year === y && r.month === m);
  const sum = (list: CategoryTotal[]) => list.reduce((acc, r) => acc + r.totalPaise, 0);

  const current = [...forMonth(year, month)].sort((a, b) => b.totalPaise - a.totalPaise);
  const currentTotal = sum(current);

  // A voided expense can leave a category row with a zero total, so `current`
  // can be non-empty while `currentTotal` is 0 — and amount / 0 is NaN, which
  // React Native renders as the literal width string "NaN%" and the label
  // "NaN%". Guarding here rather than at the two call sites keeps them honest
  // if a third appears.
  const share = (amount: number) =>
    currentTotal > 0 ? Math.round((amount / currentTotal) * 100) : 0;

  const prev = new Date(year, month - 2, 1);
  const previousTotal = sum(forMonth(prev.getFullYear(), prev.getMonth() + 1));
  const delta = currentTotal - previousTotal;

  const palette = [theme.chart1, theme.chart2, theme.chart3, theme.chart4, theme.chart5];

  // The five biggest categories get a colour each; everything after them
  // shares one grey slice, so the ring always adds up to the total and every
  // row in the list below has a dot that matches something in it.
  const colorAt = (i: number) => (i < palette.length ? palette[i] : theme.textTertiary);
  const rest = current.slice(palette.length);
  const slices: Slice[] = [
    ...current
      .slice(0, palette.length)
      .map((r, i) => ({ key: r.categoryId, value: r.totalPaise, color: colorAt(i) })),
    ...(rest.length > 0
      ? [{ key: 'rest', value: sum(rest), color: theme.textTertiary }]
      : []),
  ];

  // Flexible spending in brand green -- the part anyone can change -- and the
  // committed kinds in quieter tones.
  const kindColor: Record<CategoryTotal['kind'], string> = {
    consumption: theme.primary,
    bulk: theme.chart3,
    asset: theme.chart5,
    fixed: theme.textTertiary,
  };

  // Not hand-memoized: React Compiler is enabled (app.json), and it could not
  // preserve a useMemo whose deps are rebuilt every render -- it reported
  // "Compilation Skipped", meaning the whole file went un-optimised to keep a
  // memo that was not helping. Plain derivation lets the compiler do it.
  const byKind = (() => {
    const out = new Map<CategoryTotal['kind'], number>();
    for (const r of current) out.set(r.kind, (out.get(r.kind) ?? 0) + r.totalPaise);
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const bars: Bar[] = (() => {
    const out: Bar[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      out.push({ key: `${y}-${m}`, label: SHORT[m - 1], value: sum(forMonth(y, m)) });
    }
    return out;
  })();

  // There is nothing to report on in a month that has not happened. Without
  // this you could chevron forward to December 2098 through empty screens.
  const thisMonth = new Date();
  const atLatest =
    year > thisMonth.getFullYear() ||
    (year === thisMonth.getFullYear() && month >= thisMonth.getMonth() + 1);

  function step(by: number) {
    if (by > 0 && atLatest) return;
    const d = new Date(year, month - 1 + by, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <AppBar title="Reports" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.monthNav}>
          <NavButton icon="chevron-back" onPress={() => step(-1)} label="Previous month" />
          <ThemedText style={styles.monthTitle}>
            {MONTHS[month - 1]} {year}
          </ThemedText>
          <NavButton
            icon="chevron-forward"
            onPress={() => step(1)}
            label="Next month"
            disabled={atLatest}
          />
        </View>

        <Card>
          <ThemedText themeColor="textTertiary" style={Type.caption}>
            Spent
          </ThemedText>
          {/* The change beside the amount it qualifies: red when the house
              spent more than last month, green when less. Last month's own
              figure is the bar beside this one in the chart below. */}
          <View style={styles.totalRow}>
            <ThemedText
              style={[styles.total, styles.flex]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}>
              {formatPaise(currentTotal)}
            </ThemedText>
            {previousTotal > 0 && delta !== 0 ? (
              <View
                accessible
                accessibilityLabel={`${formatPaise(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than ${MONTHS[prev.getMonth()]}`}
                style={[
                  styles.deltaPill,
                  { backgroundColor: delta > 0 ? theme.dangerSoft : theme.successSoft },
                ]}>
                <Ionicons
                  name={delta > 0 ? 'trending-up' : 'trending-down'}
                  size={13}
                  color={delta > 0 ? theme.danger : theme.success}
                />
                <ThemedText
                  style={[styles.deltaText, { color: delta > 0 ? theme.danger : theme.success }]}>
                  {formatPaise(Math.abs(delta))}
                </ThemedText>
              </View>
            ) : null}
          </View>

          <View style={styles.chartBlock}>
            <BarChart
              data={bars}
              height={96}
              selectedKey={`${year}-${month}`}
              onSelect={(key) => {
                const [y, m] = key.split('-').map(Number);
                setYear(y);
                setMonth(m);
              }}
            />
          </View>
        </Card>

        {queryState(totals, 'your reports') ?? null}

        {!totals.isLoading && !totals.isError && current.length === 0 ? (
          <Card style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={22} color={theme.textTertiary} />
            <ThemedText style={Type.headline}>Nothing this month</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
              Expenses you add will break down here by category.
            </ThemedText>
          </Card>
        ) : current.length === 0 ? null : (
          <>
            {/* The donut and the list are one thing: each row's dot is its
                slice. They used to be a donut with a legend AND a separate
                "By category" list, which named every category twice. */}
            <Section title="Where it went">
              <Card padded={false}>
                <View style={styles.donutWrap}>
                  <DonutChart
                    data={slices}
                    size={140}
                    thickness={14}
                    caption="Total"
                    value={formatPaise(currentTotal)}
                  />
                </View>
                {current.map((c, i) => (
                  <View
                    key={c.categoryId}
                    accessible
                    accessibilityLabel={`${c.categoryName}, ${share(c.totalPaise)} percent, ${formatPaise(c.totalPaise)}`}
                    style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                    <View style={[styles.dot, { backgroundColor: colorAt(i) }]} />
                    <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                      {c.categoryName}
                    </ThemedText>
                    <ThemedText themeColor="textTertiary" style={[Type.caption, styles.percent]}>
                      {share(c.totalPaise)}%
                    </ThemedText>
                    <ThemedText style={[Type.amount, styles.amount]}>{formatPaise(c.totalPaise)}</ThemedText>
                  </View>
                ))}
              </Card>
            </Section>

            {/* Rent and wifi aren't going down whatever you decide, so this is
                the only split that can change anyone's behaviour. One bar for
                the whole month, cut by kind, instead of a bar on every row. */}
            <Section title="Fixed vs flexible">
              <Card style={styles.kindCard}>
                <View style={[styles.kindBar, { backgroundColor: theme.chartTrack }]}>
                  {byKind.map(([kind, amount]) => (
                    <View
                      key={kind}
                      style={{ width: `${share(amount)}%`, backgroundColor: kindColor[kind] }}
                    />
                  ))}
                </View>
                <View style={styles.kindLegend}>
                  {byKind.map(([kind, amount]) => (
                    <View
                      key={kind}
                      accessible
                      accessibilityLabel={`${KIND_LABEL[kind]}, ${formatPaise(amount)}`}
                      style={styles.kindItem}>
                      <View style={[styles.dot, { backgroundColor: kindColor[kind] }]} />
                      <ThemedText themeColor="textSecondary" style={Type.caption}>
                        {KIND_LABEL[kind]}
                      </ThemedText>
                      <ThemedText style={[Type.caption, styles.medium]}>{formatPaise(amount)}</ThemedText>
                    </View>
                  ))}
                </View>
              </Card>
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A round arrow button. Greyed at the latest month, where there is no next. */
function NavButton({
  icon,
  onPress,
  label,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={14}
      style={({ pressed }) => [
        styles.navButton,
        { backgroundColor: theme.backgroundSelected, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}>
      <Ionicons name={icon} size={17} color={theme.text} />
    </Pressable>
  );
}

/** Sentence case at heading size, as on Home, History and Settle up. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: TabBarClearance, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  medium: { fontWeight: '600' },

  // Arrows close to the month they change, not pushed to the screen edges.
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  monthTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.3, minWidth: 150, textAlign: 'center' },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  totalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  total: { fontSize: 30, lineHeight: 38, fontWeight: '700', letterSpacing: -1 },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
  },
  deltaText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  chartBlock: { marginTop: Spacing.four },

  section: { gap: Spacing.two },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.3 },

  donutWrap: { alignItems: 'center', paddingVertical: Spacing.four },
  dot: { width: 9, height: 9, borderRadius: 5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  // Fixed widths, so the percentages and amounts line up down the list.
  percent: { width: 40, textAlign: 'right' },
  amount: { minWidth: 84, textAlign: 'right' },

  kindCard: { gap: Spacing.three },
  kindBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  kindLegend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.four, rowGap: Spacing.two },
  kindItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
