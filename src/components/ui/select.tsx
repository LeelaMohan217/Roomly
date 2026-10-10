import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SelectOption = {
  value: string;
  label: string;
  /** Shown under the label — e.g. what a category does to the split. */
  hint?: string;
  glyph?: string;
};

type Props = {
  label: string;
  placeholder: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * A sheet picker rather than a chip row. With thirteen categories the chips
 * overflowed sideways and you couldn't see what you hadn't scrolled to; a
 * list shows everything and has room to say what each option does.
 */
export function Select({ label, placeholder, value, options, onChange, disabled }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <View style={styles.wrap}>
      <ThemedText themeColor="textTertiary" style={Type.label}>
        {label.toUpperCase()}
      </ThemedText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
          },
        ]}>
        {selected?.glyph ? (
          <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText style={styles.glyph}>{selected.glyph}</ThemedText>
          </View>
        ) : null}

        <View style={styles.fieldText}>
          <ThemedText
            themeColor={selected ? 'text' : 'textTertiary'}
            style={Type.body}
            numberOfLines={1}>
            {selected ? selected.label : placeholder}
          </ThemedText>
          {selected?.hint ? (
            <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
              {selected.hint}
            </ThemedText>
          ) : null}
        </View>

        <Ionicons name="chevron-down" size={16} color={theme.textTertiary} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        navigationBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              // Edge-to-edge is always on in SDK 57, so bottom: 0 is the
              // bottom of the display, behind the navigation bar. A fixed
              // 32dp gutter is less than a 48dp 3-button bar, which drew the
              // last option underneath it.
              paddingBottom: Math.max(insets.bottom, Spacing.three),
            },
          ]}>
          <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />

          <View style={styles.sheetHeader}>
            <ThemedText style={Type.title}>{label}</ThemedText>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <ThemedText style={[Type.body, { color: theme.primary, fontWeight: '700' }]}>
                Done
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {options.map((o) => {
              const isSelected = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: isSelected ? theme.primarySoft : theme.backgroundElement,
                      borderColor: isSelected ? theme.primary : theme.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}>
                  {o.glyph ? (
                    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText style={styles.glyph}>{o.glyph}</ThemedText>
                    </View>
                  ) : null}

                  <View style={styles.optionText}>
                    <ThemedText style={Type.body}>{o.label}</ThemedText>
                    {o.hint ? (
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {o.hint}
                      </ThemedText>
                    ) : null}
                  </View>

                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  fieldText: { flex: 1, gap: 1 },
  tile: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 17 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  list: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three, gap: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  optionText: { flex: 1, gap: 1 },
});
