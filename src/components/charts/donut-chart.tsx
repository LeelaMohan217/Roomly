import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Slice = { key: string; value: number; color: string };

type Props = {
  data: Slice[];
  size?: number;
  thickness?: number;
  /** Small line above the main figure, e.g. "This month". */
  caption?: string;
  value?: string;
};

/**
 * A ring rather than a pie: the hole carries the total, which is the number
 * people actually want, and thin arcs read as lighter than filled wedges.
 */
export function DonutChart({ data, size = 148, thickness = 14, caption, value }: Props) {
  const theme = useTheme();

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Each arc is offset by the share of everything before it. Written without a
  // mutable counter incremented inside .map(): the React Compiler rejects
  // reassigning a variable across a render, because a partial re-render would
  // resume from a stale value. Filtered once first, so the running total is
  // taken over the arcs actually drawn -- indexing back into `data` would
  // misalign the moment a zero-value slice was dropped. O(n squared) over at
  // most six slices. A 1.5px gap keeps adjacent arcs legible without a stroke.
  // The hole is only (size - 2 * thickness) wide, and a full rupee amount with
  // paise is far longer than the label this started life as. Rather than let it
  // spill over the ring, scale the type to the string: ~0.55 x fontSize is the
  // average glyph width for this face, and 0.88 leaves a breathing margin.
  const inner = size - thickness * 2;
  const valueSize = value
    ? Math.max(11, Math.min(19, Math.floor((inner * 0.88) / (0.55 * value.length))))
    : 19;

  const slices = data.filter((d) => d.value > 0);
  const arcs = slices.map((d, i) => {
    const before = slices.slice(0, i).reduce((sum, s) => sum + s.value, 0);
    const fraction = total > 0 ? d.value / total : 0;
    const length = Math.max(fraction * circumference - 1.5, 0);
    return {
      key: d.key,
      color: d.color,
      dash: `${length} ${circumference - length}`,
      offset: total > 0 ? -(before / total) * circumference : 0,
    };
  });

  return (
    <View style={{ width: size, height: size }}>
      {/* Rotated with a plain React Native transform rather than SVG's <G
          rotation>, which leaks `transform-origin` through as an invalid DOM
          attribute on web. The centre label sits outside this view so it
          stays upright. */}
      <View style={styles.rotated}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.chartTrack}
            strokeWidth={thickness}
            fill="none"
          />
          {arcs.map((a) => (
            <Circle
              key={a.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={a.color}
              strokeWidth={thickness}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              strokeLinecap="butt"
              fill="none"
            />
          ))}
        </Svg>
      </View>

      <View style={styles.center} pointerEvents="none">
        {/* maxWidth is the hole, not the ring: a long category name would
            otherwise render straight over the arcs. */}
        {caption ? (
          <ThemedText
            themeColor="textTertiary"
            style={[Type.micro, { maxWidth: inner }]}
            numberOfLines={1}>
            {caption}
          </ThemedText>
        ) : null}
        {value ? (
          <ThemedText style={[styles.value, { fontSize: valueSize }]} numberOfLines={1}>
            {value}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rotated: { transform: [{ rotate: '-90deg' }] },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // fontSize is supplied inline -- it depends on how long the amount is.
  value: { fontWeight: '700', letterSpacing: -0.5 },
});
