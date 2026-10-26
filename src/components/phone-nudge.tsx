import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AuthButton, AuthField, authStyles } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { useDialog } from '@/components/ui/dialog';
import { Sheet } from '@/components/ui/sheet';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { normalizePhone, PHONE_PREFIX, phoneProblem, toTenDigits } from '@/lib/phone';
import { useMyPhone } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Asks an account with no phone number to add one, so it can sign in by phone.
 *
 * A bottom sheet, not a centred popup that blocks the app: people open Roomly
 * to add an expense, and a modal in the way of that is what gets swiped off
 * unread. It is polite about "Not now" -- gone for a week, and after three of
 * them it stops asking for good. The number can always be added in Account.
 * Once one is saved, the query says so and this never shows again.
 */

const SNOOZE_DAYS = 7;
const MAX_DISMISSALS = 3;
/** Long enough that Home has drawn and settled before anything slides up. */
const SHOW_AFTER_MS = 1200;

type Snooze = { dismissals: number; until: string | null };

/** Per account, on this phone: two people sharing a phone each get asked. */
const keyFor = (userId: string) => `roomly.phoneNudge.v1:${userId}`;

async function readSnooze(userId: string): Promise<Snooze> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw ? (JSON.parse(raw) as Snooze) : { dismissals: 0, until: null };
  } catch {
    return { dismissals: 0, until: null };
  }
}

export function PhoneNudge() {
  const theme = useTheme();
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;
  const myPhone = useMyPhone(userId);

  const [visible, setVisible] = useState(false);
  const [snooze, setSnooze] = useState<Snooze | null>(null);
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void readSnooze(userId).then(setSnooze);
  }, [userId]);

  // Only on a definite "no number": a failed read is not a reason to ask.
  const missing = myPhone.isSuccess && myPhone.data === null;

  // The clock is read here, in an effect, not during render.
  useEffect(() => {
    if (!missing || !snooze) return;
    const due =
      snooze.dismissals < MAX_DISMISSALS &&
      (!snooze.until || new Date(snooze.until).getTime() <= Date.now());
    if (!due) return;
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [missing, snooze]);

  async function notNow() {
    setVisible(false);
    if (!userId || !snooze) return;
    const next: Snooze = {
      dismissals: snooze.dismissals + 1,
      until: new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString(),
    };
    setSnooze(next);
    try {
      await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
    } catch {
      // Not remembered: it simply asks again next launch.
    }
  }

  const e164 = normalizePhone(phone);
  const problem = touched ? phoneProblem(phone) : null;

  async function save() {
    setTouched(true);
    if (!e164 || busy) return;
    setError(null);
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('set_my_phone', { p_phone: e164 });
    setBusy(false);
    if (rpcError) {
      setError(humanError(rpcError));
      return;
    }
    setVisible(false);
    await queryClient.invalidateQueries({ queryKey: ['my-phone'] });
    dialog.toast({ message: 'Number saved. You can now sign in with it.' });
  }

  return (
    <Sheet
      visible={visible}
      title="Add your mobile number"
      subtitle="Sign in with your number next time, not just your email."
      onClose={() => void notNow()}>
      <AuthField
        label="Phone number"
        icon="call-outline"
        prefix={PHONE_PREFIX}
        value={phone}
        onChangeText={(v) => {
          setPhone(toTenDigits(v));
          setError(null);
        }}
        onBlur={() => setTouched(true)}
        keyboardType="number-pad"
        autoComplete="tel-national"
        placeholder="Enter mobile number"
        editable={!busy}
        onSubmitEditing={save}
        returnKeyType="done"
        hint={error ?? problem ?? undefined}
        hintTone={error || problem ? 'danger' : 'neutral'}
      />

      <View style={styles.actions}>
        <AuthButton title="Save number" onPress={save} busy={busy} disabled={!e164} />
        <Pressable
          accessibilityRole="button"
          onPress={() => void notNow()}
          disabled={busy}
          hitSlop={10}
          style={styles.later}>
          <ThemedText style={[authStyles.link, { color: theme.textSecondary }]}>Not now</ThemedText>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.three, marginTop: Spacing.one },
  later: { alignSelf: 'center' },
});
