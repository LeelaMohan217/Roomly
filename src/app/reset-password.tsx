import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthField, AuthHeader, AuthResult, authStyles } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Notice } from '@/components/ui/notice';
import { Spacing } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Phase = 'idle' | 'verifying' | 'ready' | 'invalid' | 'saved';

const MIN_PASSWORD = 8;

/**
 * Landing for the password-reset deep link, and NOTHING else.
 *
 * This screen sits OUTSIDE the auth guards on purpose. Verifying a recovery
 * link signs the user in — so if it were behind the signed-out guard, the
 * router would throw them into the app the instant the link worked, before
 * they ever chose a new password.
 *
 * Being unguarded also means it is reachable with no link at all: by a URL on
 * web, or by a stale navigation state. It used to render a password form in
 * that case, on the reasoning that a signed-in visitor must want to change
 * their password. That was wrong, and it is what made signing in look like it
 * demanded a new password every time. Changing your password on purpose lives
 * in Account; this screen now bounces anyone who arrives without a token.
 */
export default function ResetPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, status, refresh } = useSession();
  const params = useLocalSearchParams<{ code?: string; token_hash?: string; type?: string }>();

  // No token means there is no reset in progress, whatever the session says.
  //
  // Deliberately a one-shot initializer, not derived state. RootNavigator
  // renders null until status !== 'loading', so the params are already settled
  // when this screen first mounts. Re-deriving on a later session change would
  // be actively wrong: a background token refresh would flip an expired link
  // from "invalid" into a working password-change form.
  const [phase, setPhase] = useState<Phase>(
    params.code || params.token_hash ? 'verifying' : 'idle'
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A recovery code is single-use, so verifying twice burns it and drops the
  // user on "Link didn't work". Latch it against a re-run.
  const verifying = useRef(false);

  useEffect(() => {
    if (phase !== 'verifying' || verifying.current) return;
    verifying.current = true;

    void (async () => {
      // PKCE sends ?code=…; the older template sends ?token_hash=…&type=recovery.
      // Handle both so a change of email template doesn't silently break this.
      const result = params.code
        ? await supabase.auth.exchangeCodeForSession(params.code)
        : await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: params.token_hash!,
          });

      if (result.error) {
        setError(humanError(result.error));
        setPhase('invalid');
        return;
      }
      setPhase('ready');
    })();
  }, [phase, params.code, params.token_hash]);

  async function save() {
    if (password.length < MIN_PASSWORD || confirm !== password || busy) return;
    setError(null);
    setBusy(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setBusy(false);
    if (updateError) {
      setError(humanError(updateError));
      return;
    }

    await refresh();
    setPhase('saved');
  }

  // Where this user is allowed to be right now.
  //
  // This screen sits OUTSIDE every guard, so it is the one place that can be
  // showing while any status is current -- and a route that is not declared
  // under the active guard simply does not exist to the navigator, so
  // navigating to it does nothing at all. The 'idle' branch below worked this
  // out correctly and the other two did not: 'invalid' sent people to
  // /forgot-password, which only exists while signed out, and 'saved' sent
  // them to '/', which only exists once they are 'ready'. Both were dead
  // buttons for anyone in the wrong state.
  const home =
    status === 'signedOut'
      ? '/sign-in'
      : status === 'needsOnboarding'
        ? '/onboarding'
        : status === 'waiting'
          ? '/waiting'
          : '/';

  // Arrived with no link. Send them where they actually belong -- named
  // explicitly rather than leaning on the router's routeNames[0] fallback,
  // because relying on declaration order is what caused this bug once already.
  if (phase === 'idle') {
    return <Redirect href={home} />;
  }

  if (phase === 'verifying') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText themeColor="textSecondary" style={styles.waiting}>
            Checking your link…
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'invalid') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
        <AuthResult
          tone="danger"
          icon="link"
          title="This link didn’t work"
          // The underlying error stays off screen: every reason this fails
          // ends the same way, with a fresh link, and a code like
          // pkce_code_verifier_not_found only adds worry.
          actions={
            // Grey, not green: on a red "this failed" screen a green button
            // reads as a second, contradicting signal. The red says what
            // happened; the button is just the way out.
            <AuthButton
              variant="secondary"
              title={status === 'signedOut' ? 'Send me a new link' : 'Back to the app'}
              onPress={() => router.replace(status === 'signedOut' ? '/forgot-password' : home)}
            />
          }>
          Reset links work once, for one hour. Ask for a new one and use it straight away.
        </AuthResult>
      </SafeAreaView>
    );
  }

  if (phase === 'saved') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
        <AuthResult
          icon="checkmark"
          title="Password changed"
          actions={<AuthButton title="Continue" onPress={() => router.replace(home)} />}>
          You’re signed in on this phone. Other devices will need the new password.
        </AuthResult>
      </SafeAreaView>
    );
  }

  const passwordOk = password.length >= MIN_PASSWORD;
  const passwordShort = passwordTouched && password.length > 0 && !passwordOk;
  const matches = confirm.length > 0 && confirm === password;
  const mismatch = confirmTouched && confirm.length > 0 && confirm !== password;
  const canSave = passwordOk && matches && !busy;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
      <KeyboardAwareScrollView contentContainerStyle={authStyles.content}>
        <AuthHeader
          icon="key"
          title="Choose a new password"
          subtitle={
            session?.user.email
              ? `For ${session.user.email}`
              : 'Pick something you can remember.'
          }
        />

        <View style={authStyles.form}>
          <AuthField
            label="New password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            onBlur={() => setPasswordTouched(true)}
            secure
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="Create a password"
            editable={!busy}
            returnKeyType="next"
            hint={`At least ${MIN_PASSWORD} characters`}
            hintTone={passwordOk ? 'success' : passwordShort ? 'danger' : 'neutral'}
          />

          {/* Typed twice because there is no "show what I typed" moment after
              saving: a typo here locks you out until the next reset email. */}
          <AuthField
            label="Confirm new password"
            icon="lock-closed-outline"
            value={confirm}
            onChangeText={(v) => {
              setConfirm(v);
              setError(null);
            }}
            onBlur={() => setConfirmTouched(true)}
            secure
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="Enter it again"
            editable={!busy}
            onSubmitEditing={save}
            returnKeyType="go"
            hint={mismatch ? 'Passwords don’t match.' : matches ? 'Passwords match.' : undefined}
            hintTone={mismatch ? 'danger' : matches ? 'success' : 'neutral'}
          />

          {error ? <Notice tone="danger" message={error} /> : null}

          <View style={styles.submit}>
            <AuthButton title="Save new password" onPress={save} busy={busy} disabled={!canSave} />
          </View>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  waiting: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  submit: { marginTop: Spacing.one },
});
