import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Type } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Phase = 'idle' | 'verifying' | 'ready' | 'invalid' | 'saved';

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
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText themeColor="textSecondary" style={Type.body}>
            Checking your link…
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'invalid') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <View style={[styles.icon, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="link-outline" size={26} color={theme.danger} />
          </View>
          <ThemedText style={Type.title}>Link didn&apos;t work</ThemedText>
          <ThemedText themeColor="textSecondary" style={[Type.body, styles.centeredText]}>
            {error ?? 'This reset link is invalid or has expired.'} Reset links last an hour and
            can only be used once.
          </ThemedText>
          <Button
            title={status === 'signedOut' ? 'Request a new link' : 'Back to the app'}
            onPress={() => router.replace(status === 'signedOut' ? '/forgot-password' : home)}
            style={styles.fullWidth}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'saved') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <View style={[styles.icon, { backgroundColor: theme.primarySoft }]}>
            <Ionicons name="checkmark-circle-outline" size={28} color={theme.primary} />
          </View>
          <ThemedText style={Type.title}>Password changed</ThemedText>
          <ThemedText themeColor="textSecondary" style={[Type.body, styles.centeredText]}>
            You&apos;re signed in on this phone. Any other device will need the new password.
          </ThemedText>
          <Button
            title="Continue"
            onPress={() => router.replace(home)}
            style={styles.fullWidth}
          />
        </View>
      </SafeAreaView>
    );
  }

  const tooShort = password.length > 0 && password.length < 8;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText style={Type.title}>Choose a new password</ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.body}>
              {session?.user.email
                ? `For ${session.user.email}`
                : 'Pick something you can remember.'}
            </ThemedText>
          </View>

          <TextField
            label="New password"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="••••••••"
            editable={!busy}
            hint="At least 8 characters"
            error={tooShort ? 'Use at least 8 characters' : (error ?? undefined)}
            onSubmitEditing={save}
            returnKeyType="go"
          />

          <Button
            title="Save new password"
            onPress={save}
            loading={busy}
            disabled={password.length < 8}
          />
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
    gap: Spacing.four,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  centeredText: { textAlign: 'center' },
  fullWidth: { alignSelf: 'stretch' },
  icon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  header: { gap: Spacing.one },
});
