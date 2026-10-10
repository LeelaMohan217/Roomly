import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Logo } from '@/components/brand/logo';
import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNotifications } from '@/lib/queries';
import { useSession } from '@/lib/session';

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
  /** Replaces the avatar, for screens with their own control. */
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

      {action ?? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your account and settings"
          onPress={() => router.push('/settings')}
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
 * Home's header: you on the left, activity on the right.
 *
 * The avatar means "you" here rather than identifying one of four people, so
 * it carries a person glyph instead of initials, and the greeting sits at
 * body weight — a header is orientation, not the headline of the screen.
 */
export function HomeHeader({
  overline,
  title,
  badge = 0,
}: {
  overline: string;
  title: string;
  badge?: number;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const notifications = useNotifications();
  const unread = (notifications.data ?? []).filter((n) => n.unread).length;

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your account and settings"
        onPress={() => router.push('/settings')}
        hitSlop={8}
        style={({ pressed }) => [styles.homeLeft, { opacity: pressed ? 0.7 : 1 }]}>
        <View>
          <Avatar name={member?.display_name ?? '?'} seed={member?.id} size={38} icon />
          {badge > 0 ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: theme.danger, borderColor: theme.background },
              ]}>
              <ThemedText style={styles.badgeText} allowFontScaling={false}>
                {badge > 9 ? '9+' : badge}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <View style={styles.homeText}>
          <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
            {overline}
          </ThemedText>
          <ThemedText style={styles.homeTitle} numberOfLines={1}>
            {title}
          </ThemedText>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          unread > 0 ? `Activity, ${unread} unread` : 'Activity'
        }
        onPress={() => router.push('/notifications')}
        hitSlop={8}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: pressed ? 0.7 : 1,
          },
        ]}>
        <Ionicons
          name={unread > 0 ? 'notifications' : 'notifications-outline'}
          size={19}
          color={unread > 0 ? theme.primary : theme.textSecondary}
        />
        {unread > 0 ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.danger, borderColor: theme.background },
            ]}>
            <ThemedText style={styles.badgeText} allowFontScaling={false}>
              {unread > 9 ? '9+' : unread}
            </ThemedText>
          </View>
        ) : null}
      </Pressable>
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
   * a control that visibly does nothing. The Calculator tab used this header
   * while every other tab used AppBar, so it was the only tab in the app with
   * a dead back button.
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
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <Ionicons name="chevron-back" size={20} color={theme.text} />
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
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flex: 1 },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  titleBlock: { flex: 1, gap: 1 },
  homeLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flex: 1 },
  homeText: { flex: 1, gap: 1 },
  homeTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
});
