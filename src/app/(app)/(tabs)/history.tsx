import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, TabBarClearance, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, formatRange } from '@/lib/dates';
import { activeFilterCount, useHistoryFilters } from '@/lib/history-filters';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useCategories, useExpenses, useMembers, type Expense } from '@/lib/queries';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];


/**
 * Every expense, newest first, grouped by month under the month's total.
 *
 * A search bar filters as you type (description, category, who paid), and
 * the filter button opens a full-screen page for date range, category and
 * who paid. With no date range the newest 200 load, a few months for a
 * household; a date range is fetched from the server in full, so filtering
 * further back still finds everything.
 */
export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const filters = useHistoryFilters();
  const clearFilters = useHistoryFilters((s) => s.clear);
  const categories = useCategories();
  const members = useMembers();
  const ranged = !!(filters.from || filters.to);
  const expenses = useExpenses(ranged ? 2000 : 200, { from: filters.from, to: filters.to });

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
      total: rows.reduce((sum, e) => sum + e.totalPaise, 0),
      data: byKey(rows, (e) => e.expenseDate).map(([day, items]) => ({ day, items })),
    };
  });

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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Title only: search and filter sit in the bar below, and each month
          band opens that month's statement. */}
      <AppBar title="History" action={null} />

      <View style={styles.top}>
        {/* Search and filter share one bar: the two ways of narrowing the
            same list, side by side. */}
        <View
          style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <Ionicons name="search" size={18} color={theme.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, Type.body, { color: theme.text }]}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={10}>
              <Ionicons name="close-circle" size={17} color={theme.textTertiary} />
            </Pressable>
          ) : null}
          <View style={[styles.searchDivider, { backgroundColor: theme.border }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} on` : 'Filter expenses'}
            onPress={() => router.push('/history-filters')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.filterButton,
              filterCount > 0 && { backgroundColor: theme.primary },
              { opacity: pressed ? 0.7 : 1 },
            ]}>
            <Ionicons
              name="options-outline"
              size={19}
              color={filterCount > 0 ? theme.onPrimary : theme.brandInk}
            />
            {filterCount > 0 ? (
              <View
                style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.backgroundElement }]}>
                <ThemedText style={styles.badgeText} allowFontScaling={false}>
                  {filterCount}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        </View>

        {filterCount > 0 ? (
          <View style={styles.filterLine}>
            <ThemedText themeColor="textSecondary" style={[Type.micro, styles.flex]} numberOfLines={2}>
              {filterSummary}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={clearFilters}
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <ThemedText style={[Type.micro, styles.clear, { color: theme.brandInk }]}>Clear</ThemedText>
            </Pressable>
          </View>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.day}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={expenses.isFetching}
        onRefresh={() => void expenses.refetch()}
        ListEmptyComponent={
          // "Nothing logged yet" is a claim about the data, so it may only be
          // made once the data has been read. This used to be shown after a
          // failed fetch too, telling a user with an expired session that
          // their household had no expenses.
          queryState(expenses, 'your expenses') ??
          (narrowed ? (
            <Card style={styles.empty}>
              <Ionicons name="search-outline" size={22} color={theme.textTertiary} />
              <ThemedText style={Type.headline}>Nothing matches</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                Try another word, or clear the filters.
              </ThemedText>
            </Card>
          ) : (
            <Card style={styles.empty}>
              <Ionicons name="receipt-outline" size={22} color={theme.textTertiary} />
              <ThemedText style={Type.headline}>Nothing logged yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                Expenses you add will appear here, grouped by month.
              </ThemedText>
            </Card>
          ))
        }
        renderSectionHeader={({ section }) => (
          // Plain text, the month on the left and its total in grey on the
          // right; tapping it opens that month's statement. Sentence case, as
          // on Home -- spaced capitals clipped the last letter on Android.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${section.title}, ${formatPaise(section.total)}. Open statement`}
            onPress={() =>
              router.push({
                pathname: '/month-statement',
                params: { year: section.key.slice(0, 4), month: String(Number(section.key.slice(5, 7))) },
              })
            }
            hitSlop={6}
            style={({ pressed }) => [styles.monthHead, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText style={[styles.monthTitle, styles.flex]}>{section.title}</ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.caption}>
              {formatPaise(section.total)}
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
          </Pressable>
        )}
        // One grouped list per day, under the day's name: the date lives in
        // the heading, so the rows carry only what differs between them.
        renderItem={({ item: day }) => (
          <View style={styles.day}>
            <ThemedText themeColor="textTertiary" style={Type.caption}>
              {dayLabel(day.day)}
            </ThemedText>
            <Card padded={false}>
              {day.items.map((item, i) => (
                <Pressable
                  key={item.id}
                  onPress={() => router.push({ pathname: '/expense/[id]', params: { id: item.id } })}
                  // Pressed is a tint, not a fade: lowering opacity under a
                  // card with Android elevation leaves a pale band.
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    pressed && { backgroundColor: theme.backgroundSelected },
                    pressed && i === 0 && styles.rowFirst,
                    pressed && i === day.items.length - 1 && styles.rowLast,
                  ]}>
                  {/* Grey, so green stays for money and actions. */}
                  <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText allowFontScaling={false} style={styles.tileGlyph}>
                      {iconFor(item.categoryIcon)}
                    </ThemedText>
                  </View>

                  <View style={styles.rowText}>
                    <ThemedText style={[Type.body, styles.medium]} numberOfLines={1}>
                      {item.description || item.categoryName}
                    </ThemedText>
                    <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
                      {item.paidByName} · {item.participantCount} way
                      {item.participantCount === 1 ? '' : 's'}
                    </ThemedText>
                  </View>

                  <ThemedText style={styles.amount}>{formatPaise(item.totalPaise)}</ThemedText>
                </Pressable>
              ))}
            </Card>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  // Bottom padding so rows scrolling up stop short of the search bar instead
  // of sliding right under its edge.
  top: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three, gap: Spacing.two },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one + 2,
    minHeight: 50,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.two },
  searchDivider: { width: StyleSheet.hairlineWidth, height: 24 },
  filterButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.one,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  monthTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.3 },
  day: { gap: Spacing.one + 2, marginTop: Spacing.two + Spacing.one },
  filterLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.half },
  clear: { fontWeight: '700' },
  content: { paddingHorizontal: Spacing.four, paddingBottom: TabBarClearance },
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
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 14 },
  centered: { textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  // A pressed tint follows the card's corners on its first and last rows.
  rowFirst: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  rowLast: { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
  medium: { fontWeight: '600' },
  amount: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileGlyph: { fontSize: 16 },
  rowText: { flex: 1, gap: 1 },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
