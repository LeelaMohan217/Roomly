import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysInMonth, firstWeekdayOfMonth, isoOf, todayIso } from '@/lib/dates';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Props = {
  year: number;
  month: number; // 1-12
  onMonthChange: (year: number, month: number) => void;
  start: string | null;
  end: string | null;
  onDayPress: (iso: string) => void;
  /** iso date → dot colours, one per member already away that day */
  marks?: Record<string, string[]>;
};

export function MonthCalendar({
  year,
  month,
  onMonthChange,
  start,
  end,
  onDayPress,
  marks = {},
}: Props) {
  const theme = useTheme();

  const firstWeekday = firstWeekdayOfMonth(year, month);
  const dayCount = daysInMonth(year, month);
  const today = todayIso();

  // The selected-day circle is sized in PIXELS from the measured grid, not with
  // width:'76%' + aspectRatio:1 + borderRadius:999.
  //
  // That old stack made three separate assumptions -- that a percentage width
  // resolves against a parent whose own height comes from aspectRatio, that
  // Yoga then derives the height from it, and that a 999 radius gets clamped to
  // half the box. Android's Yoga and web CSS aspect-ratio do not have to agree
  // on any of the three, and the days rendered as squares on device. Explicit
  // width, height and radius = diameter / 2 cannot be interpreted two ways.
  const [gridWidth, setGridWidth] = useState(0);
  const cellWidth = gridWidth > 0 ? gridWidth / 7 : 0;

  // 34 is only ever used for the single frame before onLayout reports back, and
  // it is close to the real value at every phone width (a ~330dp grid gives
  // 47dp cells, so 35dp), which is why there is no visible pop.
  const diameter = cellWidth > 0 ? Math.round(cellWidth * 0.74) : 34;
  const circle = { width: diameter, height: diameter, borderRadius: diameter / 2 };

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dayCount }, (_, i) => i + 1),
  ];

  function step(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    onMonthChange(d.getFullYear(), d.getMonth() + 1);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <NavButton icon="chevron-back" onPress={() => step(-1)} label="Previous month" />
        <ThemedText style={Type.headline}>
          {MONTHS[month - 1]} {year}
        </ThemedText>
        <NavButton icon="chevron-forward" onPress={() => step(1)} label="Next month" />
      </View>

      <View
        style={styles.grid}
        onLayout={(e: LayoutChangeEvent) => {
          const w = e.nativeEvent.layout.width;
          // Only on real change: onLayout fires on every re-render on some
          // platforms, and setting state unconditionally would loop.
          if (Math.abs(w - gridWidth) > 0.5) setGridWidth(w);
        }}>
        {WEEKDAYS.map((w, i) => (
          <View key={`${w}-${i}`} style={styles.cell}>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              {w}
            </ThemedText>
          </View>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <View key={`blank-${i}`} style={styles.cell} />;

          const iso = isoOf(year, month, day);
          const inRange = !!start && !!end && iso >= start && iso <= end;
          const isEdge = iso === start || iso === end;
          const dots = marks[iso] ?? [];

          return (
            <Pressable
              key={iso}
              onPress={() => onDayPress(iso)}
              style={styles.cell}>
              {/* The highlight lives on an inner circle, not on the cell.
                  Filling the whole cell made two adjacent selected days merge
                  into a single squashed rounded rectangle with no gap between
                  them -- the cell has to stay full width for the touch
                  target, so the shape has to be inset instead. */}
              <View
                style={[
                  styles.dayInner,
                  circle,
                  inRange && !isEdge && { backgroundColor: theme.primarySoft },
                  isEdge && { backgroundColor: theme.primary },
                ]}>
                <ThemedText
                  style={[
                    Type.caption,
                    {
                      color: isEdge ? theme.onPrimary : inRange ? theme.primary : theme.text,
                      fontWeight: iso === today ? '700' : '500',
                    },
                  ]}>
                  {day}
                </ThemedText>
              </View>
              {iso === today && !isEdge ? (
                <View style={[styles.todayDot, { backgroundColor: theme.primary }]} />
              ) : null}

              <View style={styles.dots}>
                {dots.slice(0, 3).map((color, k) => (
                  <View key={k} style={[styles.dot, { backgroundColor: color }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function NavButton({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.navButton,
        { backgroundColor: theme.backgroundSunken, opacity: pressed ? 0.6 : 1 },
      ]}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  navButton: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Width, height and radius all arrive from the component as measured
  // pixels -- see the comment there. 74% of the cell leaves a 26% gap, so
  // two adjacent selected days never touch.
  dayInner: { alignItems: 'center', justifyContent: 'center' },
  todayDot: { position: 'absolute', bottom: 5, width: 3, height: 3, borderRadius: 2 },
  dots: { flexDirection: 'row', gap: 2, height: 4, marginTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
