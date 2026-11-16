import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { formatPaise } from '@/lib/money';

/**
 * An amount with its paise set small and raised, so the rupees read first:
 * ₹2,340 then a small .50. The figure is exactly formatPaise's -- only split
 * where it is drawn -- and is read out whole.
 */
export function Money({
  paise,
  signed = false,
  size,
  color,
  extra,
  accessibilityLabel,
}: {
  paise: number;
  /** "+ " or "− " in front, by direction. */
  signed?: boolean;
  size: keyof typeof SIZES;
  color?: string;
  /** Any further text style -- the approval states' grey or strike. */
  extra?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const sign = !signed ? '' : paise > 0 ? '+ ' : paise < 0 ? '− ' : '';
  const text = formatPaise(signed ? Math.abs(paise) : paise);
  const dot = text.lastIndexOf('.');
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? '' : text.slice(dot);
  const s = SIZES[size];
  const tint = color ? { color } : null;

  return (
    <View
      style={styles.money}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${sign}${text}`}>
      <ThemedText
        style={[s.whole, styles.shrink, tint, extra]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}>
        {`${sign}${whole}`}
      </ThemedText>
      {fraction ? <ThemedText style={[s.fraction, tint, extra]}>{fraction}</ThemedText> : null}
    </View>
  );
}

const SIZES = {
  hero: StyleSheet.create({
    whole: { fontSize: 42, lineHeight: 50, fontWeight: '600', letterSpacing: -1.6 },
    fraction: { fontSize: 21, lineHeight: 27, fontWeight: '600', marginTop: 6, marginLeft: 1 },
  }),
  month: StyleSheet.create({
    whole: { fontSize: 22, lineHeight: 29, fontWeight: '600', letterSpacing: -0.6 },
    fraction: { fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 3, marginLeft: 1 },
  }),
  card: StyleSheet.create({
    whole: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.3 },
    fraction: { fontSize: 9.5, lineHeight: 13, fontWeight: '600', marginTop: 2, marginLeft: 1 },
  }),
  row: StyleSheet.create({
    whole: { fontSize: 15.5, lineHeight: 21, fontWeight: '600', letterSpacing: -0.3 },
    fraction: { fontSize: 9.5, lineHeight: 13, fontWeight: '600', marginTop: 2, marginLeft: 1 },
  }),
};

const styles = StyleSheet.create({
  money: { flexDirection: 'row', alignItems: 'flex-start' },
  shrink: { flexShrink: 1 },
});
