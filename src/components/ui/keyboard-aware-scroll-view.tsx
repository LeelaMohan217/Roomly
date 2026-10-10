import { Platform, ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

/**
 * A form that stays reachable when the keyboard is up.
 *
 * Every form in this app used to wrap itself in
 *
 *   <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
 *
 * which does nothing at all on Android — and `use-keyboard-height.ts:7-15`
 * has said so, in writing, the whole time:
 *
 *   "Under the edge-to-edge layout that Expo SDK 57 always applies, the OS
 *    never resizes the window for the keyboard, so that number does not move
 *    and KeyboardAvoidingView is inert -- with any `behavior`, which is why
 *    swapping the behavior was never the fix."
 *
 * Ten screens relied on it anyway. The worst was Add Expense, which autofocuses
 * the amount field: the keyboard is up before the first frame, so Save was
 * behind it from the moment the screen opened, on the app's single most-used
 * action. `keyboardDismissMode="interactive"` is iOS-only, so there wasn't even
 * a swipe-to-dismiss escape.
 *
 * The fix is the one Sheet already uses: measure the keyboard with
 * useKeyboardHeight() — which reads `endCoordinates.height`, computed natively
 * from the ime() inset and so still correct under edge-to-edge — and pad the
 * scroll content by that much. The content becomes taller than the viewport by
 * exactly the height of the keyboard, so everything below the fold can be
 * scrolled to instead of being trapped underneath it.
 */
export function KeyboardAwareScrollView({
  contentContainerStyle,
  style,
  children,
  ...rest
}: ScrollViewProps) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  // Android reports the keyboard height above the navigation bar, and the bar
  // sits behind the keyboard, so the content has to clear both. An iOS
  // keyboard frame already starts at the physical bottom. Same reasoning as
  // sheet.tsx:31-33 — kept in step with it deliberately.
  const lift = keyboard > 0 ? keyboard + (Platform.OS === 'android' ? insets.bottom : 0) : 0;

  return (
    <ScrollView
      style={[styles.flex, style]}
      contentContainerStyle={[
        contentContainerStyle,
        // Only while the keyboard is up. A permanent gutter would leave a hole
        // under every form.
        lift > 0 && { paddingBottom: lift + Spacing.four },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      {...rest}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
