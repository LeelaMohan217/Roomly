import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthField, AuthHeader, authStyles } from '@/components/auth-form';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Notice } from '@/components/ui/notice';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function CreateHouseholdScreen() {
  const theme = useTheme();
  const { session, refresh } = useSession();

  const [houseName, setHouseName] = useState('');
  const [houseTouched, setHouseTouched] = useState(false);
  const [displayName, setDisplayName] = useState(
    (session?.user.user_metadata?.display_name as string | undefined) ?? ''
  );
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const houseMissing = houseTouched && !houseName.trim();
  const nameMissing = nameTouched && !displayName.trim();
  const canSubmit = !!houseName.trim() && !!displayName.trim() && !busy;

  async function create() {
    if (!canSubmit) return;
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
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
      <KeyboardAwareScrollView contentContainerStyle={authStyles.content}>
        <AuthHeader
          icon="home"
          title="Create your household"
          subtitle="You’ll manage it, and can invite your housemates right after."
        />

        <View style={authStyles.form}>
          <AuthField
            label="Household name"
            icon="home-outline"
            value={houseName}
            onChangeText={(v) => {
              setHouseName(v);
              setError(null);
            }}
            onBlur={() => setHouseTouched(true)}
            placeholder="Enter household name"
            autoCapitalize="words"
            editable={!busy}
            returnKeyType="next"
            // A nudge toward something everyone in the flat will recognise.
            hint={houseMissing ? 'Enter a household name.' : 'Like your flat number and area.'}
            hintTone={houseMissing ? 'danger' : 'neutral'}
          />

          <AuthField
            label="Your name"
            icon="person-outline"
            value={displayName}
            onChangeText={(v) => {
              setDisplayName(v);
              setError(null);
            }}
            onBlur={() => setNameTouched(true)}
            placeholder="Enter your name"
            autoCapitalize="words"
            editable={!busy}
            onSubmitEditing={create}
            returnKeyType="go"
            hint={nameMissing ? 'Enter your name.' : undefined}
            hintTone={nameMissing ? 'danger' : 'neutral'}
          />

          {error ? <Notice tone="danger" message={error} /> : null}

          <View style={styles.submit}>
            <AuthButton title="Create household" onPress={create} busy={busy} disabled={!canSubmit} />
          </View>
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  submit: { marginTop: Spacing.one },
});
