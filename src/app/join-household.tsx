import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthField, AuthHeader, authStyles } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Notice } from '@/components/ui/notice';
import { Radius, Spacing } from '@/constants/theme';
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

/**
 * Join a household, in two steps on one screen: check the code, then say who
 * you are. The second step only appears once the code has found a household,
 * so the screen never asks for a name before it can say what you are joining.
 */
export default function JoinHouseholdScreen() {
  const theme = useTheme();
  const { session, refresh } = useSession();

  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [name, setName] = useState(
    (session?.user.user_metadata?.display_name as string | undefined) ?? ''
  );
  // A code that did not work belongs under the code field; anything after
  // that (the join request itself) goes in the red box above the button.
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const codeComplete = code.replace('-', '').length === 6;

  async function checkCode() {
    if (!codeComplete || busy) return;
    setCodeError(null);
    setBusy(true);

    const { data, error: rpcError } = await supabase.rpc('preview_invite', { p_code: code });

    setBusy(false);
    if (rpcError) {
      setCodeError(humanError(rpcError));
      return;
    }
    setPreview(data as Preview);
  }

  async function requestJoin() {
    if (!name.trim() || busy) return;
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
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
      <KeyboardAwareScrollView contentContainerStyle={authStyles.content}>
        <AuthHeader
          icon="enter"
          title="Join a household"
          subtitle="Enter the invite code a housemate sent you."
        />

        <View style={authStyles.form}>
          <AuthField
            label="Invite code"
            icon="key-outline"
            value={code}
            onChangeText={(t) => {
              setCode(formatCode(t));
              setPreview(null);
              setClaimId(null);
              setCodeError(null);
              setError(null);
            }}
            placeholder="Enter 6-character code"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            onSubmitEditing={checkCode}
            returnKeyType="go"
            inputStyle={code ? styles.codeInput : undefined}
            hint={codeError ?? undefined}
            hintTone={codeError ? 'danger' : 'neutral'}
          />

          {!preview ? (
            <View style={styles.submit}>
              <AuthButton
                title="Check code"
                onPress={checkCode}
                busy={busy}
                disabled={!codeComplete}
              />
            </View>
          ) : (
            <>
              {/* What the code found, before anything else is asked. */}
              <View style={[styles.found, { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.foundIcon, { backgroundColor: theme.primarySoft }]}>
                  <Ionicons name="home-outline" size={20} color={theme.primary} />
                </View>
                <View style={styles.foundText}>
                  <ThemedText themeColor="textSecondary" style={styles.small}>
                    You’re joining
                  </ThemedText>
                  <ThemedText style={styles.foundName} numberOfLines={2}>
                    {preview.household_name}
                  </ThemedText>
                </View>
              </View>

              {preview.claimable.length > 0 ? (
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Which one are you?"
                  style={styles.claims}>
                  <ThemedText themeColor="textSecondary" style={styles.label}>
                    Which one are you?
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={styles.small}>
                    The owner may have added you already. Pick your name to keep your past expenses.
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
                    label="I’m someone new"
                    selected={claimId === null}
                    onPress={() => setClaimId(null)}
                  />
                </View>
              ) : null}

              <AuthField
                label="Your name"
                icon="person-outline"
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  setError(null);
                }}
                placeholder="Enter your name"
                autoCapitalize="words"
                editable={!busy}
                onSubmitEditing={requestJoin}
                returnKeyType="go"
              />

              {error ? <Notice tone="danger" message={error} /> : null}

              <View style={styles.submit}>
                <AuthButton
                  title="Request to join"
                  onPress={requestJoin}
                  busy={busy}
                  disabled={!name.trim()}
                />
              </View>
            </>
          )}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

/**
 * One choice in "which one are you?". Selection is shown in dark ink, not
 * green: green means "correct" in this app, and picking your own name is a
 * choice, not a right answer.
 */
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
      style={({ pressed }) => [
        styles.claimRow,
        {
          backgroundColor: selected ? theme.backgroundElement : theme.backgroundSelected,
          borderColor: selected ? theme.text : 'transparent',
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <View style={[styles.radio, { borderColor: selected ? theme.text : theme.textTertiary }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: theme.text }]} /> : null}
      </View>
      <ThemedText style={styles.claimLabel}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  submit: { marginTop: Spacing.one },
  // Only once something is typed: spaced capitals read like the code in the
  // message it was copied from, but would make the placeholder look shouty.
  codeInput: { fontSize: 17, letterSpacing: 3, fontWeight: '500' },

  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  small: { fontSize: 12.5, lineHeight: 17, fontWeight: '400' },

  found: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
  foundIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foundText: { flex: 1, gap: 1 },
  foundName: { fontSize: 16, lineHeight: 22, fontWeight: '500' },

  claims: { gap: Spacing.two },
  claimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 50,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  claimLabel: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
});
