import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApprovalCards, useApprovals } from '@/components/approvals';
import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Loading } from '@/components/ui/query-state';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Approvals: everything waiting for your yes or no, in one list. Home shows
 * the first two under "Needs you" and links here for the rest.
 */
export default function ApprovalsScreen() {
  const theme = useTheme();
  const approvals = useApprovals();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Approvals"
        subtitle={
          approvals.count > 0
            ? `${approvals.count} waiting for you`
            : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {approvals.loading ? (
          <Loading />
        ) : approvals.count === 0 ? (
          <Card style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
              <Icon name="checkmark-circle" size={26} color={theme.brandInk} />
            </View>
            <ThemedText style={[Type.headline, styles.center]}>All caught up</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.center]}>
              Nothing is waiting for your approval.
            </ThemedText>
          </Card>
        ) : (
          <ApprovalCards approvals={approvals} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { textAlign: 'center' },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
