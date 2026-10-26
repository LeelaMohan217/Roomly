import Ionicons from '@expo/vector-icons/Ionicons';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Elevation, Radius, Spacing, Type, type Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { committed, rejected, tapped } from '@/lib/haptics';

/**
 * Every popup in the app: confirmations, error and info messages, and the
 * short "done" toast.
 *
 * This replaces React Native's Alert.alert. That one draws the platform's
 * plain system box -- no colour, no icon, a different look on every phone --
 * and on web it does nothing at all, so a Delete button there silently never
 * asked and never deleted. One designed dialog means the colour of a popup
 * tells you what kind of moment it is before you read a word of it.
 */

export type Tone = 'danger' | 'warning' | 'success' | 'info';

type Palette = (typeof Colors)['light'] | (typeof Colors)['dark'];

/** The three colours a tone paints with: its ink, its wash, and text on a fill. */
export function toneColors(theme: Palette, tone: Tone) {
  switch (tone) {
    case 'danger':
      return { fg: theme.danger, soft: theme.dangerSoft, on: theme.onDanger };
    case 'warning':
      return { fg: theme.warning, soft: theme.warningSoft, on: theme.onWarning };
    case 'success':
      return { fg: theme.success, soft: theme.successSoft, on: theme.onSuccess };
    default:
      return { fg: theme.info, soft: theme.infoSoft, on: theme.onInfo };
  }
}

const DEFAULT_ICON: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  danger: 'alert-circle-outline',
  warning: 'warning-outline',
  success: 'checkmark-circle-outline',
  info: 'information-circle-outline',
};

type ConfirmOptions = {
  title: string;
  message?: string;
  /** Verb first: "Delete", "Close month" -- never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
};

type AlertOptions = {
  title: string;
  message?: string;
  buttonLabel?: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
};

type ToastOptions = {
  message: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
};

type Request =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'alert'; options: AlertOptions; resolve: (ok: boolean) => void };

type DialogApi = {
  /** Resolves true only if the person pressed the confirm button. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** A message with one button. Resolves when it is dismissed. */
  alert: (options: AlertOptions) => Promise<void>;
  /** A brief note at the top that leaves by itself -- for "done", not for questions. */
  toast: (options: ToastOptions) => void;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be used inside <DialogProvider>');
  return value;
}

const TOAST_MS = 2800;

export function DialogProvider({ children }: { children: ReactNode }) {
  // A queue, not a single slot: two things can ask at once (a failed save
  // while a confirmation is up), and the second must wait, not replace.
  const [queue, setQueue] = useState<Request[]>([]);
  const [toastState, setToastState] = useState<(ToastOptions & { id: number }) | null>(null);
  const seq = useRef(0);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setQueue((q) => [...q, { id: ++seq.current, kind: 'confirm', options, resolve }]);
      }),
    []
  );

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        setQueue((q) => [
          ...q,
          { id: ++seq.current, kind: 'alert', options, resolve: () => resolve() },
        ]);
      }),
    []
  );

  const toast = useCallback((options: ToastOptions) => {
    if ((options.tone ?? 'success') === 'success') committed();
    setToastState({ ...options, id: ++seq.current });
  }, []);

  useEffect(() => {
    if (!toastState) return;
    const timer = setTimeout(() => setToastState(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toastState]);

  const current = queue[0];

  const close = (ok: boolean) => {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  const api = useMemo(() => ({ confirm, alert, toast }), [confirm, alert, toast]);

  return (
    <DialogContext.Provider value={api}>
      <View style={styles.root}>
        {children}
        {toastState ? (
          <Toast key={toastState.id} {...toastState} onDismiss={() => setToastState(null)} />
        ) : null}
      </View>
      <Modal
        visible={!!current}
        transparent
        animationType="fade"
        onRequestClose={() => close(false)}
        statusBarTranslucent
        navigationBarTranslucent>
        {current ? <DialogCard key={current.id} request={current} onClose={close} /> : null}
      </Modal>
    </DialogContext.Provider>
  );
}

function DialogCard({ request, onClose }: { request: Request; onClose: (ok: boolean) => void }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { options, kind } = request;
  const tone = options.tone ?? 'info';
  const colors = toneColors(theme, tone);
  const icon = options.icon ?? DEFAULT_ICON[tone];

  const confirmLabel = kind === 'confirm' ? request.options.confirmLabel : (request.options.buttonLabel ?? 'OK');
  const cancelLabel = kind === 'confirm' ? (request.options.cancelLabel ?? 'Cancel') : null;
  // Side by side while both labels are short; stacked once either would have
  // to be cut off, with the main action on top where the thumb lands.
  const stacked = !!cancelLabel && Math.max(confirmLabel.length, cancelLabel.length) > 13;

  const confirmButton = (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (tone === 'danger') rejected();
        else tapped();
        onClose(true);
      }}
      style={({ pressed }) => [
        styles.button,
        !stacked && styles.flex,
        { backgroundColor: colors.fg, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}>
      <ThemedText style={[styles.buttonText, { color: colors.on }]} numberOfLines={1}>
        {confirmLabel}
      </ThemedText>
    </Pressable>
  );

  const cancelButton = cancelLabel ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => onClose(false)}
      style={({ pressed }) => [
        styles.button,
        !stacked && styles.flex,
        { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.8 : 1 },
      ]}>
      <ThemedText style={[styles.buttonText, { color: theme.text }]} numberOfLines={1}>
        {cancelLabel}
      </ThemedText>
    </Pressable>
  ) : null;

  return (
    <View style={styles.overlay}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={() => onClose(false)}
        accessibilityLabel="Dismiss"
      />
      <Animated.View
        entering={ZoomIn.duration(170)}
        accessibilityViewIsModal
        accessibilityRole="alert"
        style={[
          styles.card,
          Elevation.raised,
          {
            width: Math.min(width - Spacing.four * 2, 380),
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}>
        <View style={[styles.iconRing, { backgroundColor: colors.soft }]}>
          <Ionicons name={icon} size={28} color={colors.fg} />
        </View>

        <View style={styles.text}>
          <ThemedText style={[Type.title, styles.centered]}>{options.title}</ThemedText>
          {options.message ? (
            <ThemedText themeColor="textSecondary" style={[Type.body, styles.centered]}>
              {options.message}
            </ThemedText>
          ) : null}
        </View>

        <View style={stacked ? styles.buttonsStacked : styles.buttonsRow}>
          {stacked ? (
            <>
              {confirmButton}
              {cancelButton}
            </>
          ) : (
            <>
              {cancelButton}
              {confirmButton}
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

function Toast({
  message,
  tone = 'success',
  icon,
  onDismiss,
}: ToastOptions & { onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const colors = toneColors(theme, tone);

  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      pointerEvents="box-none"
      style={[styles.toastWrap, { top: insets.top + Spacing.two }]}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onPress={onDismiss}
        style={[
          styles.toast,
          Elevation.raised,
          { backgroundColor: theme.backgroundElement, borderColor: colors.fg },
        ]}>
        <View style={[styles.toastIcon, { backgroundColor: colors.soft }]}>
          <Ionicons name={icon ?? DEFAULT_ICON[tone]} size={18} color={colors.fg} />
        </View>
        <ThemedText style={[Type.caption, styles.toastText]} numberOfLines={3}>
          {message}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  card: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.four + Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { gap: Spacing.two, alignSelf: 'stretch' },
  buttonsRow: { flexDirection: 'row', gap: Spacing.two, alignSelf: 'stretch', marginTop: Spacing.two },
  buttonsStacked: { gap: Spacing.two, alignSelf: 'stretch', marginTop: Spacing.two },
  button: {
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  buttonText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },

  toastWrap: { position: 'absolute', left: Spacing.three, right: Spacing.three, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    maxWidth: 420,
    paddingVertical: Spacing.two + 2,
    paddingLeft: Spacing.two + 2,
    paddingRight: Spacing.four,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  toastIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  toastText: { flexShrink: 1, fontWeight: '600' },
});
