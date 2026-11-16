import { PlusJakartaSans_300Light } from '@expo-google-fonts/plus-jakarta-sans/300Light';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import type { TextStyle } from 'react-native';

/**
 * The app's typeface: Plus Jakarta Sans, a rounded geometric sans, after the
 * premium redesign mockup. Loaded at start-up by the root layout; the files
 * travel inside the JS bundle, so an OTA update carries them -- no new APK.
 *
 * Android picks a custom font by family name, not by fontWeight: each weight
 * is its own file and its own family. So a style's fontWeight is turned into
 * the matching family here, and the weight itself dropped (left in, Android
 * would fake-bold the face or fall back to Roboto).
 */
export const AppFonts = {
  PlusJakartaSans_300Light,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
};

const FAMILY_BY_WEIGHT: Record<string, keyof typeof AppFonts> = {
  '100': 'PlusJakartaSans_300Light',
  '200': 'PlusJakartaSans_300Light',
  '300': 'PlusJakartaSans_300Light',
  '400': 'PlusJakartaSans_400Regular',
  normal: 'PlusJakartaSans_400Regular',
  '500': 'PlusJakartaSans_500Medium',
  '600': 'PlusJakartaSans_600SemiBold',
  '700': 'PlusJakartaSans_700Bold',
  bold: 'PlusJakartaSans_700Bold',
  '800': 'PlusJakartaSans_700Bold',
  '900': 'PlusJakartaSans_700Bold',
};

/**
 * The family for a flattened text style, or null when the style already
 * names its own family (the monospace code style) and should be left alone.
 */
export function appFontFor(style: TextStyle): TextStyle | null {
  if (style.fontFamily) return null;
  const weight = String(style.fontWeight ?? '400');
  return {
    fontFamily: FAMILY_BY_WEIGHT[weight] ?? 'PlusJakartaSans_400Regular',
    fontWeight: 'normal',
  };
}
