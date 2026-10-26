import { useEffect } from 'react';
import type { DimensionValue, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
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
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.45, { duration: 750 }), -1, true);
  }, [opacity]);

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
