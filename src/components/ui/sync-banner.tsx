import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';
import { useSync } from '@/lib/sync';

/**
 * The only honest way to run offline is to say so. A silent queue is how
 * people end up believing an expense was recorded when it wasn't.
 */
export function SyncBanner() {
  const theme = useTheme();
  const { online, pending, syncing, syncNow, retryOne, discard } = useSync();

  const blocked = pending.filter((p) => p.blocked);
  const queued = pending.filter((p) => !p.blocked);

  if (online && pending.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {blocked.map((p) => (
        <View key={p.id} style={[styles.bar, { backgroundColor: theme.dangerSoft }]}>
          <Ionicons name="alert-circle" size={16} color={theme.danger} />
          <View style={styles.flex}>
            <ThemedText style={[Type.caption, styles.semi, { color: theme.danger }]}>
              {formatPaise(p.totalPaise)} couldn&apos;t be saved
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={Type.micro}>
              {p.lastError ?? 'The server rejected it.'}
            </ThemedText>
          </View>
          <Pressable onPress={() => void retryOne(p.id)} hitSlop={8}>
            <ThemedText style={[Type.micro, { color: theme.primary, fontWeight: '700' }]}>
              Retry
            </ThemedText>
          </Pressable>
          <Pressable onPress={() => void discard(p.id)} hitSlop={8}>
            <Ionicons name="close" size={16} color={theme.textTertiary} />
          </Pressable>
        </View>
      ))}

      {!online || queued.length > 0 ? (
        <Pressable
          onPress={() => (online ? void syncNow() : undefined)}
          style={[
            styles.bar,
            { backgroundColor: online ? theme.primarySoft : theme.backgroundSunken },
          ]}>
          {syncing ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Ionicons
              name={online ? 'cloud-upload-outline' : 'cloud-offline-outline'}
              size={16}
              color={online ? theme.primary : theme.textTertiary}
            />
          )}

          <ThemedText style={[Type.caption, styles.flex]}>
            {!online
              ? queued.length > 0
                ? `Offline — ${queued.length} expense${queued.length === 1 ? '' : 's'} will send when you reconnect`
                : 'Offline — you can still add expenses'
              : syncing
                ? 'Sending…'
                : `${queued.length} waiting to send · tap to retry`}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  flex: { flex: 1 },
  semi: { fontWeight: '700' },
});
