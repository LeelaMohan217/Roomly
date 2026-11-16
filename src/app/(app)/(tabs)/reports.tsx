import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarChart, compactRupees, type Bar } from '@/components/charts/bar-chart';
import { DonutChart, type Slice } from '@/components/charts/donut-chart';
import { ThemedText } from '@/components/themed-text';
import { Appear, Reveal } from '@/components/ui/motion';
import { Money } from '@/components/ui/money';
import { queryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing, TabBarClearance, Type, washLocations } from '@/constants/theme';
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
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  // How far down the green wash reaches: measured from the title, month and
  // total, plus enough to run behind the top of the chart card.
  const [washHeight, setWashHeight] = useState(440);

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

  // The months in the chart that had spending, averaged: the dashed line.
  const spentMonths = bars.filter((b) => b.value > 0);
  const sixMonthAverage =
    spentMonths.length > 0 ? spentMonths.reduce((s2, b) => s2 + b.value, 0) / spentMonths.length : 0;

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

  const card = {
    backgroundColor: theme.lift,
    borderColor: theme.liftEdge,
    shadowColor: theme.liftShadow,
  };

  return (
    // No top edge: the wash runs up under the status bar, and the scroll
    // content pads itself by the inset instead.
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* White status bar icons over the wash while Reports is showing. */}
      {focused ? <StatusBar style="light" /> : null}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}>
        {/* The green wash, as on Home: it scrolls with the content, and the
            chart card overlaps where it fades into the page. */}
        <LinearGradient
          pointerEvents="none"
          colors={[
            theme.washTop,
            theme.washMid,
            theme.washLow,
            theme.washFade,
            theme.washMint,
            theme.background,
          ]}
          locations={washLocations(washHeight)}
          style={[styles.wash, { height: washHeight }]}
        />

        <View
          style={styles.top}
          onLayout={(e) => {
            // Never shorter than the wash's own colour stops, or the fade
            // into the page is squeezed into a hard edge.
            const h = Math.max(
              Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height + 150),
              560
            );
            if (h !== washHeight) setWashHeight(h);
          }}>
          <ThemedText style={[styles.screenTitle, { color: theme.onWash }]}>Reports</ThemedText>

          {/* The hero, all on one centre line: which month, what it cost,
              and how that compares. Centred so the eye lands on the number,
              with the month as a frosted capsule you step through. */}
          <Appear style={styles.monthNav}>
            <View style={[styles.monthPill, { backgroundColor: theme.frost, borderColor: theme.frostEdge }]}>
              <NavButton icon="chevron-back" onPress={() => step(-1)} label="Previous month" />
              <ThemedText
                style={[styles.monthTitle, { color: theme.onWash }]}
                numberOfLines={1}
                accessibilityRole="header">
                {MONTHS[month - 1]} {year}
              </ThemedText>
              <NavButton
                icon="chevron-forward"
                onPress={() => step(1)}
                label="Next month"
                disabled={atLatest}
              />
            </View>
          </Appear>

          <Appear index={1} style={styles.hero}>
            <ThemedText style={[Type.caption, { color: theme.onWashMuted }]}>
              {atLatest ? 'Spent this month' : `Spent in ${MONTHS[month - 1]}`}
            </ThemedText>
            {/* A shape until the totals arrive: "₹0.00" before they did was a
                wrong answer, shown first. */}
            {totals.data ? (
              <Reveal>
                <Money paise={currentTotal} size="hero" color={theme.onWash} />
              </Reveal>
            ) : (
              <View style={styles.totalSkeleton}>
                <Skeleton width={180} height={30} tint={theme.frost} />
              </View>
            )}
            {/* The change, as a frosted chip: up when the house spent more
                than last month, down when less, in words as well as the
                arrow. Last month's own figure is its bar in the chart. */}
            {totals.data && previousTotal > 0 && delta !== 0 ? (
              <View
                accessible
                accessibilityLabel={`${formatPaise(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than ${MONTHS[prev.getMonth()]}`}
                style={[styles.deltaPill, { backgroundColor: theme.frost, borderColor: theme.frostEdge }]}>
                <Ionicons
                  name={delta > 0 ? 'trending-up' : 'trending-down'}
                  size={14}
                  color={theme.onWash}
                />
                <ThemedText style={[Type.caption, styles.semi, { color: theme.onWash }]} numberOfLines={1}>
                  {formatPaise(Math.abs(delta))} {delta > 0 ? 'more' : 'less'} than {SHORT[prev.getMonth()]}
                </ThemedText>
              </View>
            ) : null}
          </Appear>
        </View>

        {/* The last six months, in the white card lifted over the bottom of
            the wash. Tapping a column picks that month. */}
        <Appear index={2}>
          <View style={[styles.lift, card]}>
            <View style={styles.liftHead}>
              <View style={styles.flex}>
                <ThemedText style={[Type.caption, styles.semi]}>Last 6 months</ThemedText>
                <ThemedText themeColor="textSecondary" style={Type.micro}>
                  Tap a month to see it
                </ThemedText>
              </View>
              {/* The dashed line's figure, in words. */}
              {sixMonthAverage > 0 ? (
                <View style={styles.avg}>
                  <View style={[styles.avgDash, { borderColor: theme.textTertiary }]} />
                  <ThemedText themeColor="textSecondary" style={Type.micro}>
                    Avg {compactRupees(sixMonthAverage)}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <BarChart
              data={bars}
              selectedKey={`${year}-${month}`}
              onSelect={(key) => {
                const [y, m] = key.split('-').map(Number);
                setYear(y);
                setMonth(m);
              }}
            />
          </View>
        </Appear>

        {queryState(totals, 'your reports') ?? null}

        {/* These mount when the totals land (or when a month with spending
            replaces an empty one), so their entrance doubles as the swap
            from the skeleton above. A refetch keeps them mounted. */}
        {!totals.isLoading && !totals.isError && current.length === 0 ? (
          <Appear index={3}>
          <View style={[styles.cardBox, styles.empty, card]}>
            <Ionicons name="bar-chart-outline" size={22} color={theme.textTertiary} />
            <ThemedText style={Type.headline}>Nothing this month</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
              Expenses you add will break down here by category.
            </ThemedText>
          </View>
          </Appear>
        ) : current.length === 0 ? null : (
          <>
            {/* The donut and the list are one thing: each row's dot is its
                slice. They used to be a donut with a legend AND a separate
                "By category" list, which named every category twice. */}
            <Appear index={3}>
            <Section title="Where it went">
              <View style={[styles.cardBox, card]}>
                <View style={styles.donutWrap}>
                  <DonutChart
                    data={slices}
                    size={150}
                    thickness={16}
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
                    {/* The category's own colour, as a rounded tile like the
                        expense rows elsewhere, with its share under the name. */}
                    <View style={[styles.swatch, { backgroundColor: theme.liftTile }]}>
                      <View style={[styles.dot, { backgroundColor: colorAt(i) }]} />
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={[Type.body, styles.semi]} numberOfLines={1}>
                        {c.categoryName}
                      </ThemedText>
                      <View style={[styles.shareTrack, { backgroundColor: theme.chartTrack }]}>
                        <View
                          style={[
                            styles.shareFill,
                            { width: `${Math.max(share(c.totalPaise), 1)}%`, backgroundColor: colorAt(i) },
                          ]}
                        />
                      </View>
                    </View>
                    <View style={styles.amountCol}>
                      <Money paise={c.totalPaise} size="row" />
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {share(c.totalPaise)}%
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            </Section>
            </Appear>

            {/* Rent and wifi aren't going down whatever you decide, so this is
                the only split that can change anyone's behaviour. One bar for
                the whole month, cut by kind, instead of a bar on every row. */}
            <Appear index={4}>
            <Section title="Fixed vs flexible">
              <View style={[styles.cardBox, styles.kindCard, card]}>
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
                      style={[styles.kindTile, { backgroundColor: theme.liftTile }]}>
                      <View style={styles.kindHead}>
                        <View style={[styles.dot, { backgroundColor: kindColor[kind] }]} />
                        <ThemedText themeColor="textSecondary" style={Type.micro} numberOfLines={1}>
                          {KIND_LABEL[kind]}
                        </ThemedText>
                      </View>
                      <Money paise={amount} size="card" />
                    </View>
                  ))}
                </View>
              </View>
            </Section>
            </Appear>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A round frosted arrow button. Greyed at the latest month, where there is no next. */
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
        {
          backgroundColor: theme.frost,
          borderColor: theme.frostEdge,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
      ]}>
      <Ionicons name={icon} size={17} color={theme.frostIcon} />
    </Pressable>
  );
}

/** Section title as on Home: large and medium weight. */
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
  // 18 at the sides, as on Home; the cards reach 4 further out.
  content: { paddingHorizontal: 18, paddingBottom: TabBarClearance, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  semi: { fontWeight: '600' },

  wash: { position: 'absolute', top: 0, left: 0, right: 0 },
  top: { gap: Spacing.three, paddingTop: Spacing.three },
  screenTitle: { fontSize: 30, lineHeight: 38, fontWeight: '600', letterSpacing: -0.8 },

  // The month capsule, centred: arrows inside it, close to the month they
  // change. Fixed width, so it does not jump as the month name changes.
  monthNav: { alignItems: 'center', marginTop: Spacing.one },
  monthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 250,
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  monthTitle: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600', letterSpacing: -0.2, textAlign: 'center' },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  hero: { alignItems: 'center', gap: Spacing.one, marginTop: Spacing.two },
  // The total's own line height, so nothing shifts when the number lands.
  totalSkeleton: { height: 50, justifyContent: 'center' },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
    marginTop: Spacing.one,
  },

  // The lifted chart card, as Home's This month.
  lift: {
    marginHorizontal: -4,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  liftHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avgDash: { width: 14, borderTopWidth: 1, borderStyle: 'dashed' },
  // The other cards: soft white, rounded, a hairline edge and no shadow.
  cardBox: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },

  section: { gap: Spacing.two + 2 },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4, paddingLeft: Spacing.half },

  donutWrap: { alignItems: 'center', paddingVertical: Spacing.four },
  dot: { width: 10, height: 10, borderRadius: 5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  swatch: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  shareTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  shareFill: { height: 4, borderRadius: 2 },
  amountCol: { alignItems: 'flex-end', minWidth: 84 },

  kindCard: { gap: Spacing.three, padding: Spacing.three },
  kindBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  kindLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  kindTile: { flexGrow: 1, flexBasis: '45%', borderRadius: 16, padding: Spacing.two + Spacing.one, gap: 4 },
  kindHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
