import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthHeader, AuthResult, authStyles } from '@/components/auth-form';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * The first screen after signing in, for an account that is not in a
 * household yet: start one, or join one with a code.
 *
 * Deliberately router.push() on a plain Pressable rather than <Link asChild>.
 * asChild renders the child through Radix's Slot, which merges `style` by
 * flattening it as an OBJECT. A Pressable's style is a FUNCTION -- it has to
 * be, to react to `pressed` -- and flattening a function yields {}. So the
 * cards silently lost their background, border, padding and flexDirection.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { session, signOut, unreachable, refresh } = useSession();
  const [checking, setChecking] = useState(false);

  const name = (session?.user.user_metadata?.display_name as string | undefined)?.trim().split(/\s+/)[0];
  const email = session?.user.email;

  /**
   * `unreachable` means the membership read did not come back — which is NOT
   * the same as "you are in no household", and this screen must not claim the
   * second when only the first is known.
   *
   * SessionProvider now falls back to a cached membership, so an established
   * member should never land here offline at all. This is the remaining case:
   * a device with no cached row, on a dead connection. Both choices below need
   * the network, so telling them to check their signal is the only honest
   * thing on offer.
   */
  async function checkAgain() {
    setChecking(true);
    await refresh();
    setChecking(false);
  }

  if (unreachable) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
        {/* Amber, not red: nothing failed or was lost, the phone just could
            not ask. Grey button, so the screen says one thing. */}
        <AuthResult
          tone="warning"
          icon="cloud-offline-outline"
          title="Can’t reach Roomly"
          actions={
            <>
              <AuthButton variant="secondary" title="Try again" onPress={checkAgain} busy={checking} />
              <SignOutLink email={email} onPress={() => void signOut()} />
            </>
          }>
          Check your internet connection. Your household and expenses are safe — nothing has
          changed.
        </AuthResult>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.backgroundElement }]}>
      <View style={authStyles.content}>
        <AuthHeader
          icon="home"
          title={name ? `Welcome, ${name}` : 'Welcome to Roomly'}
          subtitle="Start a household for your flat, or join one a housemate has already made."
        />

        <View style={styles.options}>
          <Choice
            icon="add-circle-outline"
            title="Create a household"
            hint="Start fresh and invite your housemates."
            onPress={() => router.push('/create-household')}
          />
          <Choice
            icon="enter-outline"
            title="Join a household"
            hint="Use the invite code a housemate sent you."
            onPress={() => router.push('/join-household')}
          />
        </View>

        <SignOutLink email={email} onPress={() => void signOut()} />
      </View>
    </SafeAreaView>
  );
}

/**
 * A quiet way out at the bottom, naming the account -- someone who signed in
 * with the wrong email sees it here before creating a household with it.
 */
function SignOutLink({ email, onPress }: { email?: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.signOut}>
      {email ? (
        <ThemedText themeColor="textTertiary" style={styles.signedIn} numberOfLines={1}>
          Signed in as {email}
        </ThemedText>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10}>
        <ThemedText style={[authStyles.link, { color: theme.textSecondary }]}>Sign out</ThemedText>
      </Pressable>
    </View>
  );
}

function Choice({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.backgroundSelected,
          transform: [{ scale: pressed ? 0.99 : 1 }],
          opacity: pressed ? 0.9 : 1,
        },
      ]}>
      {/* An icon in a soft green tile, not an emoji: the same family as the
          rest of the screen, and the same on every phone. */}
      <View style={[styles.tile, { backgroundColor: theme.primarySoft }]}>
        <Ionicons name={icon} size={22} color={theme.primary} />
      </View>

      <View style={styles.cardText}>
        <ThemedText style={styles.cardTitle}>{title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.cardHint}>
          {hint}
        </ThemedText>
      </View>

      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  options: { gap: Spacing.three },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  cardHint: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  signOut: { alignItems: 'center', gap: Spacing.one },
  signedIn: { fontSize: 12.5, lineHeight: 17 },
});
