import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AuthButton,
  AuthField,
  AuthHeader,
  AuthSwitch,
  authStyles,
} from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Notice } from '@/components/ui/notice';
import { Spacing } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { isProperEmail } from '@/lib/email';
import { looksLikePhone, normalizePhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

/**
 * Sign in, built around one idea: nothing on this screen should need reading
 * twice. One green button; the only other colour is red, and only when
 * something went wrong.
 */
export default function SignInScreen() {
  const theme = useTheme();
  // Email or phone in one field: the field decides which it is from what is
  // typed, so nobody has to choose a tab before they start.
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set only when Sign in is pressed: the entry is not an email or a number.
  const [accountError, setAccountError] = useState<string | null>(null);
  // The account and password did not match. Kept apart from `error`, which is
  // for everything else (no connection, unconfirmed email, locked out).
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);

  const isPhone = looksLikePhone(account);

  /**
   * Sign in says nothing while you type -- no green tick, no "did you mean".
   * It checks when you press Sign in, as large sign-in forms do. Live hints
   * belong on create account, where you are choosing a new value; here they
   * talked over the one answer that matters, which only the server has.
   */
  const accountField = mismatch
    ? { hintTone: 'danger' as const }
    : accountError
      ? { hint: accountError, hintTone: 'danger' as const }
      : { hintTone: 'neutral' as const };
  const canSubmit = !!account.trim() && !!password && !busy;

  function edited() {
    setError(null);
    setAccountError(null);
    setMismatch(false);
  }

  /**
   * For a phone, the database checks the password and only then says which
   * email the account uses (migration 0035). The email never comes back for a
   * wrong password, so the lookup cannot be used to collect addresses.
   */
  async function emailForPhone(): Promise<string | null> {
    const phone = normalizePhone(account);
    if (!phone) {
      setError('Enter a 10-digit mobile number, or your email.');
      return null;
    }
    const { data, error: lookupError } = await supabase.rpc('phone_sign_in_email', {
      p_phone: phone,
      p_password: password,
    });
    if (lookupError) {
      setError(humanError(lookupError));
      return null;
    }
    if (!data) {
      wrongCredentials();
      return null;
    }
    return data as string;
  }

  /**
   * The way large sign-in forms do it: both fields go red, one message under
   * them says it could be either, and only the password is cleared. Saying
   * which one was wrong would tell a stranger that the email has an account.
   */
  function wrongCredentials() {
    setMismatch(true);
    setPassword('');
  }

  async function signIn() {
    if (!canSubmit) return;
    edited();

    // Clearly not an address or a mobile: say so, and send nothing.
    if (isPhone ? !normalizePhone(account) : !isProperEmail(account)) {
      setAccountError('Enter a valid email or phone number.');
      return;
    }

    setBusy(true);

    const email = isPhone ? await emailForPhone() : account.trim();
    if (!email) {
      setBusy(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    // On success the auth listener in SessionProvider flips the guard; there
    // is nothing to navigate to by hand.
    if (signInError) {
      if (signInError.message === 'Invalid login credentials') wrongCredentials();
      else setError(humanError(signInError));
    }
    setBusy(false);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
      <KeyboardAwareScrollView contentContainerStyle={authStyles.content}>
        <AuthHeader
          icon="home"
          title="Welcome back"
          subtitle="Sign in to see what your household owes."
        />

        <View style={authStyles.form}>
          <AuthField
            label="Email or phone number"
            icon={isPhone ? 'call-outline' : 'mail-outline'}
            value={account}
            onChangeText={(v) => {
              setAccount(v);
              edited();
            }}
            {...accountField}
            autoCapitalize="none"
            autoComplete="username"
            keyboardType="email-address"
            // Short on purpose. Two sample values joined by "or" read as one
            // long string to scan; the label already says what goes here.
            placeholder="Enter email or phone"
            editable={!busy}
            returnKeyType="next"
          />

          <View style={styles.passwordBlock}>
            <AuthField
              label="Password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                edited();
              }}
              hint={
                mismatch
                  ? `Incorrect ${isPhone ? 'phone number' : 'email'} or password. Check both and try again.`
                  : undefined
              }
              hintTone={mismatch ? 'danger' : 'neutral'}
              secure
              autoCapitalize="none"
              autoComplete="current-password"
              placeholder="Enter your password"
              editable={!busy}
              onSubmitEditing={signIn}
              returnKeyType="go"
            />
            <Link href="/forgot-password" style={styles.forgot}>
              <ThemedText style={[authStyles.link, { color: theme.primary }]}>Forgot password?</ThemedText>
            </Link>
          </View>

          {error ? <Notice tone="danger" message={error} /> : null}

          <View style={styles.submit}>
            <AuthButton title="Sign in" onPress={signIn} busy={busy} disabled={!canSubmit} />
          </View>
        </View>

        <AuthSwitch prompt="New to Roomly?" label="Create an account" href="/register" />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  passwordBlock: { gap: Spacing.two + 2 },
  forgot: { alignSelf: 'flex-end' },
  submit: { marginTop: Spacing.one },
});
