import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppBar } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, TabBarClearance, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

type Row = {
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

/**
 * Everything not on a tab, grouped like a settings list: a heading per group,
 * an icon and a name per row, no line of explanation under each. The names
 * are the ones the screens they open use, so the row says enough.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: 'Household',
      rows: [
        // Owners get one door into everything they administer, rather than
        // the same four links scattered across three screens.
        isOwner
          ? { href: '/owner', icon: 'construct-outline', label: 'Owner tools' }
          : { href: '/household', icon: 'people-outline', label: 'Household' },
        { href: '/settle', icon: 'swap-horizontal-outline', label: 'Settle up' },
        { href: '/away', icon: 'airplane-outline', label: 'Away calendar' },
        // "Bills", matching the Home button that opens the same screen.
        { href: '/recurring', icon: 'calendar-outline', label: 'Bills' },
      ],
    },
    {
      title: 'Tools',
      rows: [
        // Out of the tab bar to make room for Add in the middle, but still
        // one tap from here -- "Use in an expense" carries its total into Add.
        { href: '/calculator', icon: 'calculator-outline', label: 'Calculator' },
        { href: '/edit-history', icon: 'document-text-outline', label: 'Edit history' },
      ],
    },
    {
      title: 'You',
      rows: [{ href: '/settings', icon: 'person-circle-outline', label: 'Account' }],
    },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <AppBar title="More" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {groups.map((g) => (
          <View key={g.title} style={styles.group}>
            <ThemedText style={styles.groupTitle}>{g.title}</ThemedText>
            <Card padded={false}>
              {g.rows.map((r, i) => (
                <Pressable
                  key={r.label}
                  accessibilityRole="button"
                  onPress={() => router.push(r.href)}
                  // A tint, not a fade, following the card's corners on the
                  // first and last rows.
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    pressed && { backgroundColor: theme.backgroundSelected },
                    pressed && i === 0 && styles.rowFirst,
                    pressed && i === g.rows.length - 1 && styles.rowLast,
                  ]}>
                  <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                    <Ionicons name={r.icon} size={17} color={theme.text} />
                  </View>
                  <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
                    {r.label}
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
                </Pressable>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: TabBarClearance, gap: Spacing.four },
  group: { gap: Spacing.two },
  groupTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    letterSpacing: -0.3,
    paddingLeft: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  rowFirst: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  rowLast: { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
  // The same soft square as Account's rows.
  tile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
