import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * A bottom sheet for short tasks.
 *
 * Forms that live inline push the thing you came to see off the screen. A
 * sheet keeps the list in view behind it and makes the form feel like an
 * action you started rather than part of the page.
 */
export function Sheet({ visible, title, subtitle, onClose, children }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();

  // Android reports keyboard height above the navigation bar, and the bar sits
  // behind the keyboard, so the sheet has to clear both. An iOS keyboard frame
  // already starts at the physical bottom.
  const lift = keyboard > 0 ? keyboard + (Platform.OS === 'android' ? insets.bottom : 0) : 0;

  // With the keyboard up the safe-area gutter is behind it, so a plain gutter
  // is all that is wanted.
  const gutter = keyboard > 0 ? Spacing.three : Math.max(insets.bottom, Spacing.three);

  // Numeric, not '88%'. A percentage against a parent with no resolved height
  // is exactly what silently evaporated before, and the cap also has to shrink
  // by `lift` so the backdrop above it can never go negative.
  const maxHeight = Math.max(windowHeight * 0.88 - lift, 0);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      // No-ops under SDK 57, which forces both true while edge-to-edge is on,
      // but they state the contract the padding below assumes: this dialog
      // draws underneath the system bars.
      statusBarTranslucent
      navigationBarTranslucent>
      {/* Normal flow, not an absolutely-positioned wrapper. Modal's own
          container is {left:0, top:0, flex:1} -- a definite height -- so a
          flex:1 backdrop plus a content-sized sheet pins the sheet to the
          bottom AND gives maxHeight something to resolve against. An absolute
          wrapper has no height of its own, so the constraint was dropped, the
          ScrollView was never bounded, and the last child (the primary button)
          was drawn under the navigation bar with no way to scroll to it. */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            maxHeight,
            marginBottom: lift,
            paddingBottom: gutter,
          },
        ]}>
        <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText style={Type.title}>{title}</ThemedText>
            {subtitle ? (
              <ThemedText themeColor="textTertiary" style={Type.caption}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={10}
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Ionicons name="close" size={17} color={theme.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  // maxHeight and paddingBottom are applied inline: both depend on the window
  // and the safe area, and a static percentage here is the original bug.
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerText: { flex: 1, gap: 2 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
});
