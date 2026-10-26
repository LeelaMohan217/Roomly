import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AuthButton,
  AuthField,
  AuthHeader,
  AuthResult,
  AuthSwitch,
  authStyles,
  emailCheck,
} from '@/components/auth-form';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Notice } from '@/components/ui/notice';
import { Spacing } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * Forgot password, in the same style as sign in.
 *
 * Email only, even though sign-in takes a phone too: the reset link goes to
 * an inbox, and turning a phone number into an email here would tell a
 * stranger which address an account uses.
 */
export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checked here, before anything is sent: Supabase would only answer a bad
  // format with its own technical wording.
  const check = emailCheck(email, emailTouched);
  const canSubmit = check.valid && !busy;

  async function send() {
    setEmailTouched(true);
    if (!canSubmit) return;
    setError(null);
    setBusy(true);

    // createURL gives roomly://reset-password in a build, and the exp:// dev
    // equivalent in Expo Go, so the same code works in both.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: Linking.createURL('/reset-password'),
    });

    setBusy(false);

    // Deliberately not distinguishing "no such account": telling a stranger
    // which emails are registered is an account-enumeration leak.
    if (resetError) {
      setError(humanError(resetError));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
        {/* The address gets a line of its own, large. Whether it has an
            account is never said (that would tell a stranger who uses
            Roomly), so the one thing that helps someone who typed
            leelamohan@ instead of leelamohan217@ is seeing it plainly. */}
        <AuthResult
          icon="mail-open-outline"
          title="Check your email"
          address={email.trim()}
          help="Nothing after 2 minutes? Check the address above and your spam folder."
          actions={
            <>
              <AuthButton title="Back to sign in" onPress={() => router.replace('/sign-in')} />
              <AuthButton
                variant="secondary"
                title="Wrong email? Change it"
                onPress={() => {
                  // Kept, not cleared: fixing "leelamohan" to "leelamohan217"
                  // is a two-character edit, not a retype.
                  setSent(false);
                  setEmailTouched(false);
                }}
              />
            </>
          }>
          If this email has a Roomly account, we sent it a link to set a new password. The link
          works for one hour.
        </AuthResult>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
      <KeyboardAwareScrollView contentContainerStyle={authStyles.content}>
        <AuthHeader
          icon="key"
          title="Forgot your password?"
          subtitle="Enter the email on your account and we’ll send you a link to set a new one."
        />

        <View style={authStyles.form}>
          <AuthField
            label="Email"
            icon="mail-outline"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            onBlur={() => setEmailTouched(true)}
            {...check.field}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Enter your email"
            editable={!busy}
            onSubmitEditing={send}
            returnKeyType="send"
          />

          {error ? <Notice tone="danger" message={error} /> : null}

          <View style={styles.submit}>
            <AuthButton title="Send reset link" onPress={send} busy={busy} disabled={!canSubmit} />
          </View>
        </View>

        <AuthSwitch prompt="Remembered it?" label="Sign in" href="/sign-in" />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  submit: { marginTop: Spacing.one },
});
