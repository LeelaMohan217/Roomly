import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useExpenses, type Expense } from '@/lib/queries';

function humanDate(iso: string): string {
  const today = new Date();
  const d = new Date(`${iso}T00:00:00`);
  const days = Math.round((today.setHours(0, 0, 0, 0) - d.getTime()) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-IN', { weekday: 'long' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const expenses = useExpenses(200);

  const sections = Object.entries(
    (expenses.data ?? []).reduce<Record<string, Expense[]>>((acc, e) => {
      (acc[e.expenseDate] ??= []).push(e);
      return acc;
    }, {})
  ).map(([date, data]) => ({
    title: humanDate(date),
    total: data.reduce((sum, e) => sum + e.totalPaise, 0),
    data,
  }));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Search moved off Home and onto History, where you'd actually reach
          for it — but it stays out of the way until you do. */}
      <AppBar
        title="History"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search expenses"
            onPress={() => router.push('/search')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
          </Pressable>
        }
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshing={expenses.isFetching}
        onRefresh={() => void expenses.refetch()}
        ListEmptyComponent={
          // "Nothing logged yet" is a claim about the data, so it may only be
          // made once the data has been read. This used to be shown after a
          // failed fetch too, telling a user with an expired session that
          // their household had no expenses.
          queryState(expenses, 'your expenses') ?? (
            <Card style={styles.empty}>
              <Ionicons name="receipt-outline" size={22} color={theme.textTertiary} />
              <ThemedText style={Type.headline}>Nothing logged yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                Expenses you add will appear here, grouped by day.
              </ThemedText>
            </Card>
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              {section.title.toUpperCase()}
            </ThemedText>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              {formatPaise(section.total)}
            </ThemedText>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;

          return (
            <Pressable
              onPress={() => router.push({ pathname: '/expense/[id]', params: { id: item.id } })}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  opacity: pressed ? 0.6 : 1,
                },
                // Rounded at the ends only, so a day's expenses read as one
                // grouped card rather than a stack of separate ones.
                first && styles.first,
                last && styles.last,
                !last && { borderBottomWidth: 0 },
              ]}>
              <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText allowFontScaling={false} style={styles.tileGlyph}>{iconFor(item.categoryIcon)}</ThemedText>
              </View>

              <View style={styles.rowText}>
                <ThemedText style={Type.body} numberOfLines={1}>
                  {item.description || item.categoryName}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {item.paidByName} · {item.participantCount} way
                  {item.participantCount === 1 ? '' : 's'}
                </ThemedText>
              </View>

              <ThemedText style={Type.amount}>{formatPaise(item.totalPaise)}</ThemedText>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: 130 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { textAlign: 'center' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  first: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  last: { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
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
