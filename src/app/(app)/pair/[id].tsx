import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exportPairStatement } from '@/lib/backup';
import { dayOf, formatRange } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { pairRouting, pairSummary } from '@/lib/pairwise';
import { useMembers, usePairwiseLedger } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Everything between you and one other person.
 *
 * Settle up shows the last three lines and a total, which answers "roughly
 * why" without turning one card into a scroll of its own. This is the rest of
 * it — and, unlike the card, every expense here opens: the row says what it
 * was, this screen says how much, and the expense itself says who paid and how
 * many ways it went.
 *
 * Reads the same usePairwiseLedger() query Settle up does, so arriving here is
 * usually instant off the cache and the two screens cannot disagree about the
 * number.
 */
export default function PairHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const members = useMembers();
  const pairwise = usePairwiseLedger(member?.id);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = pairwise.data?.pairs.find((p) => p.memberId === id);
  const them = members.data?.find((m) => m.id === id)?.displayName ?? 'They';
  const owesMe = (pair?.netPaise ?? 0) > 0;

  // The list starts at the last settle-up, so the header must not claim
  // "everything".
  const squaredAt = pairwise.data?.squaredAt;
  const squaredOn = squaredAt ? formatRange(dayOf(squaredAt), dayOf(squaredAt)) : null;

  // Signed, so the three figures on screen subtract to the number above them.
  // pairSummary() is in pairwise.ts and asserted there — the alternative is a
  // reduce() in a component that nothing can test.
  const summary = pair ? pairSummary(pair) : null;

  // How much of the payments above was never a debt between these two people.
  // Reconstructed from the pair itself, so it covers payments already in the
  // ledger — the ones somebody is staring at trying to work out why the total
  // is not zero.
  const routed = pair ? pairRouting(pair) : null;

  async function download() {
    if (!pair) return;
    setExporting(true);
    setError(null);
    const result = await exportPairStatement(pair, member?.display_name ?? 'You', them);
    setExporting(false);
    if (!result.ok) setError(result.reason);
  }

  const state = queryState(pairwise, 'this history', `Working out you and ${them}…`);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title={them}
        subtitle={squaredOn ? `Since everyone squared up on ${squaredOn}` : 'Everything between you'}
      />

      {state ? (
        <View style={styles.content}>{state}</View>
      ) : !pair ? (
        <View style={styles.content}>
          <Card style={styles.empty}>
            <Ionicons name="checkmark-done" size={22} color={theme.primary} />
            <ThemedText style={Type.headline}>Nothing between you</ThemedText>
            <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
              {squaredOn
                ? `Nothing new with ${them} since everyone squared up on ${squaredOn}.`
                : `You have not shared an expense with ${them} yet.`}
            </ThemedText>
          </Card>
        </View>
      ) : (
        <FlatList
          data={pair.lines}
          keyExtractor={(l) => `${l.kind}-${l.id}`}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              <Card style={styles.hero}>
                <Avatar name={them} seed={pair.memberId} size={44} />
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {owesMe ? `${them} owes you` : `You owe ${them}`}
                </ThemedText>
                <ThemedText
                  style={[Type.display, { color: owesMe ? theme.primary : theme.negative }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {formatPaise(Math.abs(pair.netPaise))}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.micro}>
                  {summary!.expenseCount} expense{summary!.expenseCount === 1 ? '' : 's'}
                  {summary!.settlementCount > 0
                    ? ` · ${summary!.settlementCount} payment${summary!.settlementCount === 1 ? '' : 's'}`
                    : ''}
                </ThemedText>
              </Card>

              <Card>
                <SummaryRow
                  label={`You covered for ${them}`}
                  value={`+ ${formatPaise(summary!.iCoveredPaise)}`}
                />
                <SummaryRow
                  label={`${them} covered for you`}
                  value={`− ${formatPaise(summary!.theyCoveredPaise)}`}
                />
                {summary!.settlementCount > 0 ? (
                  <SummaryRow
                    label="Payments already made"
                    value={`${summary!.settledNetPaise >= 0 ? '+' : '−'} ${formatPaise(
                      Math.abs(summary!.settledNetPaise)
                    )}`}
                  />
                ) : null}

                <View style={[styles.summaryTotal, { borderTopColor: theme.border }]}>
                  <ThemedText style={[Type.caption, styles.semi]}>
                    {owesMe ? `${them} owes you` : `You owe ${them}`}
                  </ThemedText>
                  <ThemedText
                    style={[
                      Type.caption,
                      styles.semi,
                      { color: owesMe ? theme.primary : theme.negative },
                    ]}>
                    {formatPaise(Math.abs(pair.netPaise))}
                  </ThemedText>
                </View>

                {/* Below the total on purpose. It is not a fourth term in the
                    subtraction — the routed money is already inside "Payments
                    already made". This says which part of that figure was
                    never about the two of you, which is the question the total
                    provokes and could not previously answer. */}
                {routed!.receivedPaise > 0 || routed!.sentPaise > 0 ? (
                  <View style={[styles.routed, { backgroundColor: theme.backgroundSunken }]}>
                    <Ionicons name="git-branch-outline" size={14} color={theme.textTertiary} />
                    <ThemedText themeColor="textSecondary" style={[Type.micro, styles.flex]}>
                      {routed!.receivedPaise > 0
                        ? `${formatPaise(routed!.receivedPaise)} of what ${them} paid you was routed through you for somebody else. The plan sends money to whoever clears the house in fewest transfers, so a payment can be larger than the debt between two people.`
                        : `${formatPaise(routed!.sentPaise)} of what you paid ${them} was routed through ${them} to somebody else you owed — you are not out of pocket for it.`}
                    </ThemedText>
                  </View>
                ) : null}
              </Card>

              <ThemedText themeColor="textTertiary" style={[Type.label, styles.listLabel]}>
                EVERY ONE OF THEM
              </ThemedText>
            </>
          }
          renderItem={({ item: l }) => {
            // Settlements have no detail screen of their own — the same
            // reasoning edit-history.tsx uses. An expense always opens.
            const openable = l.kind === 'expense';

            return (
              <Pressable
                disabled={!openable}
                onPress={() => router.push(`/expense/${l.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed && openable ? 0.6 : 1,
                  },
                ]}>
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor:
                        l.kind === 'settlement' ? theme.primarySoft : theme.backgroundSelected,
                    },
                  ]}>
                  <Ionicons
                    name={l.kind === 'settlement' ? 'swap-horizontal' : 'receipt-outline'}
                    size={15}
                    color={l.kind === 'settlement' ? theme.primary : theme.textSecondary}
                  />
                </View>

                <View style={styles.flex}>
                  <ThemedText style={Type.body} numberOfLines={1}>
                    {l.description || l.categoryName}
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
                    {formatRange(l.date, l.date)} ·{' '}
                    {l.kind === 'settlement'
                      ? l.iPaid
                        ? 'you paid them'
                        : 'they paid you'
                      : `${l.iPaid ? 'you' : them} paid ${formatPaise(l.totalPaise)}`}
                  </ThemedText>

                  {/* The payment, split into the part that settled something
                      between these two and the part that was passing through.
                      Only shown when there IS a routed part — on an ordinary
                      settle-up this line would be noise on every row. */}
                  {l.kind === 'settlement' && (l.routedPaise ?? 0) > 0 ? (
                    <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={2}>
                      {formatPaise(l.directPaise!)} settled up ·{' '}
                      <ThemedText style={[Type.micro, { color: theme.warning }]}>
                        {formatPaise(l.routedPaise!)} routed for somebody else
                      </ThemedText>
                    </ThemedText>
                  ) : null}
                </View>

                <ThemedText
                  style={[
                    Type.amount,
                    { color: l.deltaPaise >= 0 ? theme.primary : theme.negative },
                  ]}>
                  {l.deltaPaise >= 0 ? '+' : '−'}
                  {formatPaise(Math.abs(l.deltaPaise))}
                </ThemedText>

                {openable ? (
                  <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
                ) : null}
              </Pressable>
            );
          }}
          ListFooterComponent={
            <View style={styles.footer}>
              {error ? <Notice tone="danger" message={error} /> : null}

              <Button
                title={exporting ? 'Preparing…' : 'Download as CSV'}
                variant="secondary"
                loading={exporting}
                onPress={() => void download()}
              />
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.centered]}>
                Every line above, with the running total — the file to send when somebody asks
                &ldquo;since when?&rdquo;
              </ThemedText>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <ThemedText themeColor="textSecondary" style={[Type.micro, styles.flex]} numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText style={Type.caption}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.two },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },

  hero: { alignItems: 'center', gap: Spacing.one },
  semi: { fontWeight: '700' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  summaryTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    marginTop: Spacing.one,
  },
  listLabel: { paddingTop: Spacing.three },
  routed: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: { gap: Spacing.two, paddingTop: Spacing.four },
});
