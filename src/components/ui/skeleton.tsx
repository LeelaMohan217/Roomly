import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A soft grey shape that gently pulses while data loads.
 *
 * It exists because a zero is a claim. Home used to show "₹0.00" and
 * "0% vs last week" until the numbers arrived -- a wrong answer, shown first.
 * A placeholder shape says "not yet" without saying anything false.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = Radius.sm,
  tint,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  /** Overrides the fill, for placeholders on a coloured surface. */
  tint?: string;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 0.7 : 1);

  // A pulse that never stops is exactly what reduced motion asks to be spared;
  // a still shape says "not yet" just as well.
  useEffect(() => {
    if (reduced) return;
    opacity.value = withRepeat(withTiming(0.45, { duration: 750 }), -1, true);
  }, [opacity, reduced]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: tint ?? theme.backgroundSelected },
        pulse,
        style,
      ]}
    />
  );
}

/**
 * A few list rows' worth of placeholder -- a tile, two lines, an amount --
 * for screens whose first load would otherwise be a spinner over nothing.
 * The shape of a list says what is coming; a spinner only says "wait".
 */
export function SkeletonRows({ count = 3 }: { count?: number }) {
  const theme = useTheme();

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.row,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
          ]}>
          <Skeleton width={36} height={36} radius={Radius.md} />
          <View style={styles.lines}>
            <Skeleton width="55%" height={12} />
            <Skeleton width="35%" height={10} />
          </View>
          <Skeleton width={60} height={13} />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  lines: { flex: 1, gap: 6 },
});
