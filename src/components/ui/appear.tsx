import Animated, { FadeInDown } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

/**
 * A block that fades and rises into place on mount.
 *
 * Motion here is doing one job: telling you the screen assembled in an order,
 * so your eye lands on the balance card first rather than on whatever happens
 * to be brightest. Which is why it is a stagger and not a flourish -- 260ms,
 * a 10dp rise, and never on anything the user is about to tap.
 *
 * Reanimated's declarative `entering` rather than a hand-written worklet: it
 * runs on the UI thread without this component knowing anything about frames,
 * and it is a no-op if a platform cannot honour it.
 */
export function Appear({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  /** Position in the stagger, in ms. Keep the whole sequence under ~300ms. */
  delay?: number;
  style?: ViewStyle;
}) {
  return (
    <Animated.View style={style} entering={FadeInDown.duration(260).delay(delay)}>
      {children}
    </Animated.View>
  );
}
