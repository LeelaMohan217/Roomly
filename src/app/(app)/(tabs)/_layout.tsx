import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';
import type { BottomTabBarButtonProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhoneNudge } from '@/components/phone-nudge';
import { UpdatePrompt } from '@/components/update-prompt';
import { SyncBanner } from '@/components/ui/sync-banner';
import { appFontFor } from '@/constants/fonts';
import { Spacing, TabBar } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { usePushRegistration } from '@/lib/push';
import { useHouseholdRealtime } from '@/lib/realtime';

const BODY_HEIGHT = TabBar.body;
const BAR_MARGIN = TabBar.margin;
/** The Add disc is as tall as the pill beside it. */
const ADD_SIZE = BODY_HEIGHT;
/** Room the pill leaves on its right for the Add disc and the gap before it. */
const ADD_ROOM = ADD_SIZE + TabBar.gap;

/**
 * The bar’s surface: a floating pill for the four tabs, with the Add disc
 * beside it on the right (drawn separately, in the layout, so it can take
 * its own taps).
 *
 * Below the bar’s middle, the full width down to the bottom of the screen is
 * painted in the page colour. Screens scroll behind the bar, and without this
 * their rows showed through the gap under it and beside its lower half.
 */
function TabBarBackground({ footer }: { footer: number }) {
  const theme = useTheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.mask,
          { top: BODY_HEIGHT / 2, height: BODY_HEIGHT / 2 + footer, backgroundColor: theme.background },
        ]}
      />
      <View
        style={[
          styles.pill,
          {
            right: BAR_MARGIN + ADD_ROOM,
            backgroundColor: theme.tabBar,
            borderColor: theme.tabBarEdge,
            shadowColor: theme.liftShadow,
          },
        ]}
      />
    </View>
  );
}

/**
 * One tab: icon over label, both in green when it's the current one.
 *
 * Our own button rather than the navigator's: its default is a pressable with
 * a borderless Android ripple, which drew a large grey circle spilling past
 * the bar whenever a tab was tapped.
 */
function TabButton({ children, onPress, onLongPress, style, ...rest }: BottomTabBarButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      role={rest.role}
      aria-label={rest['aria-label']}
      aria-selected={rest['aria-selected']}
      testID={rest.testID}
      style={({ pressed }) => [style, styles.tab, { opacity: pressed ? 0.6 : 1 }]}>
      {/* The current tab sits in a soft pill of its own, inside the bar. */}
      <View
        style={[
          styles.tabInner,
          rest['aria-selected'] ? { backgroundColor: theme.tabActive } : null,
        ]}>
        {children}
      </View>
    </Pressable>
  );
}

/**
 * A floating tab bar: a pill detached from the screen's edges holding four
 * tabs, and a round Add button of its own beside it on the right.
 *
 * Add Expense is not a tab: it's a task you start and finish, not a place you
 * navigate to, so it opens as a modal. Its slot is a tab in name only (the
 * "add" route) and draws no button in the bar; the disc beside the pill
 * pushes the modal.
 *
 * The tab bar's box spans the full width down to the bottom of the screen,
 * with the floating bar drawn inside it, so its background can also mask
 * the strip below the bar. Screens run underneath it to the bottom of the
 * display; each pads its scroll content by TabBarClearance, so the last row
 * stops just above the bar.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Mounted once for the whole tab shell rather than per screen.
  useHouseholdRealtime();
  usePushRegistration();

  // Everything under the bar's body: the gap and the system inset.
  const footer = BAR_MARGIN + insets.bottom;

  return (
    <View style={styles.wrap}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.tabActiveInk,
          tabBarInactiveTintColor: theme.textTertiary,
          tabBarStyle: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: BODY_HEIGHT + footer,
            paddingTop: 0,
            // Keeps the tabs inside the drawn bar, off the footer and sides.
            paddingBottom: footer,
            // The right side also clears the Add disc beside the pill.
            paddingLeft: BAR_MARGIN + Spacing.one,
            paddingRight: BAR_MARGIN + ADD_ROOM + Spacing.one,
            // The surface is TabBarBackground's drawing; the box itself is
            // invisible. Android's default bar carries elevation 8 and the
            // web one a top border, either of which would outline the box.
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarBackground: () => <TabBarBackground footer={footer} />,
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarLabel: ({ focused, color, children }) => (
            <Text
              style={[styles.label, { color }, appFontFor({ fontWeight: focused ? '600' : '500' })]}
              numberOfLines={1}>
              {children}
            </Text>
          ),
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={21} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'History',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={21} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: 'Add expense',
            // No button in the bar: Add is its own disc beside the pill,
            // drawn below in the layout, and opens the modal from there. The
            // route stays only because a tab needs a screen behind it.
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'Reports',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'bar-chart' : 'bar-chart-outline'}
                size={21}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'menu' : 'menu-outline'}
                size={21}
                color={color}
              />
            ),
          }}
        />
      </Tabs>

      {/* Add expense: its own round disc beside the pill, as tall as it.
          It opens the modal instead of switching tabs, so the tab you were on
          stays the current one. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add expense"
        onPress={() => {
          tapped();
          router.push('/add-expense');
        }}
        style={({ pressed }) => [
          styles.addButton,
          {
            bottom: footer,
            backgroundColor: theme.fab,
            shadowColor: theme.liftShadow,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
        ]}>
        <Ionicons name="add" size={26} color={theme.onFab} />
      </Pressable>

      {/* Mounted once for the whole tab shell, floating above the bar so it
          disturbs no layout and returns null when there is nothing to say.
          It used to live inline on Home and NOWHERE else, so an expense queued
          offline from any other tab had no indicator at all -- the one thing
          the queue must never be is silent. */}
      <View
        style={[
          styles.bannerWrap,
          { bottom: footer + BODY_HEIGHT + 12 },
        ]}>
        <SyncBanner />
      </View>

      {/* Mounted once for the tab shell, like the banner: it asks accounts
          made before phone sign-in to add a number, wherever they land. */}
      <PhoneNudge />

      {/* "Update ready -- Restart now" once a new version has downloaded,
          shown only on the tabs so it never lands on a half-typed form. */}
      <UpdatePrompt />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  bannerWrap: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
  },
  // Fills the strip under the pill’s lower half, edge to edge.
  mask: { position: 'absolute', left: 0, right: 0 },
  pill: {
    position: 'absolute',
    top: 0,
    left: BAR_MARGIN,
    height: BODY_HEIGHT,
    borderRadius: BODY_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The highlight around the current tab’s icon and label.
  tabInner: {
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: 6,
    borderRadius: 22,
  },
  label: { fontSize: 11, lineHeight: 14, letterSpacing: 0.1 },
  addButton: {
    position: 'absolute',
    right: BAR_MARGIN,
    width: ADD_SIZE,
    height: ADD_SIZE,
    borderRadius: ADD_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
});
