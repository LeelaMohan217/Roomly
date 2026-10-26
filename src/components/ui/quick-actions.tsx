import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type QuickAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accent?: boolean;
  /** The action's own hue, for its glyph, label and a wash behind the glyph.
   *  Must pass 4.5:1 on the page, since the label is small text. */
  color?: string;
};

/**
 * The row of round actions under the balance, straight out of every banking
 * app — and for the same reason: the four things you actually do are one tap
 * away, and each is a target big enough for a thumb.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={a.onPress}
          style={({ pressed }) => [styles.item, { opacity: pressed ? 0.6 : 1 }]}>
          <View
            style={[
              styles.circle,
              {
                // A coloured action gets a wash of its own hue (hex alpha),
                // so the tile, glyph and label read as one colour.
                backgroundColor: a.color
                  ? `${a.color}1F`
                  : a.accent
                    ? theme.primarySoft
                    : theme.backgroundElement,
                borderColor: a.color ? `${a.color}33` : a.accent ? 'transparent' : theme.border,
              },
            ]}>
            <Ionicons
              name={a.icon}
              size={19}
              color={a.color ?? (a.accent ? theme.primary : theme.textSecondary)}
            />
          </View>
          <ThemedText
            themeColor="textSecondary"
            style={[Type.micro, a.color ? { color: a.color, fontWeight: '600' } : null]}
            numberOfLines={1}>
            {a.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  item: { flex: 1, alignItems: 'center', gap: Spacing.two },
  circle: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
