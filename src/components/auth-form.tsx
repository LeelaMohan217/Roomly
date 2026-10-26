import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isProperEmail, isValidEmail } from '@/lib/email';

/**
 * The building blocks of the sign-in and create-account screens, in the
 * calmer style being agreed there first: regular and medium weights only,
 * labels in plain sentence case, soft filled fields with an icon, and one
 * green button. Once the look is settled these move to components/ui and the
 * rest of the app.
 */

type IconName = keyof typeof Ionicons.glyphMap;

/** The icon in a soft circle, a title, and one plain sentence under it. */
export function AuthHeader({
  icon,
  title,
  subtitle,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <View style={[styles.mark, { backgroundColor: theme.primarySoft }]}>
        <View style={[styles.markInner, { backgroundColor: theme.primary }]}>
          <Ionicons name={icon} size={22} color={theme.onPrimary} />
        </View>
      </View>
      <ThemedText style={styles.title}>{title}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.subtitle}>
        {subtitle}
      </ThemedText>
    </View>
  );
}

/**
 * The field's own green border is the focus ring. Browsers draw a second,
 * orange one inside it, and only `outline-style: none` removes it -- a value
 * React Native's types do not list, so it is applied on web alone.
 */
const NO_WEB_OUTLINE =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

export function AuthField({
  label,
  icon,
  secure = false,
  prefix,
  hint,
  hintTone = 'neutral',
  hintAction,
  inputStyle,
  ...rest
}: Omit<TextInputProps, 'style'> & {
  /** Extra text styling for the input itself, like the spaced invite code. */
  inputStyle?: TextStyle;
  label: string;
  icon: IconName;
  secure?: boolean;
  /** Fixed text before the input, like a country code. */
  prefix?: string;
  /** One short line under the field. */
  hint?: string;
  /** Red when the input is wrong, amber when it is probably a typo, green
   *  once a rule is met. */
  hintTone?: 'neutral' | 'danger' | 'warning' | 'success';
  /** A tappable fix after the hint, like "Use leelamohan@gmail.com". */
  hintAction?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const invalid = hintTone === 'danger';
  const cautious = hintTone === 'warning';
  const hintColor =
    hintTone === 'danger'
      ? theme.danger
      : hintTone === 'warning'
        ? theme.warning
        : hintTone === 'success'
          ? theme.success
          : theme.textTertiary;

  return (
    <View style={styles.fieldWrap}>
      <ThemedText themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>
      <View
        style={[
          styles.field,
          {
            // Filled at rest, outlined in neutral grey while typing. Never
            // green: green means "correct" everywhere else in the app, and a
            // green ring around an email that has not been checked read as
            // "this email is right". Red (wrong) and amber (careful) are the
            // only colours a field takes, and they always agree with the
            // message under it.
            backgroundColor:
              focused || invalid || cautious ? theme.backgroundElement : theme.backgroundSelected,
            borderColor: invalid
              ? theme.danger
              : cautious
                ? theme.warning
                : focused
                  ? theme.textSecondary
                  : 'transparent',
          },
        ]}>
        <Ionicons
          name={icon}
          size={18}
          color={
            invalid
              ? theme.danger
              : cautious
                ? theme.warning
                : focused
                  ? theme.text
                  : theme.textTertiary
          }
        />
        {prefix ? (
          <View style={[styles.prefix, { borderRightColor: theme.borderStrong }]}>
            <ThemedText themeColor="textSecondary" style={styles.prefixText}>
              {prefix}
            </ThemedText>
          </View>
        ) : null}
        <TextInput
          style={[styles.input, NO_WEB_OUTLINE, { color: theme.text }, inputStyle]}
          placeholderTextColor={theme.textTertiary}
          secureTextEntry={secure && !revealed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          {...rest}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={12}
            onPress={() => setRevealed((v) => !v)}>
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={19}
              color={theme.textTertiary}
            />
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <View style={styles.hintRow}>
          {hintTone !== 'neutral' ? (
            <Ionicons
              name={
                hintTone === 'success'
                  ? 'checkmark-circle'
                  : hintTone === 'warning'
                    ? 'help-circle'
                    : 'alert-circle'
              }
              size={13}
              color={hintColor}
            />
          ) : null}
          <ThemedText style={[styles.hint, styles.hintText, { color: hintColor }]}>
            {hint}
            {hintAction ? (
              <>
                {' '}
                <ThemedText
                  accessibilityRole="button"
                  onPress={hintAction.onPress}
                  style={[styles.hint, styles.hintLink, { color: hintColor }]}>
                  {hintAction.label}
                </ThemedText>
              </>
            ) : null}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

export function AuthButton({
  title,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
  icon,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Green and filled for the one main action; soft grey for anything else. */
  variant?: 'primary' | 'secondary';
  icon?: IconName;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const fg = primary ? theme.onPrimary : theme.text;
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? theme.primary : theme.backgroundSelected,
          opacity: disabled && !busy ? 0.4 : pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={primary ? fg : theme.success} /> : null}
          <ThemedText style={[styles.buttonText, { color: fg }]}>{title}</ThemedText>
        </>
      )}
    </Pressable>
  );
}

/**
 * A full-screen outcome: an icon in a soft ring, a title, one or two plain
 * sentences, the actions, and a small tip underneath. Green when something
 * worked ("check your email", "password changed"), red when it did not.
 */
export function AuthResult({
  icon,
  title,
  children,
  actions,
  help,
  tone = 'success',
  address,
}: {
  icon: IconName;
  title: string;
  /** The message. Plain text, or text with the email address emphasised. */
  children: React.ReactNode;
  actions: React.ReactNode;
  help?: string;
  /** Green when it worked, red when it failed, amber when it is only a
   *  hiccup -- like no connection -- that nothing was lost to. */
  tone?: 'success' | 'danger' | 'warning';
  /** An email shown on its own, large, so a typo in it is hard to miss. */
  address?: string;
}) {
  const theme = useTheme();
  const ink = tone === 'danger' ? theme.danger : tone === 'warning' ? theme.warning : theme.success;
  const soft =
    tone === 'danger' ? theme.dangerSoft : tone === 'warning' ? theme.warningSoft : theme.successSoft;
  const onInk =
    tone === 'danger' ? theme.onDanger : tone === 'warning' ? theme.onWarning : theme.onSuccess;
  return (
    <View style={[authStyles.content, styles.result]}>
      <View style={[styles.resultRing, { backgroundColor: soft }]}>
        <View style={[styles.resultIcon, { backgroundColor: ink }]}>
          <Ionicons name={icon} size={26} color={onInk} />
        </View>
      </View>

      <View style={styles.resultText}>
        <ThemedText style={styles.title}>{title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.resultBody}>
          {children}
        </ThemedText>
      </View>

      {address ? (
        <View style={[styles.address, { backgroundColor: theme.backgroundSelected }]}>
          <Ionicons name="mail-outline" size={18} color={theme.textSecondary} />
          <ThemedText style={styles.addressText} numberOfLines={2}>
            {address}
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.resultActions}>{actions}</View>

      {help ? (
        <ThemedText themeColor="textTertiary" style={styles.resultHelp}>
          {help}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** An email address inside a sentence, a shade darker so it can be checked. */
export function Emphasis({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <ThemedText style={[styles.resultBody, { color: theme.text, fontWeight: '500' }]}>{children}</ThemedText>;
}

type HintProps = {
  hint?: string;
  hintTone: 'neutral' | 'danger' | 'warning' | 'success';
  hintAction?: { label: string; onPress: () => void };
};

/**
 * The line under an email field, the same on every screen that asks for one:
 * red when it is empty or not an email, once you have left the field or
 * pressed the button, and nothing otherwise.
 *
 * Deliberately no green tick and no "did you mean": both talked over the one
 * answer that matters -- whether the account exists -- which only sending
 * can give.
 *
 * Spread the result onto an AuthField: `<AuthField {...check.field} />`.
 */
export function emailCheck(email: string, touched: boolean): { valid: boolean; field: HintProps } {
  const valid = isProperEmail(email);
  if (valid || !touched) return { valid, field: { hintTone: 'neutral' } };
  return {
    valid,
    field: {
      hint: !email.trim()
        ? 'Enter your email.'
        : isValidEmail(email)
          ? // The shape is fine; the provider or ending is not (gma.con).
            'Check your email. The part after @ looks mistyped.'
          : 'Enter a valid email, like name@example.com.',
      hintTone: 'danger',
    },
  };
}

/** "Question? Link" -- the way to the other auth screen, at the bottom. */
export function AuthSwitch({ prompt, label, href }: { prompt: string; label: string; href: Href }) {
  const theme = useTheme();
  return (
    <View style={styles.footer}>
      <ThemedText themeColor="textSecondary" style={styles.footerText}>
        {prompt}
      </ThemedText>
      <Link href={href} replace>
        <ThemedText style={[styles.link, { color: theme.primary }]}>{label}</ThemedText>
      </Link>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  /** The scrolling column every auth screen sits in. */
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.five,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  form: { gap: Spacing.three + 2 },
  link: { fontSize: 13.5, lineHeight: 18, fontWeight: '500' },
});

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  markInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.3, textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 20, fontWeight: '400', textAlign: 'center' },

  fieldWrap: { gap: 6 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
  },
  // minWidth 0 so the input can shrink below its intrinsic width on web.
  input: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '400', paddingVertical: Spacing.two },
  prefix: { paddingRight: Spacing.two + 2, borderRightWidth: StyleSheet.hairlineWidth },
  prefixText: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  hint: { fontSize: 12.5, lineHeight: 17, fontWeight: '400' },
  hintText: { flexShrink: 1 },
  hintLink: { fontWeight: '600', textDecorationLine: 'underline' },

  button: {
    flexDirection: 'row',
    gap: Spacing.two,
    height: 50,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  buttonText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },

  result: { alignItems: 'center', gap: Spacing.four },
  resultRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: { gap: Spacing.two, alignItems: 'center', alignSelf: 'stretch' },
  resultBody: { fontSize: 14, lineHeight: 21, fontWeight: '400', textAlign: 'center' },
  address: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.sm,
    marginTop: -Spacing.two,
  },
  addressText: { fontSize: 16, lineHeight: 22, fontWeight: '500', flexShrink: 1, textAlign: 'center' },
  resultActions: { alignSelf: 'stretch', gap: Spacing.two + 2 },
  resultHelp: { fontSize: 12.5, lineHeight: 17, textAlign: 'center' },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  footerText: { fontSize: 13.5, lineHeight: 18, fontWeight: '400' },
  link: { fontSize: 13.5, lineHeight: 18, fontWeight: '500' },
});
