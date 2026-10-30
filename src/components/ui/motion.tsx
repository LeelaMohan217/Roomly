import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * The app's whole vocabulary of motion, in one place so every screen moves
 * the same way.
 *
 * Motion here does three jobs and no others: it says in what order a screen
 * assembled (so the eye lands on the balance first), it eases the swap from a
 * placeholder to the real thing, and it acknowledges a press. Nothing bounces,
 * nothing scales past a hair, and nothing waits on an animation before it can
 * be tapped -- entering animations never block touches.
 *
 * Reanimated's declarative `entering` throughout: it runs on the UI thread,
 * and its default `ReduceMotion.System` means anyone who has asked their phone
 * for less motion simply gets the finished layout.
 */
export const Motion = {
  /** One section's fade-and-rise. */
  enter: 260,
  /** The gap between one section and the next in a screen's stagger. */
  stagger: 50,
  /** A placeholder giving way to content, or a row opening. */
  fade: 200,
  /** Press in fast so it feels immediate; release a little slower. */
  pressIn: 90,
  pressOut: 160,
} as const;

/**
 * A screen section that fades and rises 10dp into place on mount.
 *
 * `index` is its place in the screen's top-to-bottom order. Keep a screen to
 * four or five steps, so the last section has landed in well under half a
 * second. It only plays on mount: tab screens stay mounted, so switching tabs
 * or a background refetch never replays it.
 */
export function Appear({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View
      style={style}
      entering={FadeInDown.duration(Motion.enter).delay(index * Motion.stagger)}>
      {children}
    </Animated.View>
  );
}

/**
 * Content that fades in where a placeholder or nothing used to be: a list
 * replacing its skeleton, or a row's details opening under it.
 *
 * Opacity only, no movement, since it lands in a spot the eye is already on.
 * Mount it once per real change -- behind a condition that flips when data
 * first arrives, not one that flickers on every refetch.
 */
export function Reveal({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View style={style} entering={FadeIn.duration(Motion.fade)}>
      {children}
    </Animated.View>
  );
}

/**
 * Press feedback for an Animated.View or Pressable: a quick dim and, unless
 * the phone asks for reduced motion, a squash too small to notice as movement.
 *
 * Eased in and out on the UI thread, where the old style-function version
 * snapped between two states on the JS thread. Spread the handlers onto the
 * Pressable; any of the caller's own onPressIn/onPressOut still run.
 *
 * Not for rows inside an elevated Card: lowering opacity there leaves a pale
 * band on Android, which is why those rows press to a tint instead.
 */
export function usePressFeedback({
  resting = 1,
  dim = 0.18,
  squash = 0.015,
  onPressIn,
  onPressOut,
}: {
  /** Opacity when not pressed -- lower for a disabled control. The animated
   *  style owns opacity, so a static one beside it would be overridden. */
  resting?: number;
  /** How much opacity to lose at full press. */
  dim?: number;
  /** How much to shrink at full press; 0 for none. */
  squash?: number;
  onPressIn?: ((e: GestureResponderEvent) => void) | null;
  onPressOut?: ((e: GestureResponderEvent) => void) | null;
} = {}) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const shrink = reduced ? 0 : squash;

  const style = useAnimatedStyle(() => ({
    opacity: resting * (1 - dim * pressed.value),
    transform: [{ scale: 1 - shrink * pressed.value }],
  }));

  return {
    style,
    onPressIn: (e: GestureResponderEvent) => {
      pressed.value = withTiming(1, { duration: Motion.pressIn });
      onPressIn?.(e);
    },
    onPressOut: (e: GestureResponderEvent) => {
      pressed.value = withTiming(0, { duration: Motion.pressOut });
      onPressOut?.(e);
    },
  };
}
