import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SyncBanner } from '@/components/ui/sync-banner';
import { Elevation, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { usePushRegistration } from '@/lib/push';
import { useHouseholdRealtime } from '@/lib/realtime';

const BAR_CONTENT_HEIGHT = 72;

/**
 * Five tabs and a floating Add button.
 *
 * Add Expense is not a tab: it's a task you start and finish, not a place you
 * navigate to, so it opens as a modal from a FAB. A raised centre tab is the
 * iOS convention; on Android a bottom-right FAB is the native one, and this
 * ships as an Android APK.
 *
 * The bar height is content height plus the real safe-area inset. Hardcoding
 * per-platform numbers clipped the labels — on web the inset is 0 and the
 * navigator collapsed the bar to 42px, which isn't tall enough for a label.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Mounted once for the whole tab shell rather than per screen.
  useHouseholdRealtime();
  usePushRegistration();

  const barHeight = BAR_CONTENT_HEIGHT + insets.bottom;

  // The FAB sits bottom-right, 16dp above the bar -- exactly where the
  // calculator's "=" key is. Hidden there rather than moved, because that
  // screen has a better route into an expense anyway: "Use in an expense",
  // which carries the total across instead of opening an empty form.
  const showFab = pathname !== '/calculator';

  return (
    <View style={styles.wrap}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textTertiary,
          tabBarStyle: {
            backgroundColor: theme.backgroundElement,
            borderTopColor: theme.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            height: barHeight,
            paddingBottom: insets.bottom + 14,
            paddingTop: 10,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.1 },
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
          name="reports"
          options={{
            title: 'Reports',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'stats-chart' : 'stats-chart-outline'}
                size={21}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="calculator"
          options={{
            title: 'Calculator',
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? 'calculator' : 'calculator-outline'}
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
                name={focused ? 'ellipsis-horizontal-circle' : 'ellipsis-horizontal-circle-outline'}
                size={21}
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
          the queue must never be is silent. Sits above the FAB rather than
          beside it, since it spans the full width. */}
      <View style={[styles.bannerWrap, { bottom: barHeight + 16 + (showFab ? 68 : 0) }]}>
        <SyncBanner />
      </View>

      {showFab ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add expense"
        onPress={() => {
          tapped();
          router.push('/add-expense');
        }}
        style={({ pressed }) => [
          styles.fabWrap,
          {
            bottom: barHeight + 16,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
        ]}>
        {/* Solid, not a gradient: the balance card is the only gradient on
            screen, and a second one competes with it. */}
        <View style={[styles.fab, { backgroundColor: theme.primary }]}>
          <Ionicons name="add" size={26} color={theme.onPrimary} />
        </View>
      </Pressable>
      ) : null}
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
  fabWrap: {
    position: 'absolute',
    right: 20,
    borderRadius: 30,
    ...(Elevation.raised as object),
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
