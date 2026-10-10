import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DonutChart, type Slice } from '@/components/charts/donut-chart';
import { ThemedText } from '@/components/themed-text';
import { HomeHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { Appear } from '@/components/ui/appear';
import { QuickActions } from '@/components/ui/quick-actions';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise } from '@/lib/money';
import {
  useAwayPeriods,
  useBalances,
  useExpenses,
  useMembers,
  useMonthlyTotals,
  usePendingChanges,
  useRecurring,
  useSpendSummary,
} from '@/lib/queries';
import { useSession } from '@/lib/session';
import { isPresent } from '@/lib/split';
import { supabase } from '@/lib/supabase';
import { useSync } from '@/lib/sync';

type JoinRequest = {
  id: string;
  display_name: string;
  email: string | null;
  claim_member_id: string | null;
};

/**
 * The current page's dot stretches into a pill.
 *
 * Through useAnimatedStyle rather than putting withTiming() straight into a
 * style object: reanimated only evaluates animations inside an animated style,
 * and an animation object in a plain style resolves to width 0 -- which made
 * both dots vanish rather than fail loudly. Shape as well as colour, so the
 * current page is still obvious on a dim screen or to a colourblind eye.
 */
function PagerDot({ active }: { active: boolean }) {
  const theme = useTheme();
  const animated = useAnimatedStyle(() => ({
    width: withTiming(active ? 16 : 6, { duration: 180 }),
  }));

  return (
    <Animated.View
      style={[
        styles.dotNav,
        { backgroundColor: active ? theme.textSecondary : theme.border },
        animated,
      ]}
    />
  );
}

function Trend({
  current,
  previous,
  period,
}: {
  current: number;
  previous: number;
  period: 'week' | 'month';
}) {
  const theme = useTheme();

  const pill = (icon: 'trending-up' | 'trending-down' | 'remove-outline', tint: string, text: string) => (
    <View style={[styles.heroPill, { backgroundColor: theme.heroChip }]}>
      <Ionicons name={icon} size={12} color={tint} />
      <ThemedText style={[Type.micro, { color: theme.onHero }]}>{text}</ThemedText>
    </View>
  );

  if (previous === 0) {
    // Both zero is a genuine "no change" -- 0% is true there.
    return current === 0
      ? pill('remove-outline', theme.onHeroMuted, `0% vs last ${period}`)
      : pill('remove-outline', theme.onHeroMuted, `first ${period}`);
  }

  const delta = Math.round(((current - previous) / previous) * 100);

  if (delta === 0) return pill('remove-outline', theme.onHeroMuted, `0% vs last ${period}`);

  return pill(
    delta > 0 ? 'trending-up' : 'trending-down',
    delta > 0 ? theme.heroUp : theme.heroAccent,
    `${Math.abs(delta)}% vs last ${period}`
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const { pending } = useSync();
  const { width: windowWidth } = useWindowDimensions();
  const [card, setCard] = useState(0);
  const isOwner = member?.role === 'owner';

  const members = useMembers();
  const balances = useBalances();
  const expenses = useExpenses(4);
  const away = useAwayPeriods();
  const changes = usePendingChanges();
  const totals = useMonthlyTotals();
  const recurring = useRecurring();
  const spend = useSpendSummary(member?.id);

  /**
   * Post any due recurring expenses. There's no cron — this fires when
   * someone opens the app.
   *
   * It is safe to run from every member's device: post_recurring_now() claims
   * the (rule, year, month) row BEFORE writing anything, so a second caller
   * returns the first one's expense instead of adding a duplicate rent charge.
   * That claim-first ordering is migration 0023 — until then the expense was
   * written first and the conflict was swallowed, which is exactly how two
   * phones at breakfast produced two rents.
   *
   * On foreground, not once per process. A `useRef` guard fired only on the
   * first mount, so an Android process that survived several days across a due
   * date never posted at all until it was killed.
   */
  const [recurringError, setRecurringError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;

    async function postDue() {
      const { data, error } = await supabase.rpc('post_due_recurrences');
      // Previously `const { data } = await ...` — so offline, or refused, rent
      // silently failed to post and nobody ever learned why.
      if (error) {
        setRecurringError(humanError(error));
        return;
      }
      setRecurringError(null);
      if (typeof data === 'number' && data > 0) {
        void queryClient.invalidateQueries();
      }
    }

    void postDue();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void postDue();
    });
    return () => sub.remove();
  }, [member, queryClient]);

  const household = useQuery({
    queryKey: ['household', member?.household_id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('households')
        .select('name')
        .eq('id', member!.household_id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const requests = useQuery({
    queryKey: ['join-requests'],
    enabled: !!member && isOwner,
    queryFn: async (): Promise<JoinRequest[]> => {
      const { data, error } = await supabase
        .from('join_requests')
        .select('id, display_name, email, claim_member_id')
        .eq('status', 'pending')
        .order('requested_at');
      if (error) throw error;
      return data as JoinRequest[];
    },
  });

  const reviewChange = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_pending_change', {
        p_change: id,
        p_approve: approve,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  const reviewJoin = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_join_request', {
        p_request: id,
        p_approve: approve,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  const myBalance = balances.data?.find((b) => b.memberId === member?.id)?.balancePaise ?? 0;
  const today = todayIso();
  const awayToday = (members.data ?? []).filter(
    (m) => away.data && !isPresent(m.id, today, away.data)
  );
  const approvalCount = (requests.data?.length ?? 0) + (changes.data?.length ?? 0);
  const dueForAmount = (recurring.data ?? []).filter(
    (r) => r.isDue && r.mode === 'confirm'
  ).length;

  const now = new Date();

  // The header greets you instead of showing the logo — you know which app you
  // opened; what you don't know is what day it is and where you stand.
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (member?.display_name ?? '').trim().split(/\s+/)[0] || 'there';
  const dateLabel = now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const monthName = now.toLocaleDateString('en-IN', { month: 'long' });

  // The pager lives inside the screen's horizontal padding, so a page is the
  // content width -- that keeps both cards aligned with everything below them.
  const cardWidth = windowWidth - Spacing.four * 2;
  const pageStride = cardWidth + Spacing.three;

  const monthRows = (totals.data ?? []).filter(
    (t) => t.year === now.getFullYear() && t.month === now.getMonth() + 1
  );
  const monthTotal = monthRows.reduce((sum, r) => sum + r.totalPaise, 0);

  const palette = [theme.chart1, theme.chart2, theme.chart3, theme.chart4, theme.chart5, theme.chart6];
  // Not hand-memoized: React Compiler is enabled (app.json), and it could not
  // preserve a useMemo whose deps are rebuilt every render -- it reported
  // "Compilation Skipped", meaning the whole file went un-optimised to keep a
  // memo that was not helping. Plain derivation lets the compiler do it.
  const slices: Slice[] = [...monthRows]
    .sort((a, b) => b.totalPaise - a.totalPaise)
    .slice(0, 6)
    .map((r, i) => ({ key: r.categoryId, value: r.totalPaise, color: palette[i % palette.length] }));
  const legend = [...monthRows].sort((a, b) => b.totalPaise - a.totalPaise).slice(0, 4);

  // The biggest slice is what the ring is actually saying. It goes in the hole
  // so the chart explains itself without reading the legend.
  const topSlice = legend[0];
  const topShare = topSlice && monthTotal > 0
    ? Math.round((topSlice.totalPaise / monthTotal) * 100)
    : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <HomeHeader
        overline={dateLabel}
        title={`${greeting}, ${firstName}`}
        badge={isOwner ? approvalCount : 0}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={balances.isFetching || expenses.isFetching}
            onRefresh={() => void queryClient.invalidateQueries()}
            tintColor={theme.textSecondary}
          />
        }>
        {/* Recurring bills post from whoever opens the app first. When that
            call fails there is nothing else in the UI that would ever mention
            it, so rent quietly does not appear. */}
        {recurringError ? (
          <View style={[styles.recurringError, { backgroundColor: theme.backgroundSunken }]}>
            <Ionicons name="alert-circle-outline" size={15} color={theme.textTertiary} />
            <ThemedText themeColor="textTertiary" style={[Type.micro, styles.recurringErrorText]}>
              Could not post recurring bills. {recurringError}
            </ThemedText>
          </View>
        ) : null}

        {/* Deep and calm. One saturated fill on a screen is a highlight; two
            is noise, and a full-bleed bright one is neither. */}
        {/* Two cards, swiped, rather than one card carrying six numbers.
            Each answers exactly one question: what did the room spend, and
            where do I stand in it.
 
            Both follow the same shape, so swiping does not rearrange the
            layout under you:
 
              household . people chip
              label
              BIG NUMBER
              --------------------------
              secondary label . value
              trend pills
 
            The pills sit below the rule on BOTH cards rather than under the
            big number. On card two the big number is a balance -- a position,
            not a flow -- so a percentage change on it would be meaningless,
            and pills adjacent to it would be read as describing it. Keeping
            them at the bottom attaches them to the spend figures on both
            cards, and keeps the two structures identical. */}
        <Appear style={styles.pagerWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={pageStride}
            snapToAlignment="start"
            decelerationRate="fast"
            // Momentum end rather than onScroll: the dots only care about the
            // settled page, and a scroll handler would re-render every frame.
            onMomentumScrollEnd={(e) =>
              setCard(Math.round(e.nativeEvent.contentOffset.x / pageStride))
            }
            contentContainerStyle={styles.pager}>
            {/* ---------------- what the room spent ---------------- */}
            <LinearGradient
              colors={[theme.heroFrom, theme.heroTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, { width: cardWidth }]}>
              <View style={styles.heroTop}>
                <ThemedText style={[Type.caption, { color: theme.onHeroMuted }]}>
                  {household.data?.name ?? '…'}
                </ThemedText>
                <View style={[styles.heroChip, { backgroundColor: theme.heroChip }]}>
                  <Ionicons name="people" size={11} color={theme.onHero} />
                  <ThemedText style={[Type.micro, { color: theme.onHero }]}>
                    {members.data?.length ?? 0}
                  </ThemedText>
                </View>
              </View>

              <ThemedText style={[Type.micro, styles.heroLabel, { color: theme.onHeroMuted }]}>
                Total spend in {monthName}
              </ThemedText>
              <ThemedText style={[Type.display, { color: theme.onHero }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {formatPaise(spend.data?.roomMonthPaise ?? 0)}
              </ThemedText>

              <View style={[styles.heroFoot, { borderTopColor: theme.heroRule }]}>
                <ThemedText style={[Type.micro, { color: theme.onHeroMuted }]}>This week</ThemedText>
                <ThemedText style={[styles.heroFootValue, { color: theme.onHero }]}>
                  {formatPaise(spend.data?.roomWeekPaise ?? 0)}
                </ThemedText>
              </View>

              <View style={styles.heroTrends}>
                <Trend
                  current={spend.data?.roomWeekPaise ?? 0}
                  previous={spend.data?.roomPrevWeekPaise ?? 0}
                  period="week"
                />
                <Trend
                  current={spend.data?.roomMonthPaise ?? 0}
                  previous={spend.data?.roomPrevMonthPaise ?? 0}
                  period="month"
                />
              </View>
            </LinearGradient>

            {/* ---------------- where you stand ---------------- */}
            <LinearGradient
              colors={[theme.heroFrom, theme.heroTo]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, { width: cardWidth }]}>
              <View style={styles.heroTop}>
                <ThemedText style={[Type.caption, { color: theme.onHeroMuted }]}>
                  {household.data?.name ?? '…'}
                </ThemedText>
                <View style={[styles.heroChip, { backgroundColor: theme.heroChip }]}>
                  <Ionicons name="people" size={11} color={theme.onHero} />
                  <ThemedText style={[Type.micro, { color: theme.onHero }]}>
                    {members.data?.length ?? 0}
                  </ThemedText>
                </View>
              </View>

              <ThemedText style={[Type.micro, styles.heroLabel, { color: theme.onHeroMuted }]}>
                {myBalance > 0
                  ? 'The house owes you'
                  : myBalance < 0
                    ? 'You owe the house'
                    : 'Everyone is square'}
              </ThemedText>
              <ThemedText style={[Type.display, { color: theme.onHero }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {formatPaise(Math.abs(myBalance))}
              </ThemedText>

              <View style={[styles.heroFoot, { borderTopColor: theme.heroRule }]}>
                <ThemedText style={[Type.micro, { color: theme.onHeroMuted }]}>
                  Your share of {monthName}
                </ThemedText>
                <ThemedText style={[styles.heroFootValue, { color: theme.onHero }]}>
                  {formatPaise(spend.data?.myMonthPaise ?? 0)}
                </ThemedText>
              </View>

              <View style={styles.heroTrends}>
                <Trend
                  current={spend.data?.myWeekPaise ?? 0}
                  previous={spend.data?.myPrevWeekPaise ?? 0}
                  period="week"
                />
                <Trend
                  current={spend.data?.myMonthPaise ?? 0}
                  previous={spend.data?.myPrevMonthPaise ?? 0}
                  period="month"
                />
              </View>
            </LinearGradient>
          </ScrollView>

          <View style={styles.dots}>
            {[0, 1].map((i) => (
              <PagerDot key={i} active={i === card} />
            ))}
          </View>
        </Appear>

        <Appear delay={60}>
        <QuickActions
          actions={[
            {
              key: 'add',
              icon: 'add',
              label: 'Add',
              accent: true,
              onPress: () => router.push('/add-expense'),
            },
            {
              key: 'settle',
              icon: 'swap-horizontal',
              label: 'Settle',
              onPress: () => router.push('/settle'),
            },
            { key: 'away', icon: 'airplane', label: 'Away', onPress: () => router.push('/away') },
            {
              key: 'people',
              icon: 'people',
              label: 'People',
              onPress: () => router.push('/household'),
            },
          ]}
        />
        </Appear>

        {awayToday.length > 0 ? (
          <Pressable onPress={() => router.push('/away')}>
            <Card padded={false} style={[styles.banner, { backgroundColor: theme.warningSoft }]}>
              <Ionicons name="airplane-outline" size={16} color={theme.warning} />
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.flex]}>
                <ThemedText style={[Type.caption, styles.semi]}>
                  {awayToday.map((m) => m.displayName).join(', ')}
                </ThemedText>{' '}
                away — day-to-day costs split without them
              </ThemedText>
            </Card>
          </Pressable>
        ) : null}

        {/* Varying bills can't be auto-posted, so they surface here rather
            than silently not happening. */}
        {dueForAmount > 0 ? (
          <Pressable onPress={() => router.push('/recurring')}>
            <Card padded={false} style={[styles.banner, { backgroundColor: theme.primarySoft }]}>
              <Ionicons name="repeat" size={16} color={theme.primary} />
              <ThemedText style={[Type.caption, styles.flex]}>
                {dueForAmount} recurring bill{dueForAmount === 1 ? '' : 's'} need
                {dueForAmount === 1 ? 's' : ''} an amount
              </ThemedText>
              <Ionicons name="chevron-forward" size={15} color={theme.primary} />
            </Card>
          </Pressable>
        ) : null}

        {isOwner && approvalCount > 0 ? (
          <Section title="NEEDS YOU" count={approvalCount}>
            {changes.data?.map((c) => (
              <Card key={c.id} style={styles.approval}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/expense/[id]', params: { id: c.entityId } })
                  }>
                  <ThemedText style={Type.headline}>
                    {c.requestedByName} wants to{' '}
                    {c.kind === 'void' ? 'delete an expense' : 'change an expense'}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" style={Type.caption}>
                    {c.kind === 'update' && typeof c.payload.total_paise === 'number'
                      ? `New amount ${formatPaise(c.payload.total_paise)} · tap to review`
                      : 'Tap to review'}
                  </ThemedText>
                </Pressable>
                <View style={styles.approvalActions}>
                  <Button
                    title="Approve"
                    onPress={() => reviewChange.mutate({ id: c.id, approve: true })}
                    loading={reviewChange.isPending}
                    style={styles.flex}
                  />
                  <Button
                    title="Reject"
                    variant="ghost"
                    onPress={() => reviewChange.mutate({ id: c.id, approve: false })}
                    disabled={reviewChange.isPending}
                    style={styles.flex}
                  />
                </View>
              </Card>
            ))}

            {requests.data?.map((r) => (
              <Card key={r.id} style={styles.approval}>
                <View style={styles.approvalHead}>
                  <Avatar name={r.display_name} seed={r.id} size={36} />
                  <View style={styles.flex}>
                    <ThemedText style={Type.headline}>{r.display_name} wants to join</ThemedText>
                    <ThemedText themeColor="textSecondary" style={Type.caption}>
                      {r.email ?? 'no email'}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.approvalActions}>
                  <Button
                    title="Approve"
                    onPress={() => reviewJoin.mutate({ id: r.id, approve: true })}
                    loading={reviewJoin.isPending}
                    style={styles.flex}
                  />
                  <Button
                    title="Reject"
                    variant="ghost"
                    onPress={() => reviewJoin.mutate({ id: r.id, approve: false })}
                    disabled={reviewJoin.isPending}
                    style={styles.flex}
                  />
                </View>
              </Card>
            ))}
          </Section>
        ) : null}

        {monthTotal > 0 ? (
          <Section
            title="THIS MONTH"
            action={
              <Pressable onPress={() => router.push('/reports')} hitSlop={8}>
                <ThemedText style={[Type.micro, { color: theme.primary, fontWeight: '700' }]}>
                  Reports
                </ThemedText>
              </Pressable>
            }>
            <Card style={styles.spendCard}>
              {/* The total sits at the top of the card with the full width to
                  itself. It was in the donut hole, where a rupee amount with
                  paise had to shrink to 14px to fit -- making the headline
                  figure the smallest number on the card. */}
              <View style={styles.spendHead}>
                <ThemedText themeColor="textTertiary" style={Type.label}>
                  SPENT
                </ThemedText>
                <ThemedText style={styles.spendTotal} numberOfLines={1}>
                  {formatPaise(monthTotal)}
                </ThemedText>
              </View>

              <View style={styles.spend}>
                <DonutChart
                  data={slices}
                  size={112}
                  thickness={14}
                  caption={topSlice?.categoryName}
                  value={topShare !== null ? `${topShare}%` : undefined}
                />
                <View style={styles.legend}>
                  {legend.map((r, i) => (
                    <View key={r.categoryId} style={styles.legendRow}>
                      <View style={[styles.dot, { backgroundColor: palette[i % palette.length] }]} />
                      <ThemedText
                        themeColor="textSecondary"
                        style={[Type.caption, styles.flex]}
                        numberOfLines={1}>
                        {r.categoryName}
                      </ThemedText>
                      <ThemedText style={Type.caption}>
                        {Math.round((r.totalPaise / monthTotal) * 100)}%
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          </Section>
        ) : null}

        <Section
          // No "Manage" link: the People quick action above goes to the same
          // screen, and two doors to one place on a single screen is just
          // something else to read.
          title="BALANCES">
          <Card padded={false}>
            {balances.data?.map((b, i) => (
              <View
                key={b.memberId}
                style={[
                  styles.row,
                  i < (balances.data?.length ?? 0) - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.border,
                  },
                ]}>
                <Avatar name={b.displayName} seed={b.memberId} size={36} />
                <View style={styles.flex}>
                  <ThemedText style={Type.body} numberOfLines={1}>
                    {b.displayName}
                    {b.memberId === member?.id ? ' (you)' : ''}
                  </ThemedText>
                  <ThemedText themeColor="textTertiary" style={Type.micro}>
                    {b.balancePaise > 0
                      ? 'gets back'
                      : b.balancePaise < 0
                        ? 'owes the house'
                        : 'settled up'}
                  </ThemedText>
                </View>
                <ThemedText
                  style={[
                    Type.amount,
                    {
                      color:
                        b.balancePaise > 0
                          ? theme.positive
                          : b.balancePaise < 0
                            ? theme.negative
                            : theme.textTertiary,
                    },
                  ]}>
                  {b.balancePaise === 0
                    ? '—'
                    : `${b.balancePaise > 0 ? '+' : '−'}${formatPaise(Math.abs(b.balancePaise))}`}
                </ThemedText>
              </View>
            ))}
          </Card>
        </Section>

        <Section
          title="RECENT"
          action={
            expenses.data && expenses.data.length > 0 ? (
              <Pressable onPress={() => router.push('/history')} hitSlop={8}>
                <ThemedText style={[Type.micro, { color: theme.primary, fontWeight: '700' }]}>
                  See all
                </ThemedText>
              </Pressable>
            ) : null
          }>
          {(expenses.data && expenses.data.length > 0) || pending.length > 0 ? (
            <Card padded={false}>
              {/* Queued entries sit at the top marked as sending, so what you
                  just typed is visibly there rather than seeming lost. */}
              {pending.map((p) => (
                <View
                  key={p.id}
                  style={[
                    styles.row,
                    { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
                  ]}>
                  <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText allowFontScaling={false} style={styles.tileGlyph}>{iconFor(p.categoryIcon)}</ThemedText>
                  </View>
                  <View style={styles.flex}>
                    <ThemedText style={Type.body} numberOfLines={1}>
                      {p.description || p.categoryName}
                    </ThemedText>
                    <View style={styles.pendingRow}>
                      <Ionicons
                        name={p.blocked ? 'alert-circle' : 'cloud-upload-outline'}
                        size={11}
                        color={p.blocked ? theme.danger : theme.textTertiary}
                      />
                      <ThemedText
                        themeColor={p.blocked ? 'text' : 'textTertiary'}
                        style={[Type.micro, p.blocked && { color: theme.danger }]}>
                        {p.blocked ? 'not saved' : 'sending…'}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText themeColor="textTertiary" style={Type.amount}>
                    {formatPaise(p.totalPaise)}
                  </ThemedText>
                </View>
              ))}

              {expenses.data?.map((e, i) => (
                <Pressable
                  key={e.id}
                  onPress={() => router.push({ pathname: '/expense/[id]', params: { id: e.id } })}
                  style={({ pressed }) => [
                    styles.row,
                    i < (expenses.data?.length ?? 0) - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.border,
                    },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText allowFontScaling={false} style={styles.tileGlyph}>{iconFor(e.categoryIcon)}</ThemedText>
                  </View>
                  <View style={styles.flex}>
                    <ThemedText style={Type.body} numberOfLines={1}>
                      {e.description || e.categoryName}
                    </ThemedText>
                    <ThemedText themeColor="textTertiary" style={Type.micro}>
                      {e.paidByName} · {e.participantCount} way
                      {e.participantCount === 1 ? '' : 's'}
                    </ThemedText>
                  </View>
                  <ThemedText style={Type.amount}>{formatPaise(e.totalPaise)}</ThemedText>
                </Pressable>
              ))}
            </Card>
          ) : (
            <Card style={styles.empty}>
              <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="receipt-outline" size={18} color={theme.textSecondary} />
              </View>
              <ThemedText style={Type.headline}>Nothing logged yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
                Tap Add to record your first expense.
              </ThemedText>
            </Card>
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitleRow}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            {title}
          </ThemedText>
          {count ? (
            <View style={[styles.countPill, { backgroundColor: theme.danger }]}>
              <ThemedText style={styles.countText}>{count}</ThemedText>
            </View>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: 130, gap: Spacing.four },
  recurringError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
  recurringErrorText: { flex: 1 },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  semi: { fontWeight: '700' },

  pagerWrap: { gap: Spacing.three },
  // The gap is the only thing between the two pages; snapToInterval accounts
  // for it, so page N always lands flush with the container's left edge.
  pager: { gap: Spacing.three },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  // width is supplied by PagerDot's animated style
  dotNav: { height: 6, borderRadius: 3 },

  // A floor, not a fixed height: the two cards carry different footers, and a
  // pager whose pages disagree on height jumps as you swipe.
  hero: { borderRadius: Radius.xl, padding: Spacing.four, minHeight: 196 },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.five,
  },
  heroLabel: { marginBottom: 4 },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  heroTrends: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  heroFootValue: { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: -0.2 },
  dot: { width: 7, height: 7, borderRadius: 4 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },

  section: { gap: Spacing.two },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: Spacing.half,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  countPill: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countText: { color: '#fff', fontSize: 10.5, fontWeight: '700', lineHeight: 14 },

  spendCard: { gap: Spacing.four },
  spendHead: { gap: 2 },
  // Full card width, so it never has to shrink for a longer amount.
  spendTotal: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.6 },
  spend: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  legend: { flex: 1, gap: Spacing.two },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileGlyph: { fontSize: 18 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },

  approval: { gap: Spacing.three },
  approvalHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  approvalActions: { flexDirection: 'row', gap: Spacing.two },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
