import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  size?: number;
  /** Mark only, for tight spaces like a splash or an avatar-sized slot. */
  markOnly?: boolean;
};

export function Logo({ size = 30, markOnly = false }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <LinearGradient
        colors={[theme.primary, theme.heroFrom]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.mark, { width: size, height: size, borderRadius: size * 0.3 }]}>
        <Ionicons name="home" size={size * 0.5} color={theme.onPrimary} />
      </LinearGradient>

      {markOnly ? null : (
        <Text style={[styles.word, { color: theme.text, fontSize: size * 0.62 }]}>roomly</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mark: { alignItems: 'center', justifyContent: 'center' },
  word: { fontWeight: '700', letterSpacing: -0.6 },
});
