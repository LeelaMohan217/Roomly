import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { toneColors, type Tone } from '@/components/ui/dialog';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ICON: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  danger: 'alert-circle-outline',
  warning: 'warning-outline',
  success: 'checkmark-circle-outline',
  info: 'information-circle-outline',
};

/**
 * An inline message box on a screen: red for something that failed, amber for
 * a caution, green for something that worked, blue for plain information.
 *
 * The same red box used to be hand-built in eleven files with slightly
 * different icon sizes in each; this is that box, once.
 */
export function Notice({
  tone = 'danger',
  title,
  message,
  icon,
  style,
}: {
  tone?: Tone;
  title?: string;
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const colors = toneColors(theme, tone);

  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[styles.box, { backgroundColor: colors.soft }, style]}>
      <Ionicons name={icon ?? ICON[tone]} size={16} color={colors.fg} style={styles.icon} />
      <View style={styles.text}>
        {title ? (
          <ThemedText style={[Type.caption, styles.title, { color: colors.fg }]}>{title}</ThemedText>
        ) : null}
        <ThemedText
          style={[Type.micro, title ? { color: theme.textSecondary } : { color: colors.fg }]}>
          {message}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  icon: { marginTop: 1 },
  text: { flex: 1, gap: 2 },
  title: { fontWeight: '700' },
});
