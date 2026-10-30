import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Reveal } from '@/components/ui/motion';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { iconFor } from '@/lib/icons';
import { useAllCategories, type ManagedCategory } from '@/lib/queries';
import { useSession } from '@/lib/session';

const GROUPS: { kind: ManagedCategory['kind']; title: string; blurb: string }[] = [
  {
    kind: 'fixed',
    title: 'Fixed costs',
    blurb: 'Split between everyone, away or not — your room doesn’t disappear.',
  },
  {
    kind: 'bulk',
    title: 'Bulk buys',
    blurb: 'Charged in full when bought, because they outlast any one trip.',
  },
  {
    kind: 'consumption',
    title: 'Day to day',
    blurb: 'Split only between people who were actually here.',
  },
];

export default function CategoriesScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const router = useRouter();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const categories = useAllCategories();
  const all = categories.data ?? [];
  const live = all.filter((c) => !c.isArchived);
  const archived = all.filter((c) => c.isArchived);
  // Folded by default: archived categories are history, not choices.
  const [showArchived, setShowArchived] = useState(false);

  // How a group splits, a tap away rather than a line under every heading.
  const explain = (title: string, message: string) =>
    void dialog.alert({ tone: 'info', icon: 'information-circle-outline', title, message });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Categories"
        action={
          /* Adding a category is additive — it changes nothing that already
             exists — so anyone may do it (migration 0031). Changing one that
             is already in use stays with the owner, because kind and
             respects_away_calendar decide how expenses split. */
          (
            <Pressable
              onPress={() => router.push('/category-edit')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Ionicons name="add" size={20} color={theme.primary} />
            </Pressable>
          )
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Members may add; changing one in use is the owner's, because the
            kind decides how its expenses split. */}
        {!isOwner ? (
          <View style={styles.aside}>
            <Ionicons name="lock-closed-outline" size={14} color={theme.textTertiary} />
            <ThemedText themeColor="textTertiary" style={[Type.caption, styles.flex]}>
              Only the owner can change one in use
            </ThemedText>
          </View>
        ) : null}

        {/* A blank page used to stand in for the list while it loaded, and
            for good if it could not. */}
        {queryState(categories, 'the categories')}

        {GROUPS.map((g) => {
          const rows = live.filter((c) => c.kind === g.kind);
          if (rows.length === 0) return null;

          return (
            <View key={g.kind} style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${g.title}, how it splits`}
                onPress={() => explain(g.title, g.blurb)}
                hitSlop={6}
                style={styles.headingRow}>
                <ThemedText style={styles.sectionTitle}>{g.title}</ThemedText>
                <Ionicons name="information-circle-outline" size={16} color={theme.textTertiary} />
              </Pressable>

              <Card padded={false}>
                {rows.map((c, i) => (
                  <Row
                    key={c.id}
                    category={c}
                    first={i === 0}
                    onPress={
                      isOwner
                        ? () => router.push({ pathname: '/category-edit', params: { id: c.id } })
                        : undefined
                    }
                  />
                ))}
              </Card>
            </View>
          );
        })}

        {/* One row that opens, rather than a whole section with its own
            heading and paragraph. */}
        {archived.length > 0 ? (
          <Card padded={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showArchived }}
              accessibilityHint="Hidden when adding an expense; old expenses still show them"
              onPress={() => setShowArchived((v) => !v)}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
              <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="archive-outline" size={17} color={theme.text} />
              </View>
              <ThemedText style={[Type.body, styles.flex]}>Archived</ThemedText>
              <ThemedText themeColor="textSecondary" style={Type.body}>
                {archived.length}
              </ThemedText>
              <Ionicons
                name={showArchived ? 'chevron-up' : 'chevron-down'}
                size={15}
                color={theme.textTertiary}
              />
            </Pressable>
            {/* Fades open as a block rather than row by row. */}
            {showArchived ? (
              <Reveal>
                {archived.map((c) => (
                  <Row
                    key={c.id}
                    category={c}
                    first={false}
                    dim
                    onPress={
                      isOwner
                        ? () => router.push({ pathname: '/category-edit', params: { id: c.id } })
                        : undefined
                    }
                  />
                ))}
              </Reveal>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  category,
  first,
  dim = false,
  onPress,
}: {
  category: ManagedCategory;
  first: boolean;
  dim?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  // The count includes deleted expenses, because a voided row still holds the
  // foreign key and still blocks deletion. So only "never used" is worth a
  // mark -- it is the one that can still be deleted.
  const unused = category.expenseCount === 0;

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityLabel={
        `${category.name}${unused ? ', unused, can be deleted' : ''}` +
        `${category.respectsAwayCalendar ? ', skips people who are away' : ''}`
      }
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        { opacity: (pressed && onPress ? 0.6 : 1) * (dim ? 0.5 : 1) },
      ]}>
      <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(category.icon)}</ThemedText>
      </View>

      <View style={[styles.flex, styles.nameRow]}>
        <ThemedText style={[Type.body, styles.shrink]} numberOfLines={1}>
          {category.name}
        </ThemedText>
        {unused ? (
          <View style={[styles.pill, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText themeColor="textSecondary" style={styles.pillText}>
              Unused
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* Blue: information. Splits skip whoever is away. */}
      {category.respectsAwayCalendar ? (
        <Ionicons name="airplane-outline" size={16} color={theme.info} />
      ) : null}

      {onPress ? <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },

  shrink: { flexShrink: 1 },

  // Round, like the other header icons.
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: { gap: Spacing.two },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, alignSelf: 'flex-start' },
  // Sentence case at heading size, as on Settle up and History.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  aside: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 17 },
  pill: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  pillText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
});
