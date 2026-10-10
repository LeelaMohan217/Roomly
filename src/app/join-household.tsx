import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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

type Claimable = { id: string; display_name: string };
type Preview = { household_name: string; claimable: Claimable[] };

/** Codes are typed off a WhatsApp message, so be forgiving about format. */
function formatCode(raw: string): string {
  const clean = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  return clean.length > 3 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
}

export default function JoinHouseholdScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, refresh } = useSession();

  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [name, setName] = useState(
    (session?.user.user_metadata?.display_name as string | undefined) ?? ''
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkCode() {
    setError(null);
    setBusy(true);

    const { data, error: rpcError } = await supabase.rpc('preview_invite', { p_code: code });

    setBusy(false);
    if (rpcError) {
      setError(humanError(rpcError));
      return;
    }
    setPreview(data as Preview);
  }

  async function requestJoin() {
    setError(null);
    setBusy(true);

    const { error: rpcError } = await supabase.rpc('request_join', {
      p_code: code,
      p_name: name.trim(),
      p_claim: claimId,
    });

    if (rpcError) {
      // humanError, not the raw message. preview_invite's own P0001 messages
      // pass through it unchanged, but anything else — RLS, a dropped
      // connection — used to leak raw Postgres text into this form.
      setError(humanError(rpcError));
      setBusy(false);
      return;
    }

    // Flips status to 'waiting' — the owner has to approve before you're in.
    await refresh();

    // Always cleared. If refresh() does not see the request, this screen stays
    // mounted, and leaving busy true left the button spinning with Back
    // disabled — unrecoverable without killing the app.
    setBusy(false);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Enter invite code</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Ask whoever set up the household for a code.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextField
              label="Invite code"
              value={code}
              onChangeText={(t) => {
                setCode(formatCode(t));
                setPreview(null);
                setClaimId(null);
              }}
              placeholder="ABC-123"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              style={styles.codeInput}
              error={preview ? undefined : (error ?? undefined)}
            />

            {!preview ? (
              <Button
                title="Check code"
                onPress={checkCode}
                loading={busy}
                disabled={code.replace('-', '').length < 6}
              />
            ) : (
              <>
                <View
                  style={[
                    styles.confirm,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    JOINING
                  </ThemedText>
                  <ThemedText type="default" style={styles.houseName}>
                    {preview.household_name}
                  </ThemedText>
                </View>

                {preview.claimable.length > 0 ? (
                  <View style={styles.claims}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      WHICH ONE ARE YOU?
                    </ThemedText>

                    {preview.claimable.map((c) => (
                      <ClaimRow
                        key={c.id}
                        label={c.display_name}
                        selected={claimId === c.id}
                        onPress={() => {
                          setClaimId(c.id);
                          setName(c.display_name);
                        }}
                      />
                    ))}

                    <ClaimRow
                      label="I'm someone new"
                      selected={claimId === null}
                      onPress={() => setClaimId(null)}
                    />
                  </View>
                ) : null}

                <TextField
                  label="Your name"
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  editable={!busy}
                  error={error ?? undefined}
                />

                <Button
                  title="Request to join"
                  onPress={requestJoin}
                  loading={busy}
                  disabled={!name.trim()}
                />
              </>
            )}

            <Button title="Back" variant="ghost" onPress={() => router.back()} disabled={busy} />
          </View>
        </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function ClaimRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.claimRow,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? theme.backgroundSelected : 'transparent',
        },
      ]}>
      <View
        style={[
          styles.radio,
          { borderColor: selected ? theme.primary : theme.border },
          selected && { backgroundColor: theme.primary },
        ]}
      />
      <ThemedText type="default">{label}</ThemedText>
    </Pressable>
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
  codeInput: {
    fontSize: 24,
    letterSpacing: 4,
    fontWeight: '600',
    textAlign: 'center',
  },
  confirm: {
    borderRadius: 14,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  houseName: { fontWeight: '600' },
  claims: { gap: Spacing.two },
  claimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.three,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
});
