import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { iconFor } from '@/lib/icons';
import { useAllCategories, type ManagedCategory } from '@/lib/queries';
import { useSession } from '@/lib/session';

const GROUPS: { kind: ManagedCategory['kind']; title: string; blurb: string }[] = [
  {
    kind: 'fixed',
    title: 'FIXED COSTS',
    blurb: 'Split between everyone, away or not — your room doesn’t disappear',
  },
  {
    kind: 'bulk',
    title: 'BULK BUYS',
    blurb: 'Charged in full when bought, because they outlast any one trip',
  },
  {
    kind: 'consumption',
    title: 'DAY TO DAY',
    blurb: 'Split only between people who were actually here',
  },
];

export default function CategoriesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const categories = useAllCategories();
  const all = categories.data ?? [];
  const live = all.filter((c) => !c.isArchived);
  const archived = all.filter((c) => c.isArchived);

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
        {!isOwner ? (
          <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
            <Ionicons name="lock-closed-outline" size={14} color={theme.textTertiary} />
            <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
              You can add a category. Changing one that already has expenses on it is the
              owner&apos;s call — the kind decides how those expenses split.
            </ThemedText>
          </View>
        ) : null}

        {GROUPS.map((g) => {
          const rows = live.filter((c) => c.kind === g.kind);
          if (rows.length === 0) return null;

          return (
            <View key={g.kind} style={styles.section}>
              <ThemedText themeColor="textTertiary" style={Type.label}>
                {g.title}
              </ThemedText>
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.blurb]}>
                {g.blurb}
              </ThemedText>

              <Card padded={false}>
                {rows.map((c, i) => (
                  <Row
                    key={c.id}
                    category={c}
                    last={i === rows.length - 1}
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

        {archived.length > 0 ? (
          <View style={styles.section}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              ARCHIVED ({archived.length})
            </ThemedText>
            <ThemedText themeColor="textTertiary" style={[Type.micro, styles.blurb]}>
              Hidden when adding an expense, but old expenses still show them
            </ThemedText>

            <Card padded={false}>
              {archived.map((c, i) => (
                <Row
                  key={c.id}
                  category={c}
                  last={i === archived.length - 1}
                  dim
                  onPress={
                    isOwner
                      ? () => router.push({ pathname: '/category-edit', params: { id: c.id } })
                      : undefined
                  }
                />
              ))}
            </Card>
          </View>
        ) : null}

        {isOwner ? (
          <Button
            title="Add a category"
            variant="secondary"
            onPress={() => router.push('/category-edit')}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  category,
  last,
  dim = false,
  onPress,
}: {
  category: ManagedCategory;
  last: boolean;
  dim?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        { opacity: (pressed && onPress ? 0.6 : 1) * (dim ? 0.5 : 1) },
      ]}>
      <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText allowFontScaling={false} style={styles.glyph}>{iconFor(category.icon)}</ThemedText>
      </View>

      <View style={styles.flex}>
        <ThemedText style={Type.body} numberOfLines={1}>
          {category.name}
        </ThemedText>
        {/* The count includes deleted expenses, because a voided row still
            holds the foreign key and still blocks deletion. So state the
            consequence rather than a number that would read as "live". */}
        <ThemedText themeColor="textTertiary" style={Type.micro}>
          {category.expenseCount === 0 ? 'never used — can be deleted' : 'in use — archive only'}
        </ThemedText>
      </View>

      {category.respectsAwayCalendar ? (
        <View style={[styles.pill, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name="airplane" size={9} color={theme.primary} />
          <ThemedText style={[Type.micro, { color: theme.primary }]}>away-aware</ThemedText>
        </View>
      ) : null}

      {onPress ? <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },

  addButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: { gap: Spacing.two },
  blurb: { marginTop: -2, marginBottom: Spacing.one },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 18 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
});
