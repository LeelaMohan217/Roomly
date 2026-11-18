import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Appear } from '@/components/ui/motion';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { committed } from '@/lib/haptics';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 104;
const R = 44;
const LENGTH = 2 * Math.PI * R;

/**
 * What New expense turns into once an expense is saved: a ring that draws
 * itself round, a tick that pops in, the buzz, and what just happened in
 * words -- then Done, or Add another for a run of bills.
 *
 * Under Reduce motion everything is simply there.
 */
export function SaveSuccess({
  title,
  lines,
  onDone,
  onAnother,
}: {
  title: string;
  /** One or two short lines: what, how it split, your share. */
  lines: string[];
  onDone: () => void;
  onAnother: () => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const ring = useSharedValue(reduced ? 1 : 0);
  const tick = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    committed();
    if (reduced) return;
    ring.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    tick.value = withDelay(380, withSpring(1, { damping: 9, stiffness: 180 }));
  }, [reduced, ring, tick]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: LENGTH * (1 - ring.value),
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: Math.min(tick.value * 2, 1),
    transform: [{ scale: 0.4 + 0.6 * tick.value }],
  }));

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <View style={styles.badge}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill={theme.primarySoft} />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={theme.primary}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${LENGTH} ${LENGTH}`}
            animatedProps={ringProps}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <Animated.View style={[styles.tick, { backgroundColor: theme.primary }, tickStyle]}>
          <Svg width={30} height={30} viewBox="0 0 24 24">
            <Path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke={theme.onPrimary}
              strokeWidth={2.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      </View>

      <Appear index={3} style={styles.words}>
        <ThemedText style={styles.title} accessibilityRole="header">
          {title}
        </ThemedText>
        {lines.map((l) => (
          <ThemedText key={l} themeColor="textSecondary" style={[Type.body, styles.center]}>
            {l}
          </ThemedText>
        ))}
      </Appear>

      <Appear index={4} style={styles.actions}>
        <Button title="Done" onPress={onDone} style={styles.done} />
        <Button title="Add another" variant="ghost" onPress={onAnother} />
      </Appear>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  badge: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  tick: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { alignItems: 'center', gap: Spacing.one },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.4 },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.two },
  done: { minHeight: 54, borderRadius: 999 },
});
