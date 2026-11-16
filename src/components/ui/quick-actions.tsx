import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Appear, usePressFeedback } from '@/components/ui/motion';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type QuickAction = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

const SIZE = 48;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The row of round actions under the balance, straight out of every banking
 * app — and for the same reason: the four things you actually do are one tap
 * away, and each is a target big enough for a thumb.
 *
 * Every action is the same pale brand green with a green glyph and the label
 * in plain ink. They used to be a hue each (green, blue, purple, orange),
 * which spent the screen's colour on telling four buttons apart -- the icons
 * and words already do that. Then they were solid green, which put four
 * loud discs right under the green balance card and left the eye no single
 * place to land; solid green is kept for that card and the Add button.
 */
export function QuickActions({
  actions,
  enterIndex = 0,
  onWash = false,
}: {
  actions: QuickAction[];
  /** The first action's step in the screen's entrance; each next one follows. */
  enterIndex?: number;
  /** Frosted discs and white labels, for sitting on Home's green wash. */
  onWash?: boolean;
}) {
  return (
    <View style={styles.row}>
      {actions.map((a, i) => (
        <Appear key={a.key} index={enterIndex + i} style={styles.slot}>
          <Action action={a} onWash={onWash} />
        </Appear>
      ))}
    </View>
  );
}

/** Its own component so each action has its own press animation. */
function Action({ action: a, onWash }: { action: QuickAction; onWash: boolean }) {
  const theme = useTheme();
  const press = usePressFeedback({ dim: 0.35, squash: 0.04 });

  if (onWash) {
    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={a.label}
        onPress={a.onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.item, press.style]}>
        <View
          style={[
            styles.circle,
            styles.frosted,
            { backgroundColor: theme.frostLight, borderColor: theme.frostStrongEdge },
          ]}>
          <Ionicons name={a.icon} size={22} color={theme.frostIcon} />
        </View>
        <ThemedText style={[Type.micro, styles.washLabel, { color: theme.onWash }]} numberOfLines={1}>
          {a.label}
        </ThemedText>
      </AnimatedPressable>
    );
  }

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={a.label}
      onPress={a.onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[styles.item, press.style]}>
      <View style={[styles.circle, { backgroundColor: theme.primarySoft }]}>
        <Ionicons name={a.icon} size={21} color={theme.brandInk} />
      </View>
      <ThemedText style={[Type.micro, styles.label]} numberOfLines={1}>
        {a.label}
      </ThemedText>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  slot: { flex: 1 },
  item: { flex: 1, alignItems: 'center', gap: Spacing.two },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frosted: { width: 54, height: 54, borderRadius: 27, borderWidth: 1 },
  label: { fontWeight: '500' },
  // Full white and a step heavier, so the names hold on the brighter green.
  washLabel: { fontWeight: '600' },
});
