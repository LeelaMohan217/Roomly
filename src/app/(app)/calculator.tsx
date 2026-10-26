import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { evaluate, isOp, toAmountString, type Op, type Token } from '@/lib/calc';
import { tapped } from '@/lib/haptics';

/**
 * Grouped, and capped at four decimals.
 *
 * The cap is not cosmetic: binary floats make 0.1 + 0.2 into
 * 0.30000000000000004, and a calculator that shows that is a calculator nobody
 * trusts. Rounding at the formatter leaves the arithmetic itself untouched.
 */
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 });

export default function CalculatorScreen() {
  const theme = useTheme();
  const router = useRouter();

  // Two pieces of state, not one expression string: `entry` is the number
  // being typed right now, `tokens` is everything already committed. Keeping
  // them apart is what makes backspace and operator-replacement simple.
  const [tokens, setTokens] = useState<Token[]>([]);
  const [entry, setEntry] = useState('');

  const live: Token[] = entry === '' ? tokens : [...tokens, Number(entry)];
  const result = evaluate(live);

  const expression =
    tokens.map((t) => (isOp(t) ? t : nf.format(t))).join(' ') + (entry ? ` ${entry}` : '');

  function digit(d: string) {
    // A lone leading zero would let you type 0007.
    setEntry((e) => (e === '0' ? d : e + d));
  }

  function dot() {
    setEntry((e) => (e.includes('.') ? e : e === '' ? '0.' : `${e}.`));
  }

  function operator(op: Op) {
    if (entry !== '') {
      setTokens((t) => [...t, Number(entry), op]);
      setEntry('');
      return;
    }
    setTokens((t) => {
      if (t.length === 0) return t;
      // Two operators in a row means they changed their mind, not that they
      // want both.
      return isOp(t[t.length - 1]) ? [...t.slice(0, -1), op] : [...t, op];
    });
  }

  function equals() {
    if (result === null) return;
    setTokens([]);
    setEntry(String(result));
  }

  function clear() {
    setTokens([]);
    setEntry('');
  }

  function back() {
    if (entry !== '') {
      setEntry((e) => e.slice(0, -1));
      return;
    }
    setTokens((t) => t.slice(0, -1));
  }

  function percent() {
    if (entry === '') return;
    setEntry(String(Number(entry) / 100));
  }

  const amount = toAmountString(result);
  function useInExpense() {
    if (!amount) return;
    router.push({ pathname: '/add-expense', params: { amount } });
  }

  return (
    // edges: the tab bar already sits in the bottom inset, so letting
    // SafeAreaView pad for it again would float the keypad off the bar.
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Calculator" showBack={false} />

      <View style={styles.body}>
        {/* The answer is the big number, always -- even mid-expression. The
            line you are typing is the quiet one above it. */}
        <Card style={styles.display}>
          <ThemedText
            themeColor="textTertiary"
            style={[Type.caption, styles.expression]}
            numberOfLines={1}>
            {expression || ' '}
          </ThemedText>
          <ThemedText style={[styles.result, { color: theme.text }]} numberOfLines={1}>
            {result === null ? '0' : nf.format(result)}
          </ThemedText>
        </Card>

        <Pressable
          accessibilityRole="button"
          disabled={!amount}
          onPress={useInExpense}
          style={({ pressed }) => [
            styles.handoff,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: amount ? (pressed ? 0.7 : 1) : 0.4,
            },
          ]}>
          <Ionicons name="add-circle-outline" size={16} color={theme.primary} />
          <ThemedText style={[Type.body, styles.handoffLabel, { color: theme.primary }]}>
            Use in an expense
          </ThemedText>
        </Pressable>

        <View style={styles.pad}>
          <View style={styles.row}>
            <Key label="AC" tone="danger" onPress={clear} />
            <Key label="⌫" tone="muted" onPress={back} a11y="Backspace" />
            <Key label="%" tone="muted" onPress={percent} a11y="Percent" />
            <Key label="÷" tone="op" onPress={() => operator('÷')} a11y="Divide" />
          </View>
          <View style={styles.row}>
            <Key label="7" onPress={() => digit('7')} />
            <Key label="8" onPress={() => digit('8')} />
            <Key label="9" onPress={() => digit('9')} />
            <Key label="×" tone="op" onPress={() => operator('×')} a11y="Multiply" />
          </View>
          <View style={styles.row}>
            <Key label="4" onPress={() => digit('4')} />
            <Key label="5" onPress={() => digit('5')} />
            <Key label="6" onPress={() => digit('6')} />
            <Key label="−" tone="op" onPress={() => operator('-')} a11y="Minus" />
          </View>
          <View style={styles.row}>
            <Key label="1" onPress={() => digit('1')} />
            <Key label="2" onPress={() => digit('2')} />
            <Key label="3" onPress={() => digit('3')} />
            <Key label="+" tone="op" onPress={() => operator('+')} a11y="Plus" />
          </View>
          <View style={styles.row}>
            <Key label="00" onPress={() => digit('00')} />
            <Key label="0" onPress={() => digit('0')} />
            <Key label="." onPress={dot} a11y="Decimal point" />
            <Key label="=" tone="equals" onPress={equals} a11y="Equals" />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

type Tone = 'digit' | 'op' | 'equals' | 'danger' | 'muted';

function Key({
  label,
  tone = 'digit',
  onPress,
  a11y,
}: {
  label: string;
  tone?: Tone;
  onPress: () => void;
  a11y?: string;
}) {
  const theme = useTheme();

  // Every colour comes from the existing palette -- no new tokens, so the pad
  // follows light and dark mode without a second definition.
  const background =
    tone === 'equals'
      ? theme.primary
      : tone === 'op'
        ? theme.primarySoft
        : tone === 'danger'
          ? theme.dangerSoft
          : tone === 'muted'
            ? theme.backgroundSelected
            : theme.backgroundElement;

  const color =
    tone === 'equals'
      ? theme.onPrimary
      : tone === 'op'
        ? theme.primary
        : tone === 'danger'
          ? theme.danger
          : tone === 'muted'
            ? theme.textSecondary
            : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      onPress={() => {
        tapped();
        onPress();
      }}
      style={({ pressed }) => [
        styles.key,
        {
          backgroundColor: background,
          borderColor: tone === 'digit' ? theme.border : 'transparent',
          opacity: pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}>
      <ThemedText style={[styles.keyLabel, { color }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  // The pad is pinned to the bottom where thumbs are, and the display takes
  // whatever is left rather than being a fixed block.
  body: { flex: 1, paddingHorizontal: Spacing.four, paddingBottom: Spacing.four, gap: Spacing.three },

  display: { flex: 1, justifyContent: 'flex-end', gap: Spacing.one },
  expression: { textAlign: 'right' },
  result: { fontSize: 40, lineHeight: 48, fontWeight: '700', letterSpacing: -1.2, textAlign: 'right' },

  handoff: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
  },
  handoffLabel: { fontWeight: '700' },

  pad: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  key: {
    flex: 1,
    height: 58,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: { fontSize: 21, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
});
