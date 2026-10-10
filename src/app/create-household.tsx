import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function CreateHouseholdScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, refresh } = useSession();

  const [houseName, setHouseName] = useState('');
  const [displayName, setDisplayName] = useState(
    (session?.user.user_metadata?.display_name as string | undefined) ?? ''
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setError(null);
    setBusy(true);

    // Seeds the 13 default categories and the payment methods too — a blank
    // slate is a bad first experience and people guess the `kind` wrong.
    const { error: rpcError } = await supabase.rpc('create_household', {
      p_name: houseName.trim(),
      p_display_name: displayName.trim(),
    });

    if (rpcError) {
      // humanError, not the raw message — errors.ts exists precisely to stop
      // Postgres text reaching a user, and this was one of three places that
      // went around it.
      setError(humanError(rpcError));
      setBusy(false);
      return;
    }

    // Flips status to 'ready', which swaps the guard over to (app).
    await refresh();

    // Always cleared, even on success. This used to be left spinning: if
    // refresh() did not observe the new row — a swallowed read error, or
    // read-after-write lag — the screen stayed mounted with busy true, the
    // submit button spinning and Back disabled={busy}. Only killing the app
    // recovered. On success the guard swaps this screen away and the extra
    // setState is a no-op.
    setBusy(false);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Name your household</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              You&apos;ll be the owner, and can invite the others once it exists.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Household name"
              value={houseName}
              onChangeText={setHouseName}
              placeholder="Flat 302, Gachibowli"
              autoCapitalize="words"
              editable={!busy}
            />

            <TextField
              label="Your name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Mohan"
              autoCapitalize="words"
              editable={!busy}
              error={error ?? undefined}
            />

            <Button
              title="Create household"
              onPress={create}
              loading={busy}
              disabled={!houseName.trim() || !displayName.trim()}
            />

            <Button
              title="Back"
              variant="ghost"
              onPress={() => router.back()}
              disabled={busy}
            />
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
  form: { gap: Spacing.three },
});
