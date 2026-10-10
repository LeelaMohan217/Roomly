import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { tapped } from '@/lib/haptics';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
  const { onPress, ...pressable } = rest;

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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: background },
        variant === 'ghost' && { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
        // A slight squash on press reads as responsive without an animation lib.
        { opacity: isDisabled ? 0.45 : pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        style,
      ]}
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  // lineHeight is set explicitly because ThemedText's default style lands
  // first in the array and carries lineHeight: 24 for a 16px font. Overriding
  // fontSize without it gave every label a 24dp line box, so a two-line label
  // was 48dp of text and grew the button instead of being visibly wrong.
  label: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
});
