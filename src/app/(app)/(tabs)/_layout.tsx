import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';
import type { BottomTabBarButtonProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { PhoneNudge } from '@/components/phone-nudge';
import { SyncBanner } from '@/components/ui/sync-banner';
import { Spacing, TabBar } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { usePushRegistration } from '@/lib/push';
import { useHouseholdRealtime } from '@/lib/realtime';

const BODY_HEIGHT = TabBar.body;
// The hump's proportions are traced from the design reference: about twice
// the Add button's width, and a fifth of its height.
const HUMP_HEIGHT = TabBar.hump;
/** Half the hump's width, from its centre to where it meets the flat top. */
const HUMP_HALF_WIDTH = 42;
/** How far the drawn shadow steps down below the body. */
const SHADOW_DEPTH = 6;
const BAR_RADIUS = 24;
const BAR_MARGIN = TabBar.margin;
const ADD_SIZE = 40;

/**
 * The outline of the bar: a rounded rectangle whose top edge swells into a
 * low hump over the middle, around the Add button. `top` is where the flat
 * part of the top edge sits; the hump rises to y = 0.
 */
function barPath(width: number, top: number, bottom: number): string {
  const r = BAR_RADIUS;
  const cx = width / 2;
  const hw = HUMP_HALF_WIDTH;
  return [
    `M ${r} ${top}`,
    `L ${cx - hw} ${top}`,
    // Each half is a smoothstep: both handles sit at the half's midpoint,
    // one level with the flat top and one level with the crest. That eases
    // out of the edge and into a rounded crest with no flat run between --
    // the traced reference outline fits this curve to within a pixel. The
    // handles must never cross (an earlier 0.5 / 0.55 pair did), or the
    // sides steepen and the top flattens into a plateau.
    `C ${cx - hw / 2} ${top} ${cx - hw / 2} 0 ${cx} 0`,
    `C ${cx + hw / 2} 0 ${cx + hw / 2} ${top} ${cx + hw} ${top}`,
    `L ${width - r} ${top}`,
    `A ${r} ${r} 0 0 1 ${width} ${top + r}`,
    `L ${width} ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${bottom}`,
    `L ${r} ${bottom}`,
    `A ${r} ${r} 0 0 1 0 ${bottom - r}`,
    `L 0 ${top + r}`,
    `A ${r} ${r} 0 0 1 ${r} ${top}`,
    'Z',
  ].join(' ');
}

/**
 * The bar's surface, drawn rather than styled: a View can only be a
 * rectangle, and the hump is the point. The shadow is drawn too -- Android's
 * elevation shadows a view's rectangle, never a drawn shape, so it would have
 * outlined the empty corners instead of the bar.
 *
 * Below the bar's middle, the full width down to the bottom of the screen is
 * painted in the page colour. Screens scroll behind the bar, and without this
 * their rows showed through the gap under it and beside its lower half.
 */
function TabBarBackground({ width, footer }: { width: number; footer: number }) {
  const theme = useTheme();
  const bodyBottom = HUMP_HEIGHT + BODY_HEIGHT;
  // Inset half a pixel on every side so the 1px stroke isn't clipped.
  const outline = barPath(width - BAR_MARGIN * 2 - 1, HUMP_HEIGHT + 0.5, bodyBottom - 0.5);
  const x = BAR_MARGIN + 0.5;

  return (
    <Svg
      width={width}
      height={bodyBottom + footer}
      style={StyleSheet.absoluteFill}
      pointerEvents="none">
      <Rect
        x={0}
        y={HUMP_HEIGHT + BODY_HEIGHT / 2}
        width={width}
        height={BODY_HEIGHT / 2 + footer}
        fill={theme.background}
      />
      {/* Two faint copies stepping down below the bar: the cheap stand-in
          for a blurred shadow that draws the same on every platform. */}
      <Path d={outline} fill={theme.barShadow} transform={`translate(${x} ${SHADOW_DEPTH})`} />
      <Path d={outline} fill={theme.barShadow} transform={`translate(${x} ${SHADOW_DEPTH / 2})`} />
      <Path
        d={outline}
        transform={`translate(${x} 0)`}
        fill={theme.backgroundElement}
        stroke={theme.border}
        strokeWidth={1}
      />
    </Svg>
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
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      role={rest.role}
      aria-label={rest['aria-label']}
      aria-selected={rest['aria-selected']}
      testID={rest.testID}
      style={({ pressed }) => [style, styles.tab, { opacity: pressed ? 0.6 : 1 }]}>
      {children}
    </Pressable>
  );
}

/**
 * A floating tab bar: a rounded bar detached from the screen's edges, with
 * four tabs and a round Add button in the middle.
 *
 * Add Expense is not a tab: it's a task you start and finish, not a place you
 * navigate to, so it opens as a modal. Its slot is a tab in name only (the
 * "add" route): the slot's button never navigates, it pushes the modal. The
 * disc and the hump around it sit wholly inside the tab bar's own box, so
 * every part takes a tap -- on Android a view poking out above its parent
 * doesn't.
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
  const { width: screenWidth } = useWindowDimensions();

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
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textTertiary,
          tabBarStyle: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: HUMP_HEIGHT + BODY_HEIGHT + footer,
            paddingTop: 0,
            // Keeps the tabs inside the drawn bar, off the footer and sides.
            paddingBottom: footer,
            paddingHorizontal: BAR_MARGIN + Spacing.one,
            // The surface is TabBarBackground's drawing; the box itself is
            // invisible. Android's default bar carries elevation 8 and the
            // web one a top border, either of which would outline the box.
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarBackground: () => <TabBarBackground width={screenWidth} footer={footer} />,
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarLabel: ({ focused, color, children }) => (
            <Text
              style={[styles.label, { color, fontWeight: focused ? '700' : '500' }]}
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
              <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'History',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: 'Add expense',
            // Opens the modal instead of switching to this slot's (empty)
            // screen, so the tab you were on stays the current one.
            tabBarButton: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add expense"
                onPress={() => {
                  tapped();
                  router.push('/add-expense');
                }}
                style={({ pressed }) => [
                  styles.addSlot,
                  { transform: [{ scale: pressed ? 0.94 : 1 }] },
                ]}>
                <View style={[styles.addButton, { backgroundColor: theme.primary }]}>
                  <Ionicons name="add" size={26} color={theme.onPrimary} />
                </View>
                <Text style={[styles.label, { color: theme.primary, fontWeight: '700' }]}>
                  Add
                </Text>
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'Reports',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'stats-chart' : 'stats-chart-outline'}
                size={22}
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
                name={focused ? 'ellipsis-horizontal-circle' : 'ellipsis-horizontal-circle-outline'}
                size={22}
                color={color}
              />
            ),
          }}
        />
      </Tabs>

      {/* Mounted once for the whole tab shell, floating above the bar so it
          disturbs no layout and returns null when there is nothing to say.
          It used to live inline on Home and NOWHERE else, so an expense queued
          offline from any other tab had no indicator at all -- the one thing
          the queue must never be is silent. */}
      <View
        style={[
          styles.bannerWrap,
          { bottom: footer + BODY_HEIGHT + HUMP_HEIGHT + 12 },
        ]}>
        <SyncBanner />
      </View>

      {/* Mounted once for the tab shell, like the banner: it asks accounts
          made before phone sign-in to add a number, wherever they land. */}
      <PhoneNudge />
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
  // Tabs and the Add slot are both laid out from the bottom up, with the same
  // bottom padding, so every label sits on one line and the taller Add disc
  // grows upward instead of pushing its label down.
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 11,
    gap: 4,
  },
  label: { fontSize: 11, lineHeight: 14, letterSpacing: 0.1 },
  addSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 11,
    gap: 3,
  },
  addButton: {
    width: ADD_SIZE,
    height: ADD_SIZE,
    borderRadius: ADD_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
