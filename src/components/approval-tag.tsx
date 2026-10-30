import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ApprovalStatus } from '@/lib/queries';

/**
 * "Waiting" or "Rejected" on an expense row, so a figure that does not count
 * (migration 0039) never reads as one that does. Yellow for waiting on
 * someone, as Home's notes are; red for rejected. Nothing for approved.
 */
export function ApprovalTag({ status }: { status: ApprovalStatus }) {
  const theme = useTheme();
  if (status === 'approved') return null;

  const waiting = status === 'pending';
  const ink = waiting ? theme.warning : theme.danger;

  return (
    <View
      accessible
      accessibilityLabel={waiting ? 'Waiting for approval' : 'Rejected'}
      style={[styles.tag, { backgroundColor: waiting ? theme.warningSoft : theme.dangerSoft }]}>
      <Ionicons name={waiting ? 'time-outline' : 'close-circle-outline'} size={11} color={ink} />
      <ThemedText style={[styles.text, { color: ink }]}>{waiting ? 'Waiting' : 'Rejected'}</ThemedText>
    </View>
  );
}

/**
 * The amount's style beside a tag: grey while waiting, struck when rejected.
 * A plain function, not a hook, so a list can call it per row.
 */
export function approvalAmountStyle(theme: ReturnType<typeof useTheme>, status: ApprovalStatus) {
  if (status === 'pending') return { color: theme.textTertiary };
  if (status === 'rejected') return [{ color: theme.textTertiary }, styles.struck];
  return null;
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  text: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  struck: { textDecorationLine: 'line-through' },
});
