import { StatusBar } from 'expo-status-bar';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

/**
 * The brand screen shown while the app works out whether you are signed in:
 * solid green with the white wordmark in the middle, then sign in or home.
 *
 * It is drawn to match the native splash in app.json exactly -- the same
 * colour, the same image at the same size -- so when the native splash is
 * hidden underneath it, nothing visibly changes. The colour is fixed rather
 * than taken from the theme: the native splash cannot follow light or dark,
 * and this screen must match it, not the app.
 */
export const BRAND_GREEN = '#0E9A6C';

/** Must equal expo-splash-screen's imageWidth in app.json. */
const WORDMARK_SIZE = 220;

export function BrandSplash({ onLayout }: { onLayout?: (e: LayoutChangeEvent) => void }) {
  return (
    <View style={styles.screen} onLayout={onLayout}>
      <StatusBar style="light" />
      <Image
        source={require('@/assets/images/splash-wordmark.png')}
        style={styles.wordmark}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Roomly"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BRAND_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { width: WORDMARK_SIZE, height: WORDMARK_SIZE },
});
