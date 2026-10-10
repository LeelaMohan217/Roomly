import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { avatarPairFor } from '@/constants/theme';
import { useMembers } from '@/lib/queries';

/** "Mohan Nethala" -> "MN", "Ravi" -> "RA". Never more than two glyphs. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = {
  name: string;
  /** Stable colour source — the member id, so it never changes on rename. */
  seed?: string;
  size?: number;
  ring?: boolean;
  ringColor?: string;
  /** A person glyph instead of initials — for the header, where the avatar
   *  means "you" rather than identifying one of several people. */
  icon?: boolean;
  /** Overrides the stored colour — for previewing a pick before it is saved. */
  color?: string | null;
  style?: ViewStyle;
};

export function Avatar({
  name,
  seed,
  size = 36,
  ring = false,
  ringColor,
  icon = false,
  color,
  style,
}: Props) {
  // Resolved here rather than threaded through eighteen call sites: useMembers
  // is one shared cache entry, so every avatar in the app honours a colour the
  // moment its owner picks one, and anyone who has left falls back to the
  // deterministic colour derived from their id.
  const members = useMembers();
  const stored = seed ? members.data?.find((m) => m.id === seed)?.avatarColor : undefined;

  const [from, to] = avatarPairFor(color ?? stored, seed ?? name);
  const fontSize = Math.round(size * 0.38);

  return (
    <View
      style={[
        ring && {
          padding: 2,
          borderRadius: (size + 4) / 2,
          borderWidth: 1.5,
          borderColor: ringColor ?? from,
        },
        style,
      ]}>
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
        {icon ? (
          <Ionicons name="person" size={Math.round(size * 0.52)} color="#FFFFFF" />
        ) : (
          <Text style={[styles.text, { fontSize }]} allowFontScaling={false}>
            {initials(name)}
          </Text>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.3 },
});
