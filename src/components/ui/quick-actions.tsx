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
                backgroundColor: a.accent ? theme.primarySoft : theme.backgroundElement,
                borderColor: a.accent ? 'transparent' : theme.border,
              },
            ]}>
            <Ionicons
              name={a.icon}
              size={19}
              color={a.accent ? theme.primary : theme.textSecondary}
            />
          </View>
          <ThemedText themeColor="textSecondary" style={Type.micro} numberOfLines={1}>
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
