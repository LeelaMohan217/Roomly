import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing, Type } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
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
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <View style={[styles.icon, { backgroundColor: theme.primarySoft }]}>
            <Ionicons name="mail-open-outline" size={26} color={theme.primary} />
          </View>
          <ThemedText style={Type.title}>Check your email</ThemedText>
          <ThemedText themeColor="textSecondary" style={[Type.body, styles.centeredText]}>
            If an account exists for {email.trim()}, we&apos;ve sent a link to reset your
            password. Open it on this phone.
          </ThemedText>

          <Card style={styles.tipCard}>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              The link expires after an hour. Check spam if it hasn&apos;t arrived in a couple of
              minutes.
            </ThemedText>
          </Card>

          <Link href="/sign-in" replace asChild>
            <Button title="Back to sign in" variant="secondary" style={styles.fullWidth} />
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText style={Type.title}>Reset your password</ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.body}>
              We&apos;ll email you a link to set a new one.
            </ThemedText>
          </View>

          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            editable={!busy}
            error={error ?? undefined}
            onSubmitEditing={send}
            returnKeyType="send"
          />

          <Button title="Send reset link" onPress={send} loading={busy} disabled={!email.trim()} />

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary" style={Type.caption}>
              Remembered it?
            </ThemedText>
            <Link href="/sign-in" replace>
              <ThemedText style={[Type.caption, { color: theme.primary, fontWeight: '700' }]}>
                Sign in
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
  tipCard: { alignSelf: 'stretch', borderRadius: Radius.md },
  header: { gap: Spacing.one },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
