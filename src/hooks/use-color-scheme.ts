import { useSyncExternalStore } from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';

/**
 * The system colour scheme, read through one stable subscription.
 *
 * Not react-native's own useColorScheme: react-native-web's version re-adds
 * its media-query listener in an effect on every render. When the theme
 * flips, the first components to re-render swap their listeners out mid-
 * dispatch and the browser skips the new ones, so half the screen stayed in
 * the old theme -- a dark page with light cards and dark text on it.
 * useSyncExternalStore with a module-level subscribe never churns, so every
 * component sees the same scheme at the same time, on web and native alike.
 */
function subscribe(onChange: () => void) {
  const sub = Appearance.addChangeListener(onChange);
  return () => sub.remove();
}

function getScheme(): ColorSchemeName {
  // Typed as possibly null or undefined; both mean "no preference".
  return Appearance.getColorScheme() ?? 'unspecified';
}

export function useColorScheme(): ColorSchemeName {
  return useSyncExternalStore(subscribe, getScheme, getScheme);
}
