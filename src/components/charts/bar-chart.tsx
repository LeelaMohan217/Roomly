import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Bar = { key: string; label: string; value: number };

type Props = {
  data: Bar[];
  height?: number;
  selectedKey?: string;
  onSelect?: (key: string) => void;
};

/**
 * Rounded columns with the unselected months dimmed. Selection is the only
 * colour in the chart — a bar chart where every bar is the accent colour
 * tells you nothing about where to look.
 */
export function BarChart({ data, height = 108, selectedKey, onSelect }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 10;
  const barWidth = data.length > 0 ? Math.max((width - gap * (data.length - 1)) / data.length, 2) : 0;
  const radius = Math.min(barWidth / 2, 6);

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {width > 0 ? (
        <View style={{ height }}>
          <Svg width={width} height={height}>
            {data.map((d, i) => {
              const selected = d.key === selectedKey;
              // Always show a sliver, so an empty month reads as "nothing here"
              // rather than as a missing bar.
              const barHeight = Math.max((d.value / max) * height, 3);
              return (
                <Rect
                  key={d.key}
                  x={i * (barWidth + gap)}
                  y={height - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={radius}
                  fill={selected ? theme.primary : theme.chartTrack}
                />
              );
            })}
          </Svg>

          {/* The bars themselves are tappable now. They live inside a bare
              <Svg>, which takes no touches, so only the label strip underneath
              responded — and a bar chart is the one control where everybody
              aims at the bar. These sit over the SVG at the same geometry. */}
          {onSelect
            ? data.map((d, i) => (
                <Pressable
                  key={`hit-${d.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.label}, select`}
                  onPress={() => onSelect(d.key)}
                  style={[
                    styles.barHit,
                    { left: i * (barWidth + gap), width: barWidth, height },
                  ]}
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
            <Pressable
              key={d.key}
              onPress={() => onSelect?.(d.key)}
              disabled={!onSelect}
              style={styles.labelCell}
              hitSlop={6}>
              <ThemedText
                themeColor={selected ? 'text' : 'textTertiary'}
                style={[Type.micro, selected && styles.selectedLabel]}>
                {d.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  barHit: { position: 'absolute', top: 0 },
  labels: { flexDirection: 'row', gap: 10 },
  labelCell: { flex: 1, alignItems: 'center' },
  selectedLabel: { fontWeight: '700' },
});
