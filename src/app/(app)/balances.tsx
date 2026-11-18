import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Appear, Reveal } from '@/components/ui/motion';
import { Money } from '@/components/ui/money';
import { queryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';
import { useBalances, type Balance } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/ui/icon';

/**
 * Everyone's balance with the house: what Home's Balances cards show, for the
 * whole household -- you included, and anyone already settled.
 *
 * These are balances with the house, not with you: Vinod at + ₹527.99 is owed
 * that by the house as a whole. Who should pay whom is Settle up's job, which
 * works person to person; this screen only answers "where does everyone
 * stand?". The same figures as Home, read from the same query.
 */
export default function BalancesScreen() {
  const theme = useTheme();
  const { member } = useSession();
  const balances = useBalances();

  const all = balances.data ?? [];
  const getsBack = all.filter((b) => b.balancePaise > 0);
  const owes = all.filter((b) => b.balancePaise < 0).sort((a, b) => a.balancePaise - b.balancePaise);
  const square = all.filter((b) => b.balancePaise === 0);

  const groups: { title: string; hint: string; rows: Balance[] }[] = [
    { title: 'Gets back', hint: 'The house owes them', rows: getsBack },
    { title: 'Owes', hint: 'They owe the house', rows: owes },
    { title: 'All square', hint: 'Nothing either way', rows: square },
  ].filter((g) => g.rows.length > 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Balances" subtitle="Everyone, with the house" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {queryState(balances, 'balances') ?? null}

        {!balances.data && !balances.isError ? (
          <Card padded={false}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                <Skeleton width={40} height={40} radius={20} />
                <View style={[styles.flex, styles.skeletonText]}>
                  <Skeleton width="45%" height={12} />
                </View>
                <Skeleton width={70} height={14} />
              </View>
            ))}
          </Card>
        ) : null}

        {balances.data ? (
          <Reveal style={styles.groups}>
            {groups.map((g, gi) => (
              <Appear key={g.title} index={gi} style={styles.group}>
                <View style={styles.groupHead}>
                  <ThemedText style={styles.groupTitle}>{g.title}</ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.micro}>
                    {g.hint}
                  </ThemedText>
                </View>
                <Card padded={false}>
                  {g.rows.map((b, i) => {
                    const you = b.memberId === member?.id;
                    return (
                      <View
                        key={b.memberId}
                        accessible
                        accessibilityLabel={
                          b.balancePaise > 0
                            ? `${you ? 'You get' : `${b.displayName} gets`} back ${formatPaise(b.balancePaise)}`
                            : b.balancePaise < 0
                              ? `${you ? 'You owe' : `${b.displayName} owes`} the house ${formatPaise(-b.balancePaise)}`
                              : `${you ? 'You are' : `${b.displayName} is`} all square`
                        }
                        style={[
                          styles.row,
                          i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                        ]}>
                        <Avatar name={b.displayName} seed={b.memberId} size={40} />
                        <View style={styles.flex}>
                          <ThemedText style={[Type.body, styles.semi]} numberOfLines={1}>
                            {b.displayName}
                          </ThemedText>
                          {you ? (
                            <ThemedText style={[Type.micro, { color: theme.brandInk }]}>You</ThemedText>
                          ) : null}
                        </View>
                        {b.balancePaise === 0 ? (
                          <Icon name="checkmark-circle" size={20} color={theme.textTertiary} />
                        ) : (
                          // The same + and − and colours as Home's cards.
                          <Money
                            paise={b.balancePaise}
                            signed
                            size="row"
                            color={b.balancePaise > 0 ? theme.positive : theme.negative}
                          />
                        )}
                      </View>
                    );
                  })}
                </Card>
              </Appear>
            ))}

            {/* Where to go to actually move money. */}
            <View style={styles.note}>
              <Icon name="information-circle-outline" size={14} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
                These are balances with the whole house. Settle up shows who pays whom.
              </ThemedText>
            </View>
          </Reveal>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  groups: { gap: Spacing.four },
  group: { gap: Spacing.two },
  groupHead: { gap: 1, paddingLeft: Spacing.half },
  groupTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  skeletonText: { gap: 6 },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },
});
