import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
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

  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundSunken }]}>
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
            style={[styles.item, selected && { backgroundColor: theme.backgroundElement }]}>
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, gap: 3 },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.sm,
  },
  selected: { fontWeight: '700' },
});
