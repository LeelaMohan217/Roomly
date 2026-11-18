import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApprovalTag, approvalAmountStyle } from '@/components/approval-tag';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Appear } from '@/components/ui/motion';
import { Money } from '@/components/ui/money';
import { queryState } from '@/components/ui/query-state';
import { appFontFor } from '@/constants/fonts';
import { Radius, Spacing, TabBarClearance, Type, washLocations } from '@/constants/theme';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, formatRange } from '@/lib/dates';
import { activeFilterCount, useHistoryFilters } from '@/lib/history-filters';
import { categoryColor, categoryIcon, categoryTint } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useCategories, useExpenses, useMembers, type Expense } from '@/lib/queries';
import { Icon } from '@/components/ui/icon';

/** A screenful: month headings and days past this are below the fold. */
const ENTRANCE_STEPS = 10;
/** After this the entrance is over; the longest one has finished by then. */
const SETTLE_MS = 800;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


/**
 * Every expense, newest first, grouped by month under a card with the
 * month's total, then by day, one card per expense.
 *
 * A search bar filters as you type (description, category, who paid), and
 * the filter button opens a full-screen page for date range, category and
 * who paid. With no date range the newest 200 load, a few months for a
 * household; a date range is fetched from the server in full, so filtering
 * further back still finds everything.
 */
/** The search bar's and chips' outline: bright enough to read on the lighter green. */
const BRIGHT_EDGE = 'rgba(255,255,255,0.75)';

export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  // How far down the green wash reaches: the header's height plus enough to
  // run behind the top of the first month card.
  const [washHeight, setWashHeight] = useState(300);
  const filters = useHistoryFilters();
  const clearFilters = useHistoryFilters((s) => s.clear);
  const applyFilters = useHistoryFilters((s) => s.apply);
  // The chips change only the categories; every other filter stays as set.
  const setCategories = (categoryIds: string[]) =>
    applyFilters({ categoryIds, paidByIds: filters.paidByIds, from: filters.from, to: filters.to });
  const categories = useCategories();
  const members = useMembers();
  const ranged = !!(filters.from || filters.to);
  const expenses = useExpenses(ranged ? 2000 : 200, { from: filters.from, to: filters.to });
  const pull = usePullRefresh(() => expenses.refetch());

  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filterCount = activeFilterCount(filters);

  // Not memoized by hand: React Compiler is enabled and does it, and
  // `expenses.data ?? []` builds a fresh array each render anyway.
  const shown = (expenses.data ?? []).filter(
    (e) =>
      (filters.categoryIds.length === 0 ||
        (e.categoryId !== null && filters.categoryIds.includes(e.categoryId))) &&
      (filters.paidByIds.length === 0 || filters.paidByIds.includes(e.paidById)) &&
      (!needle ||
        [e.description ?? '', e.categoryName, e.paidByName].join(' ').toLowerCase().includes(needle))
  );

  // Rows arrive newest first, so months -- and the days inside each -- come
  // out in order as they're met. A section is a month; its items are days,
  // each drawn as one grouped list.
  const byKey = (rows: Expense[], keyOf: (e: Expense) => string) =>
    Object.entries(
      rows.reduce<Record<string, Expense[]>>((acc, e) => {
        (acc[keyOf(e)] ??= []).push(e);
        return acc;
      }, {})
    );

  const sections = byKey(shown, (e) => e.expenseDate.slice(0, 7)).map(([key, rows]) => {
    const [y, m] = key.split('-').map(Number);
    return {
      key,
      title: `${MONTHS[m - 1]} ${y}`,
      // Approved only: a waiting or rejected expense is listed, not counted
      // (0039), so the band agrees with the month's statement.
      total: rows.reduce((sum, e) => sum + (e.approvalStatus === 'approved' ? e.totalPaise : 0), 0),
      data: byKey(rows, (e) => e.expenseDate).map(([day, items]) => ({ day, items })),
    };
  });

  // The entrance order: search bar (0), then each month's total followed by
  // its days, as they appear down the list.
  const order = new Map<string, number>();
  let step = 1;
  for (const s of sections) {
    order.set(`m${s.key}`, step++);
    for (const d of s.data) order.set(`d${d.day}`, step++);
  }

  // Only what is on screen when the list first lands rises in, one after
  // another. Anything that mounts after that -- rows scrolled into view, a
  // search narrowing the list, a refetch -- appears in place, so nothing
  // animates under someone reading or scrolling.
  const hasData = !!expenses.data;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!hasData) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [hasData]);

  const entrance = (key: string) => {
    const index = order.get(key) ?? 0;
    return { index, still: settled || index > ENTRANCE_STEPS };
  };

  // The applied filters in words, so a short list never looks like lost data.
  const filterSummary = [
    filters.from ? formatRange(filters.from, filters.to ?? filters.from) : null,
    filters.categoryIds.length > 0
      ? filters.categoryIds
          .map((id) => categories.data?.find((c) => c.id === id)?.name)
          .filter(Boolean)
          .join(', ')
      : null,
    filters.paidByIds.length > 0
      ? `paid by ${filters.paidByIds
          .map((id) => members.data?.find((m) => m.id === id)?.displayName)
          .filter(Boolean)
          .join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const narrowed = filterCount > 0 || !!needle;

  const now = new Date();
  // "2026-11", the same shape as a section's key.
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // The header -- title, search and filter, and what is filtered -- stands
  // on a short green wash and scrolls away with the list, as Home's does.
  const header = (
    <View
      onLayout={(e) => {
        // Past the top of the first month card, so the green dissolves
        // behind it rather than stopping at a line.
        const h = Math.round(e.nativeEvent.layout.height + insets.top + 230);
        if (h !== washHeight) setWashHeight(h);
      }}>
      {/* Reaches up under the status bar and out to both screen edges; the
          month card below overlaps where it fades into the page. */}
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
        // The same soft dissolve as Home and Reports.
        locations={washLocations()}
        style={[styles.wash, { top: -insets.top, height: washHeight }]}
      />

      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <ThemedText style={[styles.screenTitle, { color: theme.onWash }]}>History</ThemedText>
        </View>
        {/* Each month card opens that month's statement. This one downloads
            a statement for any range. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download statement"
          onPress={() => router.push('/statement')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerIcon,
            { backgroundColor: theme.frost, borderColor: theme.frostEdge, opacity: pressed ? 0.7 : 1 },
          ]}>
          <Icon name="download-outline" size={19} color={theme.frostIcon} />
        </Pressable>
      </View>

      <Appear style={styles.top}>
        {/* Search and filter share one bar: the two ways of narrowing the
            same list, side by side. Transparent -- no fill, only its outline
            -- with white text and icons, so the wash shows straight through
            instead of a solid white block. */}
        <View style={[styles.search, { backgroundColor: 'transparent', borderColor: BRIGHT_EDGE }]}>
          <Icon name="search" size={18} color={theme.onWash} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search expenses"
            placeholderTextColor={theme.onWashMuted}
            selectionColor={theme.onWash}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, Type.body, appFontFor(Type.body), { color: theme.onWash }]}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={10}>
              <Icon name="close-circle" size={17} color={theme.onWashMuted} />
            </Pressable>
          ) : null}
          <View style={[styles.searchDivider, { backgroundColor: BRIGHT_EDGE }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} on` : 'Filter expenses'}
            onPress={() => router.push('/history-filters')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.filterButton,
              // On: a solid white disc, like a chip that is on.
              filterCount > 0 && { backgroundColor: theme.washField },
              { opacity: pressed ? 0.7 : 1 },
            ]}>
            <Icon
              name="options-outline"
              size={19}
              color={filterCount > 0 ? theme.tabActiveInk : theme.onWash}
            />
            {filterCount > 0 ? (
              <View
                style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.washTop }]}>
                <ThemedText style={styles.badgeText} allowFontScaling={false}>
                  {filterCount}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Quick category chips, the same filter the Filters page sets: All
            clears it, a category turns on or off. Frosted on the wash; a
            chip that is on goes solid white. */}
        {categories.data && categories.data.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.chipsBleed}
            contentContainerStyle={styles.chips}>
            <Chip label="All" on={filters.categoryIds.length === 0} onPress={() => setCategories([])} />
            {categories.data.map((c) => {
              const on = filters.categoryIds.includes(c.id);
              return (
                <Chip
                  key={c.id}
                  label={c.name}
                  on={on}
                  onPress={() =>
                    setCategories(
                      on
                        ? filters.categoryIds.filter((id) => id !== c.id)
                        : [...filters.categoryIds, c.id]
                    )
                  }
                />
              );
            })}
          </ScrollView>
        ) : null}

        {filterCount > 0 ? (
          <View style={styles.filterLine}>
            <ThemedText style={[Type.micro, styles.flex, { color: theme.onWashMuted }]} numberOfLines={2}>
              {filterSummary}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={clearFilters}
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <ThemedText style={[Type.micro, styles.clear, { color: theme.onWash }]}>Clear</ThemedText>
            </Pressable>
          </View>
        ) : null}
      </Appear>
    </View>
  );

  const cardColors = {
    backgroundColor: theme.lift,
    borderColor: theme.liftEdge,
    shadowColor: theme.liftShadow,
  };

  return (
    // No top edge: the wash runs up under the status bar, and the list pads
    // itself by the inset instead.
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* White status bar icons over the wash while History is showing. */}
      {focused ? <StatusBar style="light" /> : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.day}
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        progressViewOffset={insets.top}
        ListHeaderComponent={header}
        ListEmptyComponent={
          // "Nothing logged yet" is a claim about the data, so it may only be
          // made once the data has been read. This used to be shown after a
          // failed fetch too, telling a user with an expired session that
          // their household had no expenses.
          queryState(expenses, 'your expenses') ??
          (narrowed ? (
            <Card style={styles.empty}>
              <Icon name="search-outline" size={22} color={theme.textTertiary} />
              <ThemedText style={Type.headline}>Nothing matches</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                Try another word, or clear the filters.
              </ThemedText>
            </Card>
          ) : (
            <Card style={styles.empty}>
              <Icon name="receipt-outline" size={22} color={theme.textTertiary} />
              <ThemedText style={Type.headline}>Nothing logged yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                Expenses you add will appear here, grouped by month.
              </ThemedText>
            </Card>
          ))
        }
        renderSectionHeader={({ section }) => {
          const entries = section.data.reduce((n, d) => n + d.items.length, 0);
          return (
            // One white card per month: what the month cost and how many
            // entries it has. Tapping it opens that month's statement.
            <Appear {...entrance(`m${section.key}`)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${section.title}, ${formatPaise(section.total)}, ${entries} ${entries === 1 ? 'entry' : 'entries'}. Open statement`}
                onPress={() =>
                  router.push({
                    pathname: '/month-statement',
                    params: { year: section.key.slice(0, 4), month: String(Number(section.key.slice(5, 7))) },
                  })
                }
                style={({ pressed }) => [
                  styles.monthCard,
                  cardColors,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <View style={styles.flex}>
                  <ThemedText themeColor="textSecondary" style={Type.micro}>
                    {section.key === thisMonthKey ? 'Spent this month' : `Spent in ${section.title}`}
                  </ThemedText>
                  <Money paise={section.total} size="month" />
                </View>
                <View style={styles.entries}>
                  <ThemedText themeColor="textSecondary" style={Type.micro}>
                    Entries
                  </ThemedText>
                  <ThemedText style={styles.entriesCount}>{entries}</ThemedText>
                </View>
                <Icon name="chevron-forward" size={16} color={theme.textTertiary} />
              </Pressable>
            </Appear>
          );
        }}
        // Each day under its name and the day's total; every expense is a
        // card of its own. The date lives in the heading, so the rows carry
        // only what differs between them.
        renderItem={({ item: day }) => {
          // Approved only, like the month total, so the two agree.
          const dayTotal = day.items.reduce(
            (sum, e) => sum + (e.approvalStatus === 'approved' ? e.totalPaise : 0),
            0
          );
          return (
            <Appear {...entrance(`d${day.day}`)} style={styles.day}>
              <View style={styles.dayHead}>
                <ThemedText style={[Type.caption, styles.semi, styles.flex]}>{dayLabel(day.day)}</ThemedText>
                <ThemedText themeColor="textSecondary" style={Type.caption}>
                  {formatPaise(dayTotal)}
                </ThemedText>
              </View>
              {day.items.map((item) => (
                <View key={item.id} style={[styles.rowCard, cardColors]}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/expense/[id]', params: { id: item.id } })}
                    // Pressed is a tint, not a fade: lowering opacity under a
                    // card with Android elevation leaves a pale band.
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: theme.backgroundSelected },
                    ]}>
                    {/* Each category in its own colour on a soft tint, as on Home's Recent. */}
                    <View style={[styles.tile, { backgroundColor: categoryTint(item.categoryIcon) }]}>
                      <Icon name={categoryIcon(item.categoryIcon)} size={18} color={categoryColor(item.categoryIcon)} />
                    </View>

                    <View style={styles.rowText}>
                      <ThemedText style={[Type.body, styles.semi]} numberOfLines={1}>
                        {item.description || item.categoryName}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
                        {item.paidByName} · {item.participantCount} way
                        {item.participantCount === 1 ? '' : 's'}
                      </ThemedText>
                      <ApprovalTag status={item.approvalStatus} />
                    </View>

                    <Money
                      paise={item.totalPaise}
                      size="row"
                      extra={approvalAmountStyle(theme, item.approvalStatus)}
                    />
                  </Pressable>
                </View>
              ))}
            </Appear>
          );
        }}
      />
    </SafeAreaView>
  );
}

/** One category chip on the wash: its name only. */
function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        // The one that is on is solid white; the rest are transparent -- an
        // outline and white words -- like the search bar above them.
        on
          ? { backgroundColor: theme.washField, borderColor: theme.washField }
          : { backgroundColor: 'transparent', borderColor: BRIGHT_EDGE },
        { opacity: pressed ? 0.7 : 1 },
      ]}>
      <ThemedText
        style={[Type.caption, styles.semi, { color: on ? theme.tabActiveInk : theme.onWash }]}
        numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  chipsBleed: { marginHorizontal: -18 },
  chips: { paddingHorizontal: 18, gap: Spacing.two, paddingTop: Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  // Out to both screen edges from inside the list's 18 padding.
  wash: { position: 'absolute', left: -18, right: -18 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  screenTitle: { fontSize: 30, lineHeight: 38, fontWeight: '600', letterSpacing: -0.8 },
  top: { gap: Spacing.two, paddingBottom: Spacing.two },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one + 2,
    minHeight: 50,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.two },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchDivider: { width: StyleSheet.hairlineWidth, height: 24 },
  filterButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The month: a lifted white card, like Home's This month.
  monthCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: -4,
    marginTop: Spacing.three,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three + 2,
    paddingVertical: Spacing.three,
  },
  entries: { alignItems: 'flex-end' },
  entriesCount: { fontSize: 22, lineHeight: 29, fontWeight: '600', letterSpacing: -0.6 },
  day: { gap: Spacing.two, marginTop: Spacing.three + 2 },
  dayHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.half },
  filterLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.half },
  clear: { fontWeight: '600' },
  content: { paddingHorizontal: 18, paddingBottom: TabBarClearance },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '600', lineHeight: 14 },
  centered: { textAlign: 'center' },
  // One card per expense, as on Home's Recent.
  rowCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.two + Spacing.one,
  },
  tile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileGlyph: { fontSize: 18 },
  rowText: { flex: 1, gap: 1 },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five, marginTop: Spacing.three },
});
