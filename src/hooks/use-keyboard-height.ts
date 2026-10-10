import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard in dp, excluding the Android navigation bar.
 *
 * Deliberately not KeyboardAvoidingView. That component positions itself from
 * `endCoordinates.screenY`, which on Android is the window's visible display
 * frame. Under the edge-to-edge layout that Expo SDK 57 always applies, the OS
 * never resizes the window for the keyboard, so that number does not move and
 * KeyboardAvoidingView is inert -- with any `behavior`, which is why swapping
 * the behavior was never the fix.
 *
 * `endCoordinates.height` is computed natively from the ime() inset minus the
 * navigation bar inset, so it stays correct under edge-to-edge.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS gets the will* pair so the sheet travels with the keyboard rather
    // than snapping after it. Android only ever fires the did* pair.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
