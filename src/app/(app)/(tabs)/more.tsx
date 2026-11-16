import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Appear } from '@/components/ui/motion';
import { Radius, Spacing, TabBarClearance, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

type Row = {
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

/**
 * Everything not on a tab.
 *
 * A calm page with no green wash -- that is kept for Home and Reports. You
 * at the top in a white card: your photo, name and role, and the way into
 * your account. Under it, the household's screens and the tools, each
 * a heading over a list card. The names are the ones the screens they open
 * use, so a tile or row says enough.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';
  const household: Row[] = [
    // Owners get one door into everything they administer, rather than the
    // same four links scattered across three screens.
    isOwner
      ? { href: '/owner', icon: 'construct-outline', label: 'Owner tools' }
      : { href: '/household', icon: 'people-outline', label: 'Household' },
    { href: '/settle', icon: 'swap-horizontal-outline', label: 'Settle up' },
    { href: '/away', icon: 'airplane-outline', label: 'Away calendar' },
    // "Bills", matching the Home button that opens the same screen.
    { href: '/recurring', icon: 'calendar-outline', label: 'Bills' },
  ];

  const tools: Row[] = [
    { href: '/edit-history', icon: 'document-text-outline', label: 'Edit history' },
  ];

  const name = member?.display_name ?? '';
  const card = { backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow };

  return (
    // A calm, neutral page: the green wash is kept for Home and Reports,
    // where there is money to look at. A utility screen reads better plain.
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <ThemedText style={styles.screenTitle}>More</ThemedText>

          {/* You: the whole block opens your account. */}
          <Appear>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name || 'Your account'}, ${isOwner ? 'owner' : 'member'}. Open account`}
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [
                styles.profile,
                card,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <Avatar
                name={name || '?'}
                seed={member?.id}
                size={56}
                ring
                ringColor={theme.border}
              />
              <View style={styles.flex}>
                <ThemedText style={styles.profileName} numberOfLines={1}>
                  {name}
                </ThemedText>
                <View style={styles.profileMeta}>
                  <View style={[styles.rolePill, { backgroundColor: theme.primarySoft }]}>
                    <Ionicons
                      name={isOwner ? 'shield-checkmark-outline' : 'person-outline'}
                      size={11}
                      color={theme.brandInk}
                    />
                    <ThemedText style={[Type.micro, styles.semi, { color: theme.brandInk }]}>
                      {isOwner ? 'Owner' : 'Member'}
                    </ThemedText>
                  </View>
                  <ThemedText themeColor="textSecondary" style={Type.micro}>
                    View account
                  </ThemedText>
                </View>
              </View>
              <View style={[styles.chevron, { backgroundColor: theme.liftTile }]}>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </View>
            </Pressable>
          </Appear>
        </View>

        {/* The household's screens, then the tools: a big heading for each,
            and every screen as a card of its own under it. */}
        {[
          { title: 'Household', rows: household },
          { title: 'Tools', rows: tools },
        ].map((g, gi) => (
          <Appear key={g.title} index={gi + 1} style={styles.group}>
            <ThemedText style={styles.groupTitle}>{g.title}</ThemedText>
            <View style={styles.cards}>
              {g.rows.map((r) => (
                <View key={r.label} style={[styles.listCard, card]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(r.href)}
                  // A tint, not a fade: the card clips it to its corners.
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <View style={[styles.rowIcon, { backgroundColor: theme.liftTile }]}>
                    <Ionicons name={r.icon} size={19} color={theme.brandInk} />
                  </View>
                  <ThemedText style={[Type.body, styles.semi, styles.flex]} numberOfLines={1}>
                    {r.label}
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
                </Pressable>
                </View>
              ))}
            </View>
          </Appear>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  // 18 at the sides, as on the other tabs; the lifted card reaches 4 further.
  content: { paddingHorizontal: 18, paddingBottom: TabBarClearance, gap: Spacing.four },
  top: { gap: Spacing.three, paddingTop: Spacing.two },
  screenTitle: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -0.9 },

  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  profileName: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.4 },
  profileMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 4 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  chevron: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  group: { gap: Spacing.two + 2 },
  cards: { gap: Spacing.two },
  groupTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4, paddingLeft: Spacing.half },
  listCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 2,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
