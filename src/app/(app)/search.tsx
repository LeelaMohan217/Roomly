import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import { useExpenses } from '@/lib/queries';

export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const expenses = useExpenses(500);

  const [query, setQuery] = useState('');

  const all = expenses.data ?? [];
  const trimmed = query.trim().toLowerCase();

  /**
   * Filtered on the client. A household produces a few thousand expenses a
   * year at most, they're already cached for offline use, and searching
   * locally means results appear as you type with no signal required.
   */
  // Not useMemo: `all` is `expenses.data ?? []`, so the fallback built a fresh
  // array on every render and the memo never hit. React Compiler memoizes this
  // correctly on its own.
  const results = !trimmed
    ? []
    : all.filter((e) =>
        [e.description ?? '', e.categoryName, e.paidByName]
          .join(' ')
          .toLowerCase()
          .includes(trimmed)
      );

  const total = results.reduce((sum, e) => sum + e.totalPaise, 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <Ionicons name="chevron-back" size={20} color={theme.text} />
        </Pressable>

        <View
          style={[
            styles.field,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <Ionicons name="search" size={17} color={theme.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Milk, Ravi, Groceries…"
            placeholderTextColor={theme.textTertiary}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, Type.body, { color: theme.text }]}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={17} color={theme.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          trimmed && results.length > 0 ? (
            <View style={styles.summary}>
              <ThemedText themeColor="textTertiary" style={Type.label}>
                {results.length} MATCH{results.length === 1 ? '' : 'ES'}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={Type.amount}>
                {formatPaise(total)}
              </ThemedText>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Card style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
              <Ionicons
                name={trimmed ? 'search' : 'sparkles-outline'}
                size={20}
                color={theme.textTertiary}
              />
            </View>
            <ThemedText style={Type.headline}>
              {trimmed ? 'Nothing found' : 'Search your expenses'}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
              {trimmed
                ? `No expense mentions "${query.trim()}".`
                : 'Search by what it was, the category, or who paid.'}
            </ThemedText>
          </Card>
        }
        renderItem={({ item, index }) => {
          const last = index === results.length - 1;
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
                index === 0 && styles.first,
                last && styles.last,
                !last && { borderBottomWidth: 0 },
              ]}>
              <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(item.categoryIcon)}</ThemedText>
              </View>

              <View style={styles.flex}>
                <ThemedText style={Type.body} numberOfLines={1}>
                  {item.description || item.categoryName}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {item.categoryName} · {item.paidByName} ·{' '}
                  {new Date(`${item.expenseDate}T00:00:00`).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
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
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  input: { flex: 1, minWidth: 0, padding: 0 },

  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
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
  glyph: { fontSize: 18 },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
});
