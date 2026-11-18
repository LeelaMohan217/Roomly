import { Tabs, useRouter } from 'expo-router';
import type { BottomTabBarButtonProps } from 'expo-router/tabs';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GuidedTour } from '@/components/guided-tour';
import { PhoneNudge } from '@/components/phone-nudge';
import { UpdatePrompt } from '@/components/update-prompt';
import { SyncBanner } from '@/components/ui/sync-banner';
import { appFontFor } from '@/constants/fonts';
import { Spacing, TabBar } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { usePushRegistration } from '@/lib/push';
import { useHouseholdRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { resolveTour, useTourStore, useTourTarget, type TourTarget } from '@/lib/tour';
import { Icon, type IconName } from '@/components/ui/icon';

const BODY_HEIGHT = TabBar.body;
const BAR_MARGIN = TabBar.margin;
/** The Add disc is as tall as the pill beside it. */
const ADD_SIZE = BODY_HEIGHT;
/** Room the pill leaves on its right for the Add disc and the gap before it. */
const ADD_ROOM = ADD_SIZE + TabBar.gap;
/** The current tab's capsule sits this far inside the bar on every side. */
const TAB_INSET = 6;
/** One easing for the capsule sliding over and the colours changing under it. */
const TAB_EASE = { duration: 220, easing: Easing.out(Easing.cubic) };


/** What each tab draws, and its stop on the first-run tour, by route name. */
const TABS: Record<string, { title: string; icon: IconName; iconFocused: IconName; tour: TourTarget }> = {
  index: { title: 'Home', icon: 'home-outline', iconFocused: 'home', tour: 'tab-home' },
  history: { title: 'History', icon: 'receipt-outline', iconFocused: 'receipt', tour: 'tab-history' },
  reports: { title: 'Reports', icon: 'bar-chart-outline', iconFocused: 'bar-chart', tour: 'tab-reports' },
  more: { title: 'More', icon: 'menu-outline', iconFocused: 'menu', tour: 'tab-more' },
};

/** A tab's place inside the pill: its left edge and width. */
type Slot = { x: number; width: number };

/**
 * The bar’s surface: a floating pill for the four tabs, with the Add disc
 * beside it on the right (drawn separately, in the layout, so it can take
 * its own taps).
 *
 * Below the bar’s middle, the full width down to the bottom of the screen is
 * painted in the page colour. Screens scroll behind the bar, and without this
 * their rows showed through the gap under it and beside its lower half.
 *
 * The current tab's capsule lives here, inside the pill and behind the tabs,
 * drawn once and slid from tab to tab -- it used to be drawn inside each
 * tab, so it vanished from one and reappeared on the next. Inside the pill
 * rather than beside it because the pill carries Android elevation, which
 * would draw it over any sibling drawn after it.
 */
function TabBarBackground({
  footer,
  pillRef,
  indicatorX,
  indicatorWidth,
}: {
  footer: number;
  pillRef: RefObject<View | null>;
  indicatorX: SharedValue<number>;
  indicatorWidth: SharedValue<number>;
}) {
  const theme = useTheme();
  // The same TAB_INSET from the pill's top and bottom as from the tab's
  // sides, with round ends that follow the pill's own.
  const capsule = useAnimatedStyle(() => ({
    left: indicatorX.get() + TAB_INSET,
    width: Math.max(indicatorWidth.get() - TAB_INSET * 2, 0),
    opacity: indicatorWidth.get() > 0 ? 1 : 0,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.mask,
          { top: BODY_HEIGHT / 2, height: BODY_HEIGHT / 2 + footer, backgroundColor: theme.background },
        ]}
      />
      <View
        ref={pillRef}
        collapsable={false}
        style={[
          styles.pill,
          {
            right: BAR_MARGIN + ADD_ROOM,
            backgroundColor: theme.tabBar,
            borderColor: theme.tabBarEdge,
            shadowColor: theme.liftShadow,
          },
        ]}>
        <Animated.View style={[styles.tabHighlight, { backgroundColor: theme.tabActive }, capsule]} />
      </View>
    </View>
  );
}

/**
 * One tab: icon over label, both in green when it's the current one.
 *
 * Our own button rather than the navigator's: its default is a pressable with
 * a borderless Android ripple, which drew a large grey circle spilling past
 * the bar whenever a tab was tapped.
 *
 * It draws its own icon and label, ignoring the navigator's, so the change
 * between current and not can ease: the outline and filled icons, and the two
 * label weights and colours, cross-fade over the capsule's slide. It also
 * reports where it sits inside the pill, so the capsule knows where to go.
 */
function TabButton({
  children: _navigatorContent,
  onPress,
  onLongPress,
  style,
  routeName,
  pillRef,
  onSlot,
  onSelected,
  ...rest
}: BottomTabBarButtonProps & {
  routeName: string;
  pillRef: RefObject<View | null>;
  onSlot: (name: string, slot: Slot) => void;
  onSelected: (name: string) => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const meta = TABS[routeName];
  const selected = !!rest['aria-selected'];

  const tourRef = useTourTarget(meta?.tour);
  const nodeRef = useRef<View | null>(null);
  const setRef = useCallback(
    (node: View | null) => {
      nodeRef.current = node;
      tourRef(node);
    },
    [tourRef]
  );

  useEffect(() => {
    if (selected) onSelected(routeName);
  }, [selected, routeName, onSelected]);

  // 1 when this is the current tab. Jumps under reduced motion.
  const progress = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    const to = selected ? 1 : 0;
    progress.set(reduced ? to : withTiming(to, TAB_EASE));
  }, [selected, reduced, progress]);
  const activeStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const inactiveStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));

  // Both measured in the window, so the offset holds whatever wraps the tab.
  const measureSlot = () => {
    const node = nodeRef.current;
    const pill = pillRef.current;
    if (!node || !pill) return;
    pill.measureInWindow((pillX) => {
      node.measureInWindow((x, _y, width) => {
        if (width > 0) onSlot(routeName, { x: x - pillX, width });
      });
    });
  };

  if (!meta) return null;

  return (
    <Pressable
      ref={setRef}
      onLayout={measureSlot}
      onPress={onPress}
      onLongPress={onLongPress}
      role={rest.role}
      aria-label={rest['aria-label']}
      aria-selected={rest['aria-selected']}
      testID={rest.testID}
      style={({ pressed }) => [style, styles.tab, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={styles.iconBox}>
        <Animated.View style={inactiveStyle}>
          <Icon name={meta.icon} size={21} color={theme.textTertiary} />
        </Animated.View>
        <Animated.View style={[styles.overlay, activeStyle]}>
          <Icon name={meta.iconFocused} size={21} color={theme.tabActiveInk} />
        </Animated.View>
      </View>
      <View>
        <Animated.Text
          numberOfLines={1}
          style={[styles.label, { color: theme.textTertiary }, appFontFor({ fontWeight: '500' }), inactiveStyle]}>
          {meta.title}
        </Animated.Text>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.label,
            styles.overlay,
            { color: theme.tabActiveInk },
            appFontFor({ fontWeight: '600' }),
            activeStyle,
          ]}>
          {meta.title}
        </Animated.Text>
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
  const { session } = useSession();
  const addTarget = useTourTarget('add');
  const tourStatus = useTourStore((s) => s.status);
  const tourUser = useTourStore((s) => s.userId);

  // Whether this account still has the first-run tour to see (lib/tour).
  useEffect(() => {
    if (session) void resolveTour(session);
    // Per account: a token refresh hands over a new session object for the
    // same person, and must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  // Mounted once for the whole tab shell rather than per screen.
  useHouseholdRealtime();
  usePushRegistration();

  // Everything under the bar's body: the gap and the system inset.
  const footer = BAR_MARGIN + insets.bottom;

  // The sliding capsule: where each tab sits in the pill (each tab reports
  // its own), which one is current, and the capsule's eased position.
  const reduced = useReducedMotion();
  const pillRef = useRef<View | null>(null);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);

  const reportSlot = useCallback((name: string, slot: Slot) => {
    setSlots((prev) =>
      prev[name]?.x === slot.x && prev[name]?.width === slot.width ? prev : { ...prev, [name]: slot }
    );
  }, []);

  useEffect(() => {
    const slot = current ? slots[current] : undefined;
    if (!slot) return;
    // The first placement, and anyone who asked for less motion, jumps.
    const animate = !reduced && indicatorWidth.get() > 0;
    indicatorX.set(animate ? withTiming(slot.x, TAB_EASE) : slot.x);
    indicatorWidth.set(animate ? withTiming(slot.width, TAB_EASE) : slot.width);
  }, [current, slots, reduced, indicatorX, indicatorWidth]);

  return (
    <View style={styles.wrap}>
      <Tabs
        screenOptions={({ route }) => ({
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
            // Exactly the pill's edges, so the current tab's capsule sits the
            // same distance from the bar's sides as from its top and bottom.
            // The right side also clears the Add disc beside the pill.
            paddingLeft: BAR_MARGIN,
            paddingRight: BAR_MARGIN + ADD_ROOM,
            // The surface is TabBarBackground's drawing; the box itself is
            // invisible. Android's default bar carries elevation 8 and the
            // web one a top border, either of which would outline the box.
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarBackground: () => (
            <TabBarBackground
              footer={footer}
              pillRef={pillRef}
              indicatorX={indicatorX}
              indicatorWidth={indicatorWidth}
            />
          ),
          // Icon and label are drawn by TabButton from TABS, so they can ease.
          tabBarButton: (props) => (
            <TabButton
              {...props}
              routeName={route.name}
              pillRef={pillRef}
              onSlot={reportSlot}
              onSelected={setCurrent}
            />
          ),
        })}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="history" options={{ title: 'History' }} />
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
        <Tabs.Screen name="reports" options={{ title: 'Reports' }} />
        <Tabs.Screen name="more" options={{ title: 'More' }} />
      </Tabs>

      {/* Add expense: its own round disc beside the pill, as tall as it.
          It opens the modal instead of switching tabs, so the tab you were on
          stays the current one. */}
      <Pressable
        ref={addTarget}
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
        <Icon name="add" size={26} color={theme.onFab} />
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
      {/* One thing at a time over Home: the tour first, and the phone sheet
          only once it is settled that there is no tour, or it is done. */}
      {tourStatus === 'idle' && tourUser === session?.user.id ? <PhoneNudge /> : null}

      {/* "Update ready -- Restart now" once a new version has downloaded,
          shown only on the tabs so it never lands on a half-typed form. */}
      <UpdatePrompt />

      {/* Last, so it draws over the bar, the Add disc and everything else. */}
      <GuidedTour />
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
    gap: 2,
  },
  // TAB_INSET from the pill's top and bottom; left and width come from the
  // current tab's slot. Concentric with the bar.
  tabHighlight: {
    position: 'absolute',
    top: TAB_INSET,
    bottom: TAB_INSET,
    borderRadius: (BODY_HEIGHT - TAB_INSET * 2) / 2,
  },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  // The current-tab version, laid exactly over the other one.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', textAlign: 'center' },
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
