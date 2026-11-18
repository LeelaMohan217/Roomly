import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MonthCalendarPopover, monthLabel, prevMonth, type Month } from '@/components/month-popover';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { LoadFailed } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { appFontFor } from '@/constants/fonts';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel } from '@/lib/dates';
import { formatWholeRupees } from '@/lib/money';
import {
  isLedgerMissing,
  personalCategory,
  tintOf,
  usePersonalAll,
  usePersonalMonths,
  usePersonalPeriod,
  usePersonalSearch,
  type PersonalExpense,
} from '@/lib/personal';

/** "2026-11", the month as a route parameter. */
const monthParam = (m: Month) => `${m.year}-${String(m.month).padStart(2, '0')}`;

/**
 * My ledger: the private ledger's one screen.
 *
 * The card up top is a month's total against the month before, with a way
 * into Compare. History below lists every month until a month is picked from
 * the filter at the top right; its search looks through every month too.
 * Tapping an entry edits it; the button at the bottom adds one.
 */
export default function LedgerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = new Date();
  const thisYear = now.getFullYear();
  const current: Month = { year: thisYear, month: now.getMonth() + 1 };

  // The months picked from the filter, newest first; none means every month.
  const [pickedList, setPickedList] = useState<Month[]>([]);
  const togglePicked = (m: Month) =>
    setPickedList((list) =>
      (list.some((x) => x.year === m.year && x.month === m.month)
        ? list.filter((x) => !(x.year === m.year && x.month === m.month))
        : [...list, m]
      ).sort((a, b) => b.year - a.year || b.month - a.month)
    );
  // One month picked: that month, compared with the one before, as before.
  const picked = pickedList.length === 1 ? pickedList[0] : null;
  const several = pickedList.length > 1;
  const pickedNames =
    pickedList.length > 3
      ? `${pickedList.length} months`
      : [...pickedList].reverse().map((m) => monthLabel(m, false)).join(', ');
  // Where the month calendar drops down from, or null while it is closed.
  const [pickerTop, setPickerTop] = useState<number | null>(null);
  const filterRef = useRef<View>(null);
  const openPicker = () => {
    const button = filterRef.current;
    if (!button) return setPickerTop(96);
    button.measureInWindow((_x, y, _w, h) => setPickerTop(y + h + Spacing.two));
  };

  // The card's month: the one picked, or this month while showing them all.
  const cardMonth = picked ?? current;
  const before = prevMonth(cardMonth);
  const period = usePersonalPeriod(cardMonth);
  const all = usePersonalAll();
  const chosen = usePersonalMonths(several ? pickedList : []);
  const summary = period.data;

  // Search looks through every month: someone hunting for a payment rarely
  // remembers when it was. Asked a beat after the last keystroke.
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAsked(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  const searching = query.trim().length > 0;
  const search = usePersonalSearch(asked);
  const results = searching ? search.data : undefined;

  const history = several ? chosen : picked ? period : all;
  const historyRows = several ? chosen.data?.expenses : picked ? summary?.expenses : all.data;

  // Compare from the card: the two picked months when two are, else the
  // card's month against the one before.
  const comparePair: [Month, Month] = several
    ? [pickedList[1], pickedList[0]]
    : [before, cardMonth];
  const listed = searching ? (results?.expenses ?? []) : (historyRows ?? []);
  const groups = groupByDay(listed, thisYear);

  const failed = history.isError && !historyRows ? history.error : null;
  const openEntry = (editing: PersonalExpense | null) =>
    editing
      ? router.push({ pathname: '/ledger-entry', params: { id: editing.id } })
      : router.push('/ledger-entry');

  const change =
    summary && summary.prevTotalPaise > 0
      ? Math.round(((summary.totalPaise - summary.prevTotalPaise) / summary.prevTotalPaise) * 100)
      : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="My ledger"
        action={
          // The statement page, as History's: starts on the month picked here.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download statement"
            onPress={() =>
              router.push({
                pathname: '/ledger-statement',
                params: pickedList.length
                  ? { months: pickedList.map((m) => `${m.year}-${m.month}`).join(',') }
                  : {},
              })
            }
            hitSlop={8}
            style={({ pressed }) => [
              styles.filter,
              { backgroundColor: theme.lift, borderColor: theme.liftEdge, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Icon name="download-outline" size={19} color={theme.text} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* The total, on the bright green of the app's buttons. While
            searching, the total of what the search found instead. */}
        <LinearGradient
          colors={['#1DB584', '#0E9A6C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}>
          <View style={styles.heroGlow} pointerEvents="none" />
          <ThemedText style={[Type.caption, styles.onCardMuted]} numberOfLines={1}>
            {searching
              ? `Spent on “${query.trim()}” · all months`
              : several
                ? `Spent in ${pickedNames}`
                : `Spent in ${monthLabel(cardMonth)}`}
          </ThemedText>
          {searching && results ? (
            <Money paise={results.totalPaise} size="hero" color="#FFFFFF" />
          ) : !searching && several && chosen.data ? (
            <Money paise={chosen.data.totalPaise} size="hero" color="#FFFFFF" />
          ) : !searching && !several && summary ? (
            <Money paise={summary.totalPaise} size="hero" color="#FFFFFF" />
          ) : (
            <View style={styles.heroSkeleton}>
              <Skeleton width="55%" height={42} radius={Radius.sm} tint={theme.frost} />
            </View>
          )}

          {!searching ? (
            <View style={styles.heroFoot}>
              {several ? (
                <View style={styles.flex}>
                  <ThemedText style={[Type.caption, styles.onCardMuted]} numberOfLines={1}>
                    About{' '}
                    <ThemedText style={[Type.caption, styles.onCard]}>
                      {chosen.data
                        ? formatWholeRupees(Math.round(chosen.data.totalPaise / pickedList.length))
                        : '…'}
                    </ThemedText>{' '}
                    a month
                  </ThemedText>
                </View>
              ) : (
              <View style={styles.flex}>
                <ThemedText style={[Type.caption, styles.onCardMuted]} numberOfLines={1}>
                  {monthLabel(before)}{' '}
                  <ThemedText style={[Type.caption, styles.onCard]}>
                    {summary ? formatWholeRupees(summary.prevTotalPaise) : '…'}
                  </ThemedText>
                </ThemedText>
                {change !== null && change !== 0 ? (
                  <View style={styles.changeRow}>
                    <Icon
                      name={change > 0 ? 'trending-up' : 'trending-down'}
                      size={14}
                      color="#FFFFFF"
                    />
                    <ThemedText style={[Type.micro, styles.onCard]}>
                      {Math.abs(change)}% {change > 0 ? 'more' : 'less'}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Compare ${monthLabel(comparePair[1])} with ${monthLabel(comparePair[0])}`}
                onPress={() =>
                  router.push({
                    pathname: '/ledger-compare',
                    params: { first: monthParam(comparePair[0]), second: monthParam(comparePair[1]) },
                  })
                }
                style={({ pressed }) => [styles.compare, { opacity: pressed ? 0.7 : 1 }]}>
                <Icon name="bar-chart-outline" size={15} color="#FFFFFF" />
                <ThemedText style={[Type.caption, styles.onCard, styles.semi]}>Compare</ThemedText>
              </Pressable>
            </View>
          ) : null}
        </LinearGradient>

        {failed ? (
          isLedgerMissing(failed) ? (
            <Card style={styles.notice}>
              <ThemedText style={Type.headline}>Not switched on yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={Type.caption}>
                The private ledger needs a database update before it can save anything. It will work
                as soon as that is done.
              </ThemedText>
            </Card>
          ) : (
            <LoadFailed what="your ledger" error={failed} onRetry={() => void history.refetch()} />
          )
        ) : null}

        {/* History and its search, together: the search narrows this list. */}
        <View style={styles.historyHead}>
          <ThemedText style={styles.sectionTitle}>
            {searching ? 'Results' : 'History'}
          </ThemedText>
          {pickedList.length > 0 && !searching ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Showing ${picked ? monthLabel(picked) : pickedNames}. Show all months`}
              onPress={() => setPickedList([])}
              hitSlop={8}
              style={({ pressed }) => [
                styles.monthChip,
                { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 },
              ]}>
              <ThemedText
                style={[Type.caption, styles.semi, styles.chipText, { color: theme.brandInk }]}
                numberOfLines={1}>
                {picked ? monthLabel(picked) : pickedNames}
              </ThemedText>
              <Icon name="close" size={13} color={theme.brandInk} />
            </Pressable>
          ) : null}
        </View>
        <View style={[styles.search, { backgroundColor: theme.lift, borderColor: theme.liftEdge }]}>
          <Icon name="search-outline" size={18} color={theme.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search all your payments"
            placeholderTextColor={theme.textTertiary}
            selectionColor={theme.primary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, Type.body, appFontFor(Type.body), { color: theme.text }]}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={10}>
              <Icon name="close-circle" size={17} color={theme.textTertiary} />
            </Pressable>
          ) : null}
          {/* Search and the month filter share one bar, as on History: two
              ways of narrowing the same list. */}
          <View style={[styles.searchDivider, { backgroundColor: theme.liftEdge }]} />
          <Pressable
            ref={filterRef}
            accessibilityRole="button"
            accessibilityLabel={
              pickedList.length
                ? `Filter by month. Showing ${picked ? monthLabel(picked) : pickedNames}`
                : 'Filter by month'
            }
            onPress={openPicker}
            hitSlop={6}
            style={({ pressed }) => [
              styles.filterButton,
              {
                backgroundColor: pickedList.length ? theme.primarySoft : 'transparent',
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <Icon
              name="options-outline"
              size={18}
              color={pickedList.length ? theme.brandInk : theme.text}
            />
            {pickedList.length ? (
              <View style={[styles.filterDot, { backgroundColor: theme.primary }]} />
            ) : null}
          </Pressable>
        </View>

        {searching && search.isError ? (
          <LoadFailed what="your search" error={search.error} onRetry={() => void search.refetch()} />
        ) : null}

        {searching && results && results.expenses.length === 0 ? (
          <ThemedText themeColor="textSecondary" style={[Type.caption, styles.center]}>
            No payments match “{query.trim()}”.
          </ThemedText>
        ) : null}

        {!searching && historyRows && historyRows.length === 0 && !failed ? (
          <Card style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
              <Icon name="wallet-outline" size={24} color={theme.brandInk} />
            </View>
            <ThemedText style={[Type.headline, styles.center]}>
              {pickedList.length
                ? `Nothing logged in ${picked ? monthLabel(picked) : pickedNames}`
                : 'Start your private ledger'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.center]}>
              Log what you spend on yourself. It never touches the house’s balances.
            </ThemedText>
          </Card>
        ) : null}

        {groups.map((g) => (
          <View key={g.key} style={styles.group}>
            <View style={styles.groupHead}>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.semi]}>
                {g.title}
              </ThemedText>
              <ThemedText themeColor="textTertiary" style={Type.caption}>
                {formatWholeRupees(g.totalPaise)}
              </ThemedText>
            </View>
            <Card padded={false}>
              {g.items.map((e, i) => {
                const cat = personalCategory(e.category);
                return (
                  <Pressable
                    key={e.id}
                    accessibilityRole="button"
                    accessibilityHint="Edit or delete"
                    onPress={() => openEntry(e)}
                    style={({ pressed }) => [
                      styles.row,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.border,
                      },
                      { opacity: pressed ? 0.6 : 1 },
                    ]}>
                    <View style={[styles.rowIcon, { backgroundColor: tintOf(cat.color) }]}>
                      <Icon name={cat.icon} size={19} color={cat.color} />
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={[Type.body, styles.semi]} numberOfLines={1}>
                        {e.description}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
                        {cat.label}
                      </ThemedText>
                    </View>
                    <Money paise={e.amountPaise} size="row" />
                  </Pressable>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.background }]}>
        <Button title="Add private expense" onPress={() => openEntry(null)} />
      </View>

      {pickerTop !== null ? (
        <MonthCalendarPopover
          anchorTop={pickerTop}
          multi={{ selected: pickedList, onToggle: togglePicked }}
          onClear={() => {
            setPickedList([]);
            setPickerTop(null);
          }}
          onClose={() => setPickerTop(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** Entries by day, newest day first. Days from another year say the year. */
function groupByDay(expenses: PersonalExpense[], thisYear: number) {
  const groups: {
    key: string;
    title: string;
    totalPaise: number;
    items: PersonalExpense[];
  }[] = [];
  for (const e of expenses) {
    let g = groups[groups.length - 1];
    if (!g || g.key !== e.spentOn) {
      g = {
        key: e.spentOn,
        title:
          Number(e.spentOn.slice(0, 4)) === thisYear
            ? dayLabel(e.spentOn)
            : `${dayLabel(e.spentOn)} ${e.spentOn.slice(0, 4)}`,
        totalPaise: 0,
        items: [],
      };
      groups.push(g);
    }
    g.items.push(e);
    g.totalPaise += e.amountPaise;
  }
  return groups;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  center: { textAlign: 'center' },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six + Spacing.four,
    gap: Spacing.three,
  },

  filter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  searchDivider: { width: StyleSheet.hairlineWidth, height: 24 },

  hero: {
    borderRadius: Radius.xl,
    padding: Spacing.four - 4,
    gap: Spacing.one,
    overflow: 'hidden',
  },
  // A soft light circle in the corner, for depth without a shadow.
  heroGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -70,
    top: -90,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroSkeleton: { paddingVertical: Spacing.one },
  onCard: { color: '#FFFFFF' },
  onCardMuted: { color: 'rgba(255,255,255,0.8)' },
  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.two,
    paddingTop: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.3)',
  },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  compare: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },

  notice: { gap: Spacing.one },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: -Spacing.one,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  chipText: { maxWidth: 200 },
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one + 2,
    minHeight: 48,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.two },

  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },

  group: { gap: Spacing.two },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
});
