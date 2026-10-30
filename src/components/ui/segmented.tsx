import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Motion } from '@/components/ui/motion';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** Shown after the label when non-zero. Omit to show nothing. */
  count?: number;
};

/**
 * A row of mutually exclusive choices.
 *
 * Deliberately NOT shared with the WHEN control in expense-form.tsx, which
 * looks the same and is not the same thing: its third segment does not select
 * a value, it opens a date picker. Folding the two together would mean adding
 * an "or run this instead" escape hatch to every segment here, and the first
 * person to tidy that up would break the date picker. Two small controls beat
 * one that has to explain itself.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  // The white pill slides to the new choice instead of blinking there, so the
  // change reads as one thing moving. Until the row has been measured the
  // selected segment paints its own background, so nothing is ever missing.
  const segment = width > 0 ? (width - PAD * 2 - GAP * (options.length - 1)) / options.length : 0;
  const x = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (segment === 0) return;
    const target = index * (segment + GAP);
    // The first placement jumps: there is nothing to slide from.
    x.value = placed.current ? withTiming(target, { duration: Motion.fade }) : target;
    placed.current = true;
  }, [index, segment, x]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      style={[styles.row, { backgroundColor: theme.backgroundSunken }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {segment > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.thumb, { width: segment, backgroundColor: theme.backgroundElement }, thumb]}
        />
      ) : null}
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.count ? `${opt.label}, ${opt.count}` : opt.label}
            onPress={() => onChange(opt.value)}
            disabled={disabled}
            style={[
              styles.item,
              selected && segment === 0 && { backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText
              themeColor={selected ? 'text' : 'textSecondary'}
              style={[Type.caption, selected && styles.selected]}
              numberOfLines={1}>
              {opt.label}
              {opt.count ? ` (${opt.count})` : ''}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const PAD = 3;
const GAP = 3;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: Radius.md, padding: PAD, gap: GAP },
  thumb: { position: 'absolute', top: PAD, bottom: PAD, left: PAD, borderRadius: Radius.sm },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.sm,
  },
  selected: { fontWeight: '600' },
});
