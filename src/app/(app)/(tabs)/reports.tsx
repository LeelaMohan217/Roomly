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
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { iconFor } from '@/lib/icons';
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

  const palette = [theme.chart1, theme.chart2, theme.chart3, theme.chart4, theme.chart5, theme.chart6];

  const slices: Slice[] = current
    .slice(0, 6)
    .map((r, i) => ({ key: r.categoryId, value: r.totalPaise, color: palette[i % palette.length] }));

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
          <ThemedText style={Type.headline}>
            {MONTHS[month - 1]} {year}
          </ThemedText>
          <NavButton icon="chevron-forward" onPress={() => step(1)} label="Next month" />
        </View>

        <Card>
          <ThemedText themeColor="textTertiary" style={Type.micro}>
            Total spent
          </ThemedText>
          <ThemedText style={Type.display} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatPaise(currentTotal)}</ThemedText>

          {previousTotal > 0 ? (
            <View style={styles.deltaRow}>
              <View
                style={[
                  styles.deltaPill,
                  { backgroundColor: delta > 0 ? theme.dangerSoft : theme.primarySoft },
                ]}>
                <Ionicons
                  name={delta > 0 ? 'trending-up' : 'trending-down'}
                  size={12}
                  color={delta > 0 ? theme.danger : theme.primary}
                />
                <ThemedText
                  style={[Type.micro, { color: delta > 0 ? theme.danger : theme.primary, fontWeight: '700' }]}>
                  {formatPaise(Math.abs(delta))}
                </ThemedText>
              </View>
              <ThemedText themeColor="textTertiary" style={Type.micro}>
                vs {SHORT[prev.getMonth()]} ({formatPaise(previousTotal)})
              </ThemedText>
            </View>
          ) : (
            <ThemedText themeColor="textTertiary" style={[Type.micro, styles.deltaRow]}>
              Nothing recorded the month before
            </ThemedText>
          )}

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
            <Section title="WHERE IT WENT">
              <Card style={styles.donutCard}>
                <DonutChart
                  data={slices}
                  size={132}
                  thickness={13}
                  caption="Total"
                  value={formatPaise(currentTotal)}
                />
                <View style={styles.legend}>
                  {current.slice(0, 5).map((c, i) => (
                    <View key={c.categoryId} style={styles.legendRow}>
                      <View style={[styles.dot, { backgroundColor: palette[i % palette.length] }]} />
                      <ThemedText
                        themeColor="textSecondary"
                        style={[Type.caption, styles.flex]}
                        numberOfLines={1}>
                        {c.categoryName}
                      </ThemedText>
                      <ThemedText style={Type.caption}>
                        {Math.round((c.totalPaise / currentTotal) * 100)}%
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </Card>
            </Section>

            <Section title="BY CATEGORY">
              <Card padded={false}>
                {current.map((c, i) => (
                  <View
                    key={c.categoryId}
                    style={[
                      styles.row,
                      i < current.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                      },
                    ]}>
                    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText allowFontScaling={false} style={styles.tileGlyph}>{iconFor(c.icon)}</ThemedText>
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={Type.body} numberOfLines={1}>
                        {c.categoryName}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {c.expenseCount} entr{c.expenseCount === 1 ? 'y' : 'ies'}
                      </ThemedText>
                    </View>
                    <ThemedText style={Type.amount}>{formatPaise(c.totalPaise)}</ThemedText>
                  </View>
                ))}
              </Card>
            </Section>

            {/* Rent and wifi aren't going down whatever you decide, so this is
                the only split that can change anyone's behaviour. */}
            <Section title="FIXED VS FLEXIBLE">
              <Card padded={false}>
                {byKind.map(([kind, amount], i) => (
                  <View
                    key={kind}
                    style={[
                      styles.row,
                      i < byKind.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                      },
                    ]}>
                    <View style={styles.flex}>
                      <ThemedText style={Type.body}>{KIND_LABEL[kind]}</ThemedText>
                      <View style={styles.trackRow}>
                        <View style={[styles.track, { backgroundColor: theme.chartTrack }]}>
                          <View
                            style={[
                              styles.fill,
                              {
                                backgroundColor:
                                  kind === 'consumption' ? theme.primary : theme.textTertiary,
                                width: `${share(amount)}%`,
                              },
                            ]}
                          />
                        </View>
                        <ThemedText themeColor="textTertiary" style={Type.micro}>
                          {share(amount)}%
                        </ThemedText>
                      </View>
                    </View>
                    <ThemedText style={Type.amount}>{formatPaise(amount)}</ThemedText>
                  </View>
                ))}
              </Card>
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NavButton({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={14}
      style={({ pressed }) => [
        styles.navButton,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.6 : 1,
        },
      ]}>
      <Ionicons name={icon} size={17} color={theme.textSecondary} />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText themeColor="textTertiary" style={[Type.label, styles.sectionTitle]}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: 130, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  chartBlock: { marginTop: Spacing.four },

  section: { gap: Spacing.two },
  sectionTitle: { paddingLeft: Spacing.half },

  donutCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  legend: { flex: 1, gap: Spacing.two },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 7, height: 7, borderRadius: 4 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileGlyph: { fontSize: 18 },

  trackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 5 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
