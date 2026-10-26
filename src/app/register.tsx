import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AuthButton,
  AuthField,
  AuthHeader,
  AuthResult,
  AuthSwitch,
  Emphasis,
  authStyles,
  emailCheck,
} from '@/components/auth-form';
import { KeyboardAwareScrollView } from '@/components/ui/keyboard-aware-scroll-view';
import { Notice } from '@/components/ui/notice';
import { Spacing } from '@/constants/theme';
import { humanError } from '@/lib/errors';
import { useTheme } from '@/hooks/use-theme';
import { normalizePhone, PHONE_PREFIX } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

const MIN_PASSWORD = 8;

/**
 * What the phone field keeps: digits only, ten at most. +91 is already shown
 * in front, so the field is exactly the mobile number.
 *
 * Not maxLength={10}: that cuts a pasted "+91 98765 43210" to "+91 98765 "
 * before this ever sees it. A whole pasted number loses its +91 or leading 0
 * here instead; anything else stops at the tenth digit.
 */
function tenDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/**
 * Create an account, in the same style as sign in.
 *
 * The password rule is shown before it is broken, not after: grey while you
 * type, green with a tick once it is met, red only if you leave the field
 * short. Being told "too short" while still typing the third character reads
 * as being scolded for something you were about to do anyway.
 */
export default function RegisterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const passwordOk = password.length >= MIN_PASSWORD;
  const passwordShort = passwordTouched && password.length > 0 && !passwordOk;

  // Required: every account can sign in with its number as well as its email.
  // Red only once you have left the field without a valid mobile in it.
  const phoneE164 = normalizePhone(phone);
  const phoneBad = phoneTouched && !phoneE164;
  const phoneHint = phoneTaken
    ? 'This number is already registered to another account.'
    : phoneBad
      ? // Ten digits that still fail can only be a wrong first digit, and
        // "enter 10 digits" would be wrong when there already are ten.
        phone.length === 10
        ? 'Mobile numbers start with 6, 7, 8 or 9.'
        : 'Enter a 10-digit mobile number.'
      : phoneE164
        ? 'You can sign in with this number.'
        : undefined;
  const phoneTone = phoneTaken || phoneBad ? 'danger' : phoneE164 ? 'success' : 'neutral';

  // A typo here is worse than anywhere else: the confirmation link goes to the
  // misspelt inbox and the account can never be opened.
  const emailOk = emailCheck(email, emailTouched);

  const canSubmit =
    name.trim().length > 0 && emailOk.valid && !!phoneE164 && passwordOk && !busy;

  async function register() {
    if (!canSubmit) return;
    setError(null);
    setPhoneTaken(false);
    setBusy(true);

    // Asked before creating the account, so a taken number reads as "pick
    // another" on the field rather than as a failed sign-up.
    const { data: free, error: checkError } = await supabase.rpc('phone_is_available', {
      p_phone: phoneE164,
    });
    if (checkError) {
      setBusy(false);
      setError(humanError(checkError));
      return;
    }
    if (!free) {
      setBusy(false);
      setPhoneTaken(true);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim(), phone: phoneE164 } },
    });

    setBusy(false);

    if (signUpError) {
      // The database trigger refuses a number someone took in the moment
      // since the check above; Supabase reports any trigger refusal this way.
      if (/database error saving new user/i.test(signUpError.message)) {
        setPhoneTaken(true);
        return;
      }
      setError(humanError(signUpError));
      return;
    }

    // With email confirmation on, signUp returns a user but no session —
    // nothing happens until they click the link. Say so, rather than leaving
    // them on a form that looks like it silently failed.
    if (!data.session) setCheckEmail(true);
  }

  /**
   * Confirmation emails do go missing — spam folders, typo'd addresses, a
   * provider that drops them — and there was NO way to ask for another one.
   * supabase.auth.resend was never called anywhere in the app, so the only
   * recovery was to trigger a password reset for an account you had not
   * confirmed, or to wait and hope.
   */
  async function resend() {
    setResending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
    });
    setResending(false);
    setResent(!resendError);
    if (resendError) setError(humanError(resendError));
  }

  if (checkEmail) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
        {/* Success, so green: the account exists, it only needs confirming. */}
        <AuthResult
          icon="mail-unread-outline"
          title="Check your email"
          help="Can’t find it? Check your spam folder."
          actions={
            <>
              {error ? <Notice tone="danger" message={error} /> : null}
              <AuthButton title="Back to sign in" onPress={() => router.replace('/sign-in')} />
              <AuthButton
                variant="secondary"
                title={resent ? 'Sent again' : 'Send the link again'}
                icon={resent ? 'checkmark-circle' : undefined}
                onPress={resend}
                busy={resending}
                disabled={resent}
              />
            </>
          }>
          We sent a link to <Emphasis>{email.trim()}</Emphasis>. Open it to confirm your account,
          then come back and sign in.
        </AuthResult>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
      <KeyboardAwareScrollView contentContainerStyle={authStyles.content}>
        <AuthHeader
          icon="person-add"
          title="Create your account"
          subtitle="Each person in the house needs their own account."
        />

        <View style={authStyles.form}>
          <AuthField
            label="Your name"
            icon="person-outline"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            placeholder="Enter your name"
            editable={!busy}
            returnKeyType="next"
          />

          <AuthField
            label="Email"
            icon="mail-outline"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            onBlur={() => setEmailTouched(true)}
            {...emailOk.field}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Enter your email"
            editable={!busy}
            returnKeyType="next"
          />

          <AuthField
            label="Phone number"
            icon="call-outline"
            prefix={PHONE_PREFIX}
            value={phone}
            onChangeText={(v) => {
              setPhone(tenDigits(v));
              setPhoneTaken(false);
            }}
            onBlur={() => setPhoneTouched(true)}
            keyboardType="number-pad"
            autoComplete="tel-national"
            placeholder="Enter mobile number"
            editable={!busy}
            returnKeyType="next"
            hint={phoneHint}
            hintTone={phoneTone}
          />

          <AuthField
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            onBlur={() => setPasswordTouched(true)}
            secure
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="Create a password"
            editable={!busy}
            onSubmitEditing={register}
            returnKeyType="go"
            hint={`At least ${MIN_PASSWORD} characters`}
            hintTone={passwordOk ? 'success' : passwordShort ? 'danger' : 'neutral'}
          />

          {error ? <Notice tone="danger" message={error} /> : null}

          <View style={styles.submit}>
            <AuthButton title="Create account" onPress={register} busy={busy} disabled={!canSubmit} />
          </View>
        </View>

        <AuthSwitch prompt="Already have an account?" label="Sign in" href="/sign-in" />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  submit: { marginTop: Spacing.one },
});
