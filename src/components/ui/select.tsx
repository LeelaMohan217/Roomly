import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Elevation, MaxContentWidth, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Icon, type IconName } from '@/components/ui/icon';

export type SelectOption = {
  value: string;
  label: string;
  /** Shown under the label — e.g. what a category does to the split. */
  hint?: string;
  /** Drawn in a small tile before the label. */
  icon?: IconName;
};

type Props = {
  label: string;
  placeholder: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * A row in a grouped list rather than a labelled field: no label above it,
   * no box around it, a grey icon tile while nothing is picked, and a
   * chevron. The label still names it for screen readers and the sheet.
   */
  bare?: boolean;
  /** The tile's icon while nothing is picked; bare rows only. */
  icon?: IconName;
  /**
   * Open as a list dropping down from the field itself, rather than a sheet
   * from the bottom of the screen. Opens upwards when there is no room below.
   */
  anchored?: boolean;
};

/** Where an anchored list goes, measured from the field when it opens. */
type Anchor = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/** Below this much room under the field, the list opens upwards instead. */
const MIN_ROOM_BELOW = 220;
const LIST_MAX = 340;

/**
 * A sheet picker rather than a chip row. With thirteen categories the chips
 * overflowed sideways and you couldn't see what you hadn't scrolled to; a
 * list shows everything and has room to say what each option does.
 */
export function Select({
  label,
  placeholder,
  value,
  options,
  onChange,
  disabled,
  bare = false,
  icon = 'apps-outline',
  anchored = false,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const fieldRef = useRef<View>(null);
  const selected = options.find((o) => o.value === value) ?? null;

  function openList() {
    const field = fieldRef.current;
    if (!anchored || !field) {
      setOpen(true);
      return;
    }
    field.measureInWindow((x, y, width, height) => {
      const below = windowHeight - (y + height) - insets.bottom - Spacing.three;
      const above = y - insets.top - Spacing.three;
      const downwards = below >= MIN_ROOM_BELOW || below >= above;
      setAnchor(
        downwards
          ? { left: x, width, top: y + height + 6, maxHeight: Math.min(LIST_MAX, below) }
          : { left: x, width, bottom: windowHeight - y + 6, maxHeight: Math.min(LIST_MAX, above) }
      );
      setOpen(true);
    });
  }

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <View style={bare ? undefined : styles.wrap}>
      {/* Sentence case, as TextField labels are. */}
      {bare ? null : (
        <ThemedText themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      )}

      <Pressable
        ref={fieldRef}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityState={{ expanded: open }}
        disabled={disabled}
        onPress={openList}
        style={({ pressed }) => [
          bare ? styles.bareField : styles.field,
          bare
            ? { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }
            : {
                backgroundColor: theme.backgroundElement,
                // The open field takes the focus colour, as a TextField does.
                borderColor: anchored && open ? theme.primary : theme.border,
                borderWidth: anchored && open ? 1.4 : StyleSheet.hairlineWidth,
                opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
              },
        ]}>
        {/* Bare rows sit in a white card, with the same green-tinted tile
            as the rows around them. */}
        {selected?.icon ? (
          <View
            style={[
              styles.tile,
              bare && styles.bareTile,
              { backgroundColor: bare ? theme.primarySoft : theme.liftTile },
            ]}>
            <Icon name={selected.icon} size={18} color={bare ? theme.brandInk : theme.textSecondary} />
          </View>
        ) : bare ? (
          <View style={[styles.tile, styles.bareTile, { backgroundColor: theme.primarySoft }]}>
            <Icon name={icon} size={18} color={theme.brandInk} />
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

        <Icon
          name={bare ? 'chevron-forward' : anchored && open ? 'chevron-up' : 'chevron-down'}
          size={bare ? 15 : 16}
          color={theme.textTertiary}
        />
      </Pressable>

      {anchored ? (
        <Modal
          visible={open && !!anchor}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
          statusBarTranslucent
          navigationBarTranslucent>
          {/* Clear, not dimmed: the list belongs to the field, not over the page. */}
          <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          {anchor ? (
            <View
              style={[
                styles.dropdown,
                {
                  left: anchor.left,
                  width: anchor.width,
                  top: anchor.top,
                  bottom: anchor.bottom,
                  maxHeight: anchor.maxHeight,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.liftEdge,
                },
              ]}>
              <ScrollView
                contentContainerStyle={styles.dropdownList}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled">
                {options.map((o) => {
                  const isSelected = o.value === value;
                  return (
                    <Pressable
                      key={o.value}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => choose(o.value)}
                      style={({ pressed }) => [
                        styles.dropdownOption,
                        {
                          backgroundColor: isSelected
                            ? theme.primarySoft
                            : pressed
                              ? theme.backgroundSelected
                              : 'transparent',
                        },
                      ]}>
                      {o.icon ? (
                        <Icon
                          name={o.icon}
                          size={18}
                          color={isSelected ? theme.brandInk : theme.textSecondary}
                        />
                      ) : null}
                      <ThemedText style={[Type.body, styles.optionText]} numberOfLines={1}>
                        {o.label}
                      </ThemedText>
                      {isSelected ? (
                        <Icon name="checkmark" size={18} color={theme.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </Modal>
      ) : null}

      <Modal
        visible={open && !anchored}
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
              <ThemedText style={[Type.body, { color: theme.primary, fontWeight: '600' }]}>
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
                  {o.icon ? (
                    <View style={[styles.tile, { backgroundColor: theme.liftTile }]}>
                      <Icon name={o.icon} size={18} color={theme.textSecondary} />
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
                    <Icon name="checkmark-circle" size={20} color={theme.primary} />
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
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  bareField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
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
  bareTile: { width: 38, height: 38, borderRadius: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  // A Modal draws over the whole window, outside the app's centred column,
  // so the sheet caps itself to the same width.
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    maxHeight: '78%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
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
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  optionText: { flex: 1, gap: 1 },
  // The anchored list: lifted off the page, the field's width, scrolling.
  dropdown: {
    position: 'absolute',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...Elevation.raised,
  },
  dropdownList: { padding: Spacing.one },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    borderRadius: Radius.sm,
  },
});
