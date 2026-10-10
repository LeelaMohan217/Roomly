import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/brand/logo';
import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Type } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setError(null);
    setBusy(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    // On success the auth listener in SessionProvider flips the guard; there
    // is nothing to navigate to by hand.
    if (signInError) setError(humanError(signInError));
    setBusy(false);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Logo size={34} />
            <ThemedText style={[Type.title, styles.heading]}>Welcome back</ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.body}>
              Sign in to your household
            </ThemedText>
          </View>

          <View style={styles.form}>
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
              autoComplete="current-password"
              placeholder="••••••••"
              editable={!busy}
              error={error ?? undefined}
              onSubmitEditing={signIn}
              returnKeyType="go"
            />

            <Link href="/forgot-password" style={styles.forgot}>
              <ThemedText style={[Type.caption, { color: theme.primary, fontWeight: '600' }]}>
                Forgot password?
              </ThemedText>
            </Link>

            <Button
              title="Log in"
              onPress={signIn}
              loading={busy}
              disabled={!email.trim() || !password}
            />
          </View>

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary" style={Type.caption}>
              New here?
            </ThemedText>
            <Link href="/register" replace>
              <ThemedText style={[Type.caption, { color: theme.primary, fontWeight: '700' }]}>
                Create an account
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
  header: { gap: Spacing.one },
  heading: { marginTop: Spacing.three },
  form: { gap: Spacing.three },
  forgot: { alignSelf: 'flex-end', marginTop: -Spacing.one },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
