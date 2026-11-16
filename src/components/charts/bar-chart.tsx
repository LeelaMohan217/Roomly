import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Bar = { key: string; label: string; value: number };

type Props = {
  data: Bar[];
  /** The plot's height, bars only; values and month labels add to it. */
  height?: number;
  selectedKey?: string;
  onSelect?: (key: string) => void;
};

/** Room above the tallest bar for its value. */
const VALUE_ROOM = 22;
/** Bars never wider than this, centred in their column. */
const MAX_BAR = 34;

/**
 * ₹38.4k, ₹1.2L -- short enough to sit over a bar. Paise in, rounded; the
 * exact figure is the total above the chart.
 */
export function compactRupees(paise: number): string {
  const r = paise / 100;
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  if (r >= 100000) return `₹${trim(r / 100000)}L`;
  if (r >= 1000) return `₹${trim(r / 1000)}k`;
  return `₹${Math.round(r)}`;
}

/**
 * Columns, one a month, each with its value over it. The chosen month is a
 * solid green gradient; the others are a pale tint of it, so the eye goes to
 * the one being read. A dashed line marks the average of the months that had
 * spending, so "is this a lot?" answers itself. A month with nothing in it
 * shows a dash rather than a stub that reads as a broken bar.
 *
 * The whole column takes the tap -- bar, value and label -- not only the bar.
 */
export function BarChart({ data, height = 168, selectedKey, onSelect }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const max = Math.max(...data.map((d) => d.value), 1);
  const spent = data.filter((d) => d.value > 0);
  const average = spent.length > 0 ? spent.reduce((s, d) => s + d.value, 0) / spent.length : 0;

  const column = data.length > 0 ? width / data.length : 0;
  const barWidth = Math.min(Math.max(column - 14, 6), MAX_BAR);
  const radius = Math.min(barWidth / 2, 10);
  const plot = height - VALUE_ROOM;
  const yOf = (v: number) => VALUE_ROOM + plot - (v / max) * plot;

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {width > 0 ? (
        <View style={{ height }}>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="barSelected" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={theme.primary} stopOpacity={1} />
                <Stop offset="1" stopColor={theme.brandInk} stopOpacity={1} />
              </LinearGradient>
            </Defs>

            {/* Baseline. */}
            <Line
              x1={0}
              x2={width}
              y1={height - 0.5}
              y2={height - 0.5}
              stroke={theme.border}
              strokeWidth={1}
            />

            {data.map((d, i) => {
              const selected = d.key === selectedKey;
              const x = i * column + (column - barWidth) / 2;
              if (d.value <= 0) return null;
              const y = yOf(d.value);
              return (
                <Rect
                  key={d.key}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(height - y, 4)}
                  rx={radius}
                  fill={selected ? 'url(#barSelected)' : theme.chartBarSoft}
                />
              );
            })}

            {/* The average, dashed, over the bars so it reads across them. */}
            {average > 0 ? (
              <Line
                x1={0}
                x2={width}
                y1={yOf(average)}
                y2={yOf(average)}
                stroke={theme.textTertiary}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.7}
              />
            ) : null}
          </Svg>

          {/* Each value over its bar, as text so it takes the app font. */}
          {data.map((d, i) => {
            const selected = d.key === selectedKey;
            const top = d.value > 0 ? yOf(d.value) - VALUE_ROOM + 2 : height - VALUE_ROOM;
            return (
              <View
                key={`v-${d.key}`}
                pointerEvents="none"
                style={[styles.value, { left: i * column, width: column, top }]}>
                {/* On the card's own colour, so the average line passes
                    behind a value rather than through it. */}
                <ThemedText
                  themeColor={selected ? 'text' : 'textTertiary'}
                  style={[
                    Type.micro,
                    styles.valueText,
                    { backgroundColor: theme.lift },
                    selected && styles.selectedText,
                  ]}
                  numberOfLines={1}>
                  {d.value > 0 ? compactRupees(d.value) : '—'}
                </ThemedText>
              </View>
            );
          })}

          {/* The whole column takes the tap. A bare <Svg> takes no touches,
              so these sit over it at the same geometry. */}
          {onSelect
            ? data.map((d, i) => (
                <Pressable
                  key={`hit-${d.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.label}, ${d.value > 0 ? compactRupees(d.value) : 'nothing spent'}. Show this month`}
                  accessibilityState={{ selected: d.key === selectedKey }}
                  onPress={() => onSelect(d.key)}
                  style={[styles.hit, { left: i * column, width: column, height }]}
                />
              ))
            : null}
        </View>
      ) : (
        <View style={{ height }} />
      )}

      <View style={styles.labels}>
        {data.map((d) => {
          const selected = d.key === selectedKey;
          return (
            // The label takes the tap too, for the column it names. On
            // Android a touch outside the plot's own box never reaches the
            // hit areas above, so this is its own target.
            <Pressable
              key={d.key}
              onPress={() => onSelect?.(d.key)}
              disabled={!onSelect}
              accessible={false}
              hitSlop={6}
              style={styles.labelCell}>
              <View style={[styles.labelPill, selected && { backgroundColor: theme.primarySoft }]}>
                <ThemedText
                  style={[
                    Type.micro,
                    { color: selected ? theme.brandInk : theme.textTertiary },
                    selected && styles.selectedText,
                  ]}>
                  {d.label}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  value: { position: 'absolute', alignItems: 'center' },
  valueText: { paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  hit: { position: 'absolute', top: 0 },
  labels: { flexDirection: 'row' },
  labelCell: { flex: 1, alignItems: 'center' },
  labelPill: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999 },
  selectedText: { fontWeight: '600' },
});
