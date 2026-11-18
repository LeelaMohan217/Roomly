import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Elevation, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** How many years back the month calendar goes. */
const YEARS_BACK = 4;

export type Month = { year: number; month: number };

/** "November", or "November 2025" for another year. */
export function monthLabel(m: Month, long = true): string {
  const name = (long ? MONTHS_LONG : MONTHS_SHORT)[m.month - 1];
  return m.year === new Date().getFullYear() ? name : `${name} ${m.year}`;
}

/** The month before. */
export function prevMonth(m: Month): Month {
  return m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 };
}

/**
 * A month calendar that drops down from the button that opened it: one year
 * at a time, with arrows to the year before and after. One tap picks a month
 * and closes; a tap outside closes without changing anything. Months yet to
 * come are off. With `onClear`, a last row goes back to every month.
 */
export function MonthCalendarPopover({
  anchorTop,
  align = 'right',
  shown,
  onPick,
  multi,
  onClear,
  onClose,
}: {
  /** Where the popover's top edge goes: just under the button. */
  anchorTop: number;
  /** Which side of the screen it hangs from: the side its button is on. */
  align?: 'left' | 'right';
  /** The month picked now, or null for none. Ignored with `multi`. */
  shown?: Month | null;
  /** One tap picks a month and closes. Ignored with `multi`. */
  onPick?: (m: Month) => void;
  /**
   * Several months at once: each tap ticks or unticks a month and the
   * calendar stays open until Done.
   */
  multi?: { selected: Month[]; onToggle: (m: Month) => void };
  onClear?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const firstShown = multi ? multi.selected[0] : shown;
  const [year, setYear] = useState(firstShown?.year ?? thisYear);
  const isOn = (y: number, m: number) =>
    multi
      ? multi.selected.some((s) => s.year === y && s.month === m)
      : !!shown && shown.year === y && shown.month === m;
  const nothingPicked = multi ? multi.selected.length === 0 : !shown;
  const earliest = thisYear - YEARS_BACK;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.popover,
          align === 'right' ? { right: Spacing.four } : { left: Spacing.four },
          {
            top: anchorTop,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.liftEdge,
            shadowColor: theme.liftShadow,
          },
        ]}>
        <View style={styles.yearBar}>
          <YearArrow
            icon="chevron-back"
            label="Previous year"
            disabled={year <= earliest}
            onPress={() => setYear(year - 1)}
          />
          <ThemedText style={styles.yearLabel}>{year}</ThemedText>
          <YearArrow
            icon="chevron-forward"
            label="Next year"
            disabled={year >= thisYear}
            onPress={() => setYear(year + 1)}
          />
        </View>
        <View style={styles.monthGrid}>
          {MONTHS_SHORT.map((label, i) => {
            const month = i + 1;
            const future = year === thisYear && month > thisMonth;
            const on = isOn(year, month);
            const current = year === thisYear && month === thisMonth;
            return (
              <Pressable
                key={label}
                accessibilityRole={multi ? 'checkbox' : 'radio'}
                accessibilityLabel={`${MONTHS_LONG[i]} ${year}`}
                accessibilityState={
                  multi ? { checked: on, disabled: future } : { selected: on, disabled: future }
                }
                disabled={future}
                onPress={() => (multi ? multi.onToggle({ year, month }) : onPick?.({ year, month }))}
                style={({ pressed }) => [
                  styles.monthCell,
                  {
                    backgroundColor: on ? theme.primary : theme.backgroundElement,
                    borderColor: on || current ? theme.primary : theme.liftEdge,
                    opacity: future ? 0.35 : pressed ? 0.7 : 1,
                  },
                ]}>
                <ThemedText
                  style={[
                    Type.body,
                    on && styles.semi,
                    { color: on ? theme.onPrimary : current ? theme.brandInk : theme.text },
                  ]}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        {multi ? (
          <ThemedText themeColor="textTertiary" style={[Type.micro, styles.hint]}>
            {multi.selected.length === 0
              ? 'Tap months to pick one or more'
              : `${multi.selected.length} month${multi.selected.length === 1 ? '' : 's'} picked`}
          </ThemedText>
        ) : null}
        {onClear || multi ? (
          <View style={styles.actions}>
            {onClear ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: nothingPicked }}
                onPress={onClear}
                style={({ pressed }) => [
                  styles.allMonths,
                  {
                    backgroundColor: nothingPicked ? theme.primarySoft : 'transparent',
                    borderColor: nothingPicked ? theme.primary : theme.liftEdge,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <ThemedText style={[Type.body, styles.semi, { color: theme.brandInk }]}>
                  All months
                </ThemedText>
              </Pressable>
            ) : null}
            {multi ? (
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.allMonths,
                  {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <ThemedText style={[Type.body, styles.semi, { color: theme.onPrimary }]}>
                  Done
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function YearArrow({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.yearArrow,
        {
          backgroundColor: theme.lift,
          borderColor: theme.liftEdge,
          opacity: disabled ? 0.3 : pressed ? 0.7 : 1,
        },
      ]}>
      <Icon name={icon} size={16} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  semi: { fontWeight: '600' },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  popover: {
    position: 'absolute',
    width: 296,
    maxWidth: '92%',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
    ...Elevation.raised,
  },
  yearBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yearArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  yearLabel: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  monthCell: {
    width: '30%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hint: { textAlign: 'center', marginTop: -Spacing.one },
  actions: { flexDirection: 'row', gap: Spacing.two },
  allMonths: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
