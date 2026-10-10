import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';

/**
 * The three states every data screen actually has, and only two of which this
 * app used to draw.
 *
 * `grep isError src/` returned NOTHING before this file existed. Every screen
 * rendered `query.data ?? []` and fell through to its empty state as soon as
 * `isLoading` cleared — including after React Query exhausted `retry: 2`. So a
 * user whose session had expired, or who was on a dead connection, was told
 * "Nothing logged yet" and "All square": plausible, permanent, and wrong, with
 * no retry anywhere on screen.
 *
 * An empty state is a claim about the data. It may only be made once the data
 * has actually been read.
 */

type QueryLike = {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

/** A spinner that says what it is waiting for. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme();

  return (
    <Card style={styles.block}>
      <ActivityIndicator color={theme.primary} />
      <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
        {label}
      </ThemedText>
    </Card>
  );
}

/** A failure that says so, and offers the one thing that might fix it. */
export function LoadFailed({
  what,
  error,
  onRetry,
}: {
  /** What could not be loaded, lower case: "your expenses", "this month". */
  what: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const theme = useTheme();

  return (
    <Card style={styles.block}>
      <View style={[styles.icon, { backgroundColor: theme.dangerSoft }]}>
        <Ionicons name="cloud-offline-outline" size={20} color={theme.danger} />
      </View>
      <ThemedText style={Type.headline}>Couldn&apos;t load {what}</ThemedText>
      <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
        {error ? humanError(error) : 'Check your connection and try again.'}
      </ThemedText>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

/**
 * The whole pattern in one call, for the common case.
 *
 * Returns the block to render, or null when the data is ready and the screen
 * should draw itself:
 *
 *   const state = queryState(expenses, 'your expenses');
 *   if (state) return state;
 */
export function queryState(
  query: QueryLike,
  what: string,
  loadingLabel?: string
): React.ReactElement | null {
  if (query.isError) {
    return <LoadFailed what={what} error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.isLoading) {
    return <Loading label={loadingLabel ?? `Loading ${what}…`} />;
  }
  return null;
}

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.five },
  centered: { textAlign: 'center' },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
