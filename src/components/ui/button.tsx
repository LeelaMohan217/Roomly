import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { usePressFeedback } from '@/components/ui/motion';
import { tapped } from '@/lib/haptics';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  style?: ViewStyle;
};

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  ...rest
}: Props) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  // Wrapped rather than left to each caller: a button that sometimes buzzes is
  // worse than one that never does. onPress is optional on PressableProps, so
  // the feedback fires only when there is something to press.
  const { onPress, onPressIn, onPressOut, ...pressable } = rest;
  const press = usePressFeedback({ resting: isDisabled ? 0.45 : 1, onPressIn, onPressOut });

  const background =
    variant === 'primary'
      ? theme.primary
      : variant === 'secondary'
        ? theme.backgroundSelected
        : variant === 'danger'
          ? theme.dangerSoft
          : 'transparent';

  const label =
    variant === 'primary' ? theme.onPrimary : variant === 'danger' ? theme.danger : theme.text;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={[
        styles.base,
        { backgroundColor: background },
        variant === 'ghost' && { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
        style,
        // A slight dim and squash, eased on the UI thread.
        press.style,
      ]}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={
        onPress
          ? (e) => {
              tapped();
              onPress(e);
            }
          : undefined
      }
      {...pressable}>
      {loading ? (
        <ActivityIndicator color={label} size="small" />
      ) : (
        <ThemedText style={[styles.label, { color: label }]} numberOfLines={1}>
          {title}
        </ThemedText>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // A pill, as on the expense form's Save.
    minHeight: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  // lineHeight is set explicitly because ThemedText's default style lands
  // first in the array and carries lineHeight: 24 for a 16px font. Overriding
  // fontSize without it gave every label a 24dp line box, so a two-line label
  // was 48dp of text and grew the button instead of being visibly wrong.
  label: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
});
