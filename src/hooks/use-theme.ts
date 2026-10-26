/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  // Anything but an explicit "dark" -- unspecified, or null on some
  // platforms -- is light.
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
