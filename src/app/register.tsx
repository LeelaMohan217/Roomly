import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Type } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function RegisterScreen() {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.length >= 8;

  async function register() {
    setError(null);
    setBusy(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() } },
    });

    setBusy(false);

    if (signUpError) {
      setError(humanError(signUpError));
      return;
    }

    // With email confirmation on, signUp returns a user but no session —
    // nothing happens until they click the link. Say so, rather than leaving
    // them on a form that looks like it silently failed.
    if (!data.session) setCheckEmail(true);
  }

  /**
   * Confirmation emails do go missing — spam folders, typo'd addresses, a
   * provider that drops them — and there was NO way to ask for another one.
   * supabase.auth.resend was never called anywhere in the app, so the only
   * recovery was to trigger a password reset for an account you had not
   * confirmed, or to wait and hope.
   */
  async function resend() {
    setResending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
    });
    setResending(false);
    setResent(!resendError);
    if (resendError) setError(humanError(resendError));
  }

  if (checkEmail) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={[styles.content, styles.centered]}>
          <ThemedText type="subtitle">Check your email</ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.centeredText}>
            We sent a confirmation link to {email.trim()}. Open it, then come back and log in.
          </ThemedText>

          {error ? (
            <ThemedText themeColor="danger" style={[Type.caption, styles.centeredText]}>
              {error}
            </ThemedText>
          ) : null}

          <Button
            title={resent ? 'Sent again' : 'Send it again'}
            variant="secondary"
            onPress={resend}
            loading={resending}
            disabled={resent}
            style={styles.fullWidth}
          />
          <Link href="/sign-in" replace asChild>
            <Button title="Back to login" variant="ghost" style={styles.fullWidth} />
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Create your account</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              One account per person in the house
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Your name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder="Mohan"
              editable={!busy}
              hint="This is how you'll appear in the ledger"
            />

            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              editable={!busy}
            />

            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secure
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="••••••••"
              editable={!busy}
              hint="At least 8 characters"
              error={passwordTooShort ? 'Use at least 8 characters' : (error ?? undefined)}
            />

            <Button title="Create account" onPress={register} loading={busy} disabled={!canSubmit} />
          </View>

          <View style={styles.footer}>
            <ThemedText type="small" themeColor="textSecondary">
              Already have an account?
            </ThemedText>
            <Link href="/sign-in" replace>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Log in
              </ThemedText>
            </Link>
          </View>
        </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.five,
  },
  centered: { alignItems: 'center', gap: Spacing.four },
  centeredText: { textAlign: 'center' },
  fullWidth: { alignSelf: 'stretch' },
  header: { gap: Spacing.one },
  form: { gap: Spacing.three },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
