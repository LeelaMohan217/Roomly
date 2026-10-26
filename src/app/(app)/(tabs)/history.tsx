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
import { formatRange } from '@/lib/dates';
import { activeFilterCount, useHistoryFilters } from '@/lib/history-filters';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useCategories, useExpenses, useMembers, type Expense } from '@/lib/queries';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "27 Oct" -- the month is already in the section header above it. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

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

  // Rows arrive newest first, so months come out in order as they're met.
  const sections = Object.entries(
    shown.reduce<Record<string, Expense[]>>((acc, e) => {
      (acc[e.expenseDate.slice(0, 7)] ??= []).push(e);
      return acc;
    }, {})
  ).map(([key, data]) => {
    const [y, m] = key.split('-').map(Number);
    return {
      key,
      title: `${MONTHS[m - 1]} ${y}`,
      total: data.reduce((sum, e) => sum + e.totalPaise, 0),
      data,
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
            placeholder="Search milk, Ravi, groceries…"
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
        keyExtractor={(item) => item.id}
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
          // A soft green band per month, its total on the right; tapping it
          // opens that month's statement. Sentence case, as on Home --
          // spaced capitals clipped the last letter on Android ("YESTERDA").
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${section.title}, ${formatPaise(section.total)}. Open statement`}
            onPress={() =>
              router.push({
                pathname: '/month-statement',
                params: { year: section.key.slice(0, 4), month: String(Number(section.key.slice(5, 7))) },
              })
            }
            style={({ pressed }) => [
              styles.monthBand,
              { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 },
            ]}>
            <ThemedText style={[Type.headline, styles.flex]}>{section.title}</ThemedText>
            <ThemedText style={[Type.headline, { color: theme.brandInk }]}>
              {formatPaise(section.total)}
            </ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.brandInk} />
          </Pressable>
        )}
        // One card per expense, a small gap apart, as on Home's Recent.
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/expense/[id]', params: { id: item.id } })}>
            {/* Pressed is a tint, not a fade: lowering opacity on a card with
                Android elevation fades the shadow and the contents separately,
                leaving a pale band across a grey card. */}
            {({ pressed }) => (
              <Card
                padded={false}
                style={[styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.tile, { backgroundColor: theme.primarySoft }]}>
                  <ThemedText allowFontScaling={false} style={styles.tileGlyph}>
                    {iconFor(item.categoryIcon)}
                  </ThemedText>
                </View>

                <View style={styles.rowText}>
                  <ThemedText style={Type.body} numberOfLines={1}>
                    {item.description || item.categoryName}
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
                    {item.paidByName} · {item.participantCount} way
                    {item.participantCount === 1 ? '' : 's'} · {shortDate(item.expenseDate)}
                  </ThemedText>
                </View>

                <ThemedText style={Type.amount}>{formatPaise(item.totalPaise)}</ThemedText>
              </Card>
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  top: { paddingHorizontal: Spacing.four, gap: Spacing.two },
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
  monthBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderRadius: Radius.md,
    marginTop: Spacing.four,
    marginBottom: Spacing.two + Spacing.one,
  },
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
  gap: { height: Spacing.two },
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
  rowText: { flex: 1, gap: 1 },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
