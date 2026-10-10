import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * The holding state between "I entered the code" and "the owner approved me".
 *
 * SessionProvider watches this request over Realtime AND re-checks on a timer,
 * so the screen advances by itself the moment the owner taps approve. The timer
 * matters: postgres_changes only delivers if the table is in the
 * supabase_realtime publication, and before migration 0027 nothing in this repo
 * put it there — it was a dashboard checkbox. When it was off, an approved
 * joiner sat here forever with no button that would have helped.
 */
export default function WaitingScreen() {
  const theme = useTheme();
  const { pending, signOut, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!pending) return;
    setBusy(true);
    setError(null);

    // The result used to be discarded entirely. Offline, or refused by the
    // join_requests_cancel policy, refresh() re-read the still-pending row and
    // put the user back on this screen with the spinner cleared and no message
    // — a button that visibly did nothing, forever.
    const { error: updateError } = await supabase
      .from('join_requests')
      .update({ status: 'cancelled' })
      .eq('id', pending.id);

    if (updateError) {
      setError(humanError(updateError));
      setBusy(false);
      return;
    }

    await refresh();
    setBusy(false);
  }

  async function checkNow() {
    setChecking(true);
    setError(null);
    await refresh();
    setChecking(false);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={theme.primary} />

        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.centeredText}>
            Waiting for approval
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.centeredText}>
            {pending
              ? `You asked to join as ${pending.display_name}. The household owner needs to approve it — we'll let you in the moment they do.`
              : "The household owner needs to approve your request. We'll let you in the moment they do."}
          </ThemedText>
        </View>

        {error ? (
          <ThemedText themeColor="danger" style={[Type.caption, styles.centeredText]}>
            {error}
          </ThemedText>
        ) : null}

        <View style={styles.actions}>
          <Button
            title="Check now"
            variant="secondary"
            onPress={checkNow}
            loading={checking}
            disabled={busy}
          />
          <Button
            title="Cancel request"
            variant="ghost"
            onPress={cancel}
            loading={busy}
            disabled={checking}
          />
          <Button
            title="Sign out"
            variant="ghost"
            onPress={() => void signOut()}
            disabled={busy || checking}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.five,
  },
  header: { gap: Spacing.two, alignItems: 'center' },
  centeredText: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.two },
});
