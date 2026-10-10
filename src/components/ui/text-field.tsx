import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  secure?: boolean;
};

export function TextField({ label, hint, error, secure = false, style, ...rest }: Props) {
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label ? (
        <ThemedText themeColor="textTertiary" style={Type.label}>
          {label.toUpperCase()}
        </ThemedText>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.backgroundElement,
            // A focus ring instead of a colour change: it reads as an overlay
            // rather than the field itself becoming a different component.
            borderColor: error ? theme.danger : focused ? theme.primary : theme.border,
            borderWidth: focused || error ? 1.4 : StyleSheet.hairlineWidth,
          },
        ]}>
        <TextInput
          style={[styles.input, Type.body, { color: theme.text }, style]}
          placeholderTextColor={theme.textTertiary}
          secureTextEntry={secure && !revealed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />

        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={12}
            onPress={() => setRevealed((v) => !v)}>
            <ThemedText themeColor="textSecondary" style={Type.micro}>
              {revealed ? 'Hide' : 'Show'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <ThemedText style={[Type.micro, { color: theme.danger }]}>{error}</ThemedText>
      ) : hint ? (
        <ThemedText themeColor="textTertiary" style={Type.micro}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 50,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  // minWidth 0 so the input can shrink below its intrinsic width on web.
  input: { flex: 1, minWidth: 0, paddingVertical: Spacing.two },
});
