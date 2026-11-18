import type { ColorSchemeName } from 'react-native';

/**
 * Roomly is light only. The phone's dark mode setting is ignored: every
 * screen is designed for the light palette, and the dark one is no longer
 * maintained (see constants/theme). The root layout also pins the native
 * scheme to light (Appearance.setColorScheme), and app.json's
 * userInterfaceStyle is "light" for the next APK.
 *
 * Kept as a hook so every caller still reads the scheme the same way.
 */
export function useColorScheme(): ColorSchemeName {
  return 'light';
}
