import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { queryState } from '@/components/ui/query-state';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exportPairStatement } from '@/lib/backup';
import { dayLabel, dayOf } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { pairRouting, pairSummary, type PairLine } from '@/lib/pairwise';
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
 *
 * Laid out like History: the lines grouped by day, one card per day.
 */
export default function PairHistoryScreen() {
  const theme = useTheme();
  const dialog = useDialog();
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
  // "10 Oct", always a date: "Since Today" reads as a mistake.
  const squaredOn = squaredAt
    ? new Date(`${dayOf(squaredAt)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  // Signed, so the three figures on screen subtract to the number above them.
  // pairSummary() is in pairwise.ts and asserted there — the alternative is a
  // reduce() in a component that nothing can test.
  const summary = pair ? pairSummary(pair) : null;

  // How much of the payments below was never a debt between these two people.
  // Reconstructed from the pair itself, so it covers payments already in the
  // ledger — the ones somebody is staring at trying to work out why the total
  // is not zero.
  const routed = pair ? pairRouting(pair) : null;
  const routedTotal = routed ? routed.receivedPaise + routed.sentPaise : 0;

  // Consecutive lines on the same date, in the order the ledger gives them.
  const days: { day: string; lines: PairLine[] }[] = [];
  for (const l of pair?.lines ?? []) {
    const last = days[days.length - 1];
    if (last && last.day === l.date) last.lines.push(l);
    else days.push({ day: l.date, lines: [l] });
  }

  async function download() {
    if (!pair) return;
    setExporting(true);
    setError(null);
    const result = await exportPairStatement(pair, member?.display_name ?? 'You', them);
    setExporting(false);
    if (!result.ok) setError(result.reason);
  }

  function explainRouting() {
    if (!routed) return;
    void dialog.alert({
      tone: 'info',
      icon: 'git-branch-outline',
      title: 'Passing through',
      message:
        routed.receivedPaise > 0
          ? `${formatPaise(routed.receivedPaise)} of what ${them} paid you was routed through you for somebody else. The plan sends money to whoever clears the house in fewest transfers, so a payment can be larger than the debt between two people.`
          : `${formatPaise(routed.sentPaise)} of what you paid ${them} was routed through ${them} to somebody else you owed — you are not out of pocket for it.`,
    });
  }

  const state = queryState(pairwise, 'this history', `Working out you and ${them}…`);
  const tone = owesMe ? theme.primary : theme.negative;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Download as an icon beside the title: a full-width button and a
          paragraph under the list was the loudest thing on a screen of
          numbers. */}
      <ScreenHeader
        title={them}
        subtitle={squaredOn ? `Since ${squaredOn}` : undefined}
        action={
          pair ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Download as CSV"
              accessibilityState={{ busy: exporting }}
              disabled={exporting}
              onPress={() => void download()}
              hitSlop={6}
              style={({ pressed }) => [
                styles.headerIcon,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
              ]}>
              {exporting ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <Ionicons name="download-outline" size={18} color={theme.text} />
              )}
            </Pressable>
          ) : undefined
        }
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
          data={days}
          keyExtractor={(d) => d.day}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              {/* On the page, not in a card -- as on Expense details. */}
              <View style={styles.hero}>
                <Avatar name={them} seed={pair.memberId} size={52} />
                <ThemedText themeColor="textSecondary" style={Type.caption}>
                  {owesMe ? `${them} owes you` : `You owe ${them}`}
                </ThemedText>
                <ThemedText
                  style={[styles.heroAmount, { color: tone }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {formatPaise(Math.abs(pair.netPaise))}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.caption}>
                  {summary!.expenseCount} bill{summary!.expenseCount === 1 ? '' : 's'}
                  {summary!.settlementCount > 0
                    ? ` · ${summary!.settlementCount} payment${summary!.settlementCount === 1 ? '' : 's'}`
                    : ''}
                </ThemedText>
              </View>

              {/* The working: these subtract to the number above. */}
              <Card padded={false}>
                <SummaryRow
                  label={`You covered for ${them}`}
                  value={`+ ${formatPaise(summary!.iCoveredPaise)}`}
                  color={theme.primary}
                  first
                />
                <SummaryRow
                  label={`${them} covered for you`}
                  value={`− ${formatPaise(summary!.theyCoveredPaise)}`}
                  color={theme.negative}
                />
                {summary!.settlementCount > 0 ? (
                  <SummaryRow
                    label="Payments"
                    value={`${summary!.settledNetPaise >= 0 ? '+' : '−'} ${formatPaise(
                      Math.abs(summary!.settledNetPaise)
                    )}`}
                    color={summary!.settledNetPaise >= 0 ? theme.primary : theme.negative}
                  />
                ) : null}
                <SummaryRow
                  label={owesMe ? `${them} owes you` : 'You owe'}
                  value={formatPaise(Math.abs(pair.netPaise))}
                  color={tone}
                  bold
                />
              </Card>

              {/* Not a fourth term in the subtraction -- the routed money is
                  already inside "Payments". One line; the why is a tap away. */}
              {routedTotal > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={explainRouting}
                  style={({ pressed }) => [
                    styles.note,
                    { backgroundColor: theme.backgroundSunken, opacity: pressed ? 0.7 : 1 },
                  ]}>
                  <Ionicons name="git-branch-outline" size={15} color={theme.textSecondary} />
                  <ThemedText themeColor="textSecondary" style={[Type.caption, styles.flex]}>
                    {formatPaise(routedTotal)} passed through for others
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
                </Pressable>
              ) : null}

              {error ? <Notice tone="danger" message={error} /> : null}
            </View>
          }
          renderItem={({ item: group }) => (
            <View style={styles.day}>
              <ThemedText style={styles.dayTitle}>{dayLabel(group.day)}</ThemedText>
              <Card padded={false}>
                {group.lines.map((l, i) => (
                  <Line
                    key={`${l.kind}-${l.id}`}
                    line={l}
                    them={them}
                    first={i === 0}
                    onOpen={() => router.push(`/expense/${l.id}`)}
                  />
                ))}
              </Card>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

/** One expense or payment between the two of you. */
function Line({
  line: l,
  them,
  first,
  onOpen,
}: {
  line: PairLine;
  them: string;
  first: boolean;
  onOpen: () => void;
}) {
  const theme = useTheme();

  // Settlements have no detail screen of their own — the same reasoning
  // edit-history.tsx uses. An expense always opens.
  const openable = l.kind === 'expense';
  const payment = l.kind === 'settlement';
  const routedPart = payment ? (l.routedPaise ?? 0) : 0;

  const title = payment ? (l.iPaid ? `You paid ${them}` : `${them} paid you`) : l.description || l.categoryName;
  const sub = payment ? 'Payment' : `${l.iPaid ? 'You' : them} paid ${formatPaise(l.totalPaise)}`;
  const amount = `${l.deltaPaise >= 0 ? '+' : '−'} ${formatPaise(Math.abs(l.deltaPaise))}`;

  return (
    <Pressable
      disabled={!openable}
      onPress={onOpen}
      accessibilityRole={openable ? 'button' : 'text'}
      accessibilityLabel={
        `${title}, ${sub}, ${amount}` +
        (routedPart > 0
          ? `. ${formatPaise(l.directPaise ?? 0)} settled up, ${formatPaise(routedPart)} routed for somebody else`
          : '')
      }
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        { opacity: pressed && openable ? 0.6 : 1 },
      ]}>
      <View
        style={[styles.icon, { backgroundColor: payment ? theme.primarySoft : theme.backgroundSelected }]}>
        <Ionicons
          name={payment ? 'swap-horizontal' : 'receipt-outline'}
          size={15}
          color={payment ? theme.primary : theme.textSecondary}
        />
      </View>

      <View style={styles.flex}>
        <ThemedText style={Type.body} numberOfLines={1}>
          {title}
        </ThemedText>
        <View style={styles.subRow}>
          <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
            {sub}
          </ThemedText>
          {/* Yellow: part of this payment was somebody else's debt, which is
              why the total above is not what you might expect. */}
          {routedPart > 0 ? (
            <View style={[styles.tag, { backgroundColor: theme.warningSoft }]}>
              <ThemedText style={[styles.tagText, { color: theme.warning }]}>
                {formatPaise(routedPart)} for others
              </ThemedText>
            </View>
          ) : null}
        </View>
      </View>

      <ThemedText style={[Type.amount, { color: l.deltaPaise >= 0 ? theme.primary : theme.negative }]}>
        {amount}
      </ThemedText>
    </Pressable>
  );
}

function SummaryRow({
  label,
  value,
  color,
  first = false,
  bold = false,
}: {
  label: string;
  value: string;
  color: string;
  first?: boolean;
  bold?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.summaryRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
      ]}>
      <ThemedText
        themeColor={bold ? 'text' : 'textSecondary'}
        style={[Type.body, styles.flex, bold && styles.bold]}
        numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText style={[Type.body, bold && styles.bold, { color }]}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  bold: { fontWeight: '600' },

  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  header: { gap: Spacing.three },
  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  heroAmount: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -1 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },

  day: { gap: Spacing.two },
  // Sentence case at heading size, as on History.
  dayTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tag: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },
  tagText: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
});
