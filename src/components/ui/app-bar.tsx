import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Logo } from '@/components/brand/logo';
import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNotifications } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';

/**
 * Top bar for the tab screens: brand on the left, you on the right.
 *
 * The avatar is the account affordance people already reach for — it's where
 * every app puts profile and settings, so it needs no label.
 */
export function AppBar({
  badge = 0,
  title,
  overline,
  action,
}: {
  badge?: number;
  title?: string;
  /** Quiet line above the title — the date on Home. */
  overline?: string;
  /** Replaces the avatar, for screens with their own control. `null` shows
   *  nothing at all -- for a screen whose controls live below the title. */
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();

  return (
    <View style={styles.bar}>
      {title ? (
        <View style={styles.titleBlock}>
          {overline ? (
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              {overline}
            </ThemedText>
          ) : null}
          <ThemedText style={styles.screenTitle} numberOfLines={1}>
            {title}
          </ThemedText>
        </View>
      ) : (
        <Logo size={28} />
      )}

      {action !== undefined ? action : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More: your account and settings"
          // More holds your account and every setting; there is no separate
          // Account screen any more.
          onPress={() => router.navigate('/more')}
          hitSlop={8}
          style={({ pressed }) => [styles.avatarWrap, { opacity: pressed ? 0.7 : 1 }]}>
          <Avatar
            name={member?.display_name ?? '?'}
            seed={member?.id}
            size={34}
            ring
            ringColor={theme.border}
          />
          {badge > 0 ? (
            <View
              style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.background }]}>
              <ThemedText style={styles.badgeText} allowFontScaling={false}>
                {badge > 9 ? '9+' : badge}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      )}
    </View>
  );
}

/**
 * Home's header: the greeting on the left; activity and you on the right.
 *
 * The greeting is plain text, not a button -- the profile lives in the avatar
 * at the far right, where every app puts it. The name is the bold part, the
 * way you'd say it.
 */
export function HomeHeader({
  greeting,
  name,
  badge = 0,
  light = false,
}: {
  /** "Good evening" -- the comma and name are added here. */
  greeting: string;
  name: string;
  /** Things waiting for an owner's approval, shown on the avatar. */
  badge?: number;
  /** On a pale wash: dark text and white buttons instead of white on green. */
  light?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const notifications = useNotifications();
  const unread = (notifications.data ?? []).filter((n) => n.unread).length;
  const ink = light ? theme.text : theme.onWash;
  const inkMuted = light ? theme.textSecondary : theme.onWashMuted;
  const buttonBg = light ? 'rgba(255,255,255,0.78)' : theme.frost;
  const buttonEdge = light ? 'rgba(255,255,255,0.95)' : theme.frostEdge;
  const buttonIcon = light ? theme.text : theme.frostIcon;

  return (
    <View style={[styles.bar, styles.homeBar]}>
      {/* Two lines, two tones, on the green wash: the greeting light and
          faded, the name in semibold white -- the way you'd say it. */}
      <View style={styles.homeText} accessible accessibilityLabel={`${greeting}, ${name}`}>
        <ThemedText style={[styles.homeGreeting, { color: inkMuted }]} numberOfLines={1}>
          {greeting},
        </ThemedText>
        <ThemedText style={[styles.homeName, { color: ink }]} numberOfLines={1}>
          {name}
        </ThemedText>
      </View>

      <View style={styles.homeRight}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `Activity, ${unread} unread` : 'Activity'}
          onPress={() => router.push('/notifications')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconButton,
            {
              backgroundColor: buttonBg,
              borderColor: buttonEdge,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          {/* Frosted on the wash, an outline bell; an amber dot says there is
              something new. The count is in the button's label. */}
          <Icon name="notifications-outline" size={19} color={buttonIcon} />
          {unread > 0 ? (
            <View
              style={[styles.unreadDot, { backgroundColor: theme.alertDot }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            badge > 0
              ? `More: your account and settings, ${badge} waiting for you`
              : 'More: your account and settings'
          }
          // More: your account card at the top, Owner tools (what the badge
          // counts) and every setting. There is no separate Account screen.
          onPress={() => router.navigate('/more')}
          hitSlop={8}
          style={({ pressed }) => [styles.avatarWrap, { opacity: pressed ? 0.7 : 1 }]}>
          {/* A person glyph, not initials: this button means "you", not one
              housemate among several. */}
          <Avatar name={member?.display_name ?? '?'} seed={member?.id} size={40} icon />
          {badge > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: theme.danger, borderColor: light ? '#FFFFFF' : theme.washTop },
              ]}>
              <ThemedText style={styles.badgeText} allowFontScaling={false}>
                {badge > 9 ? '9+' : badge}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

/** Header for pushed screens — a back affordance and a title, nothing else. */
export function ScreenHeader({
  title,
  subtitle,
  action,
  showBack = true,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /**
   * Off at a tab root, where the stack has nothing to pop and the chevron is
   * a control that visibly does nothing.
   */
  showBack?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <View style={styles.bar}>
      <View style={styles.headerLeft}>
        {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: theme.lift,
              borderColor: theme.liftEdge,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <Icon name="chevron-back" size={20} color={theme.text} />
        </Pressable>
        ) : null}

        <View style={styles.headerText}>
          <ThemedText type="default" style={styles.headerTitle}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="small" themeColor="textSecondary">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      </View>

      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  avatarWrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '600', lineHeight: 14 },
  unreadDot: { position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flex: 1 },
  // A round soft-white button, like the ✕ on New expense.
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 1 },
  headerTitle: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.5 },
  titleBlock: { flex: 1, gap: 1 },
  homeText: { flex: 1, gap: 2 },
  // On Home the header scrolls with the wash, so the screen's own padding
  // sets the sides.
  homeBar: { paddingHorizontal: 0, alignItems: 'flex-start' },
  homeGreeting: { fontSize: 24, fontWeight: '300', letterSpacing: -0.6, lineHeight: 30 },
  homeName: { fontSize: 24, fontWeight: '600', letterSpacing: -0.6, lineHeight: 30 },
  homeRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  // A circle, matching the round avatar beside it in the header.
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // lineHeight set explicitly: ThemedText's default style carries 24, and a
  // 22px bold title in a 24px line box clipped its descenders -- the tail
  // of the "y" in "History" was cut off.
  screenTitle: { fontSize: 22, lineHeight: 30, fontWeight: '600', letterSpacing: -0.5 },
});
