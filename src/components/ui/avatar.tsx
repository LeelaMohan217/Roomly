import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useMemberPhotos } from '@/lib/queries';

/** "Mohan Nethala" -> "MN", "Ravi" -> "RA". Never more than two glyphs. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = {
  name: string;
  /** The member id: their photo, when they have one, replaces the initials. */
  seed?: string;
  size?: number;
  ring?: boolean;
  ringColor?: string;
  /** A person glyph instead of initials — for the header, where the avatar
   *  means "you" rather than identifying one of several people. */
  icon?: boolean;
  /** Pale brand green with green initials -- for a picker where green marks
   *  the choice, like History's "paid by" filter. */
  brand?: boolean;
  style?: ViewStyle;
};

/**
 * A person: their photo, or a plain grey circle with their initials.
 *
 * The photo is looked up here rather than threaded through every call site:
 * useMemberPhotos is one shared cache entry, so every avatar in the app shows
 * a photo the moment its owner adds one.
 *
 * No per-person colour. The six coloured gradients (and the picker that chose
 * between them) put purple and pink into an app whose colours each mean
 * something -- green money in, red owed, yellow warnings, blue information --
 * and a purple circle next to a red amount read as one more signal. The name
 * beside an avatar is what identifies someone.
 */
export function Avatar({
  name,
  seed,
  size = 36,
  ring = false,
  ringColor,
  icon = false,
  brand = false,
  style,
}: Props) {
  const theme = useTheme();
  const fill = brand ? theme.primarySoft : theme.backgroundSelected;
  const ink = brand ? theme.brandInk : theme.textSecondary;
  const fontSize = Math.round(size * 0.38);
  const photos = useMemberPhotos();
  const photo = seed ? photos.data?.[seed]?.url : undefined;

  return (
    <View
      style={[
        ring && {
          padding: 2,
          borderRadius: (size + 4) / 2,
          borderWidth: 1.5,
          borderColor: ringColor ?? theme.border,
        },
        style,
      ]}>
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: fill },
        ]}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            contentFit="cover"
            transition={150}
            accessibilityLabel={`${name}'s photo`}
          />
        ) : icon ? (
          <Ionicons name="person" size={Math.round(size * 0.52)} color={ink} />
        ) : (
          <Text style={[styles.text, { fontSize, color: ink }]} allowFontScaling={false}>
            {initials(name)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '700', letterSpacing: 0.3 },
});
