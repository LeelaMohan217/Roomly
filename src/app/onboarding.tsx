import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * Deliberately router.push() on a plain Pressable rather than <Link asChild>.
 *
 * asChild renders the child through Radix's Slot, which merges `style` by
 * flattening it as an OBJECT. A Pressable's style is a FUNCTION -- it has to
 * be, to react to `pressed` -- and flattening a function yields {}. So the
 * cards silently lost their background, border, padding and flexDirection,
 * which is why nothing but the emoji was visible in either theme.
 *
 * Every other tappable card in this app already uses router.push on a plain
 * Pressable. This screen was the odd one out.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { signOut, unreachable, refresh } = useSession();
  const [checking, setChecking] = useState(false);

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
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.content}>
          <View style={styles.header}>
            <ThemedText style={Type.display}>Can&apos;t reach Roomly</ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.body}>
              We couldn&apos;t check which household you&apos;re in. This is a connection problem,
              not a sign you&apos;ve been removed — nothing has changed.
            </ThemedText>
          </View>

          <Button title="Try again" onPress={checkAgain} loading={checking} />
          <Button
            title="Sign out"
            variant="ghost"
            onPress={() => void signOut()}
            disabled={checking}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <ThemedText style={Type.display}>You&apos;re in</ThemedText>
          <ThemedText themeColor="textSecondary" style={Type.body}>
            One more step — join a household or start one.
          </ThemedText>
        </View>

        <View style={styles.options}>
          <Choice
            emoji="🏠"
            title="Create a household"
            hint="You'll be the owner"
            onPress={() => router.push('/create-household')}
          />
          <Choice
            emoji="🔑"
            title="Join with an invite code"
            hint="A friend sent you a code"
            onPress={() => router.push('/join-household')}
          />
        </View>

        <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </SafeAreaView>
  );
}

function Choice({
  emoji,
  title,
  hint,
  onPress,
}: {
  emoji: string;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <View style={[styles.glyph, { backgroundColor: theme.primarySoft }]}>
        <ThemedText style={styles.emoji}>{emoji}</ThemedText>
      </View>

      <View style={styles.cardText}>
        <ThemedText style={styles.cardTitle}>{title}</ThemedText>
        <ThemedText themeColor="textTertiary" style={Type.caption}>
          {hint}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.five,
  },
  header: { gap: Spacing.one },
  options: { gap: Spacing.three },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
  },
  // A tinted tile rather than a bare glyph, so the row reads as a control
  // instead of a stray character floating on the page.
  glyph: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22, lineHeight: 28 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15.5, lineHeight: 21, fontWeight: '700', letterSpacing: -0.2 },
});
