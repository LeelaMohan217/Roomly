import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { HomeHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { Appear } from '@/components/ui/appear';
import { QuickActions } from '@/components/ui/quick-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { iconFor, lineIconFor } from '@/lib/icons';
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
 * Household name and head-count, one quiet line above the two cards. Half a
 * screen is too narrow to carry it inside a card as well as a figure.
 */
function HouseholdLine({ name, people }: { name?: string; people?: number }) {
  return (
    <View style={styles.householdLine}>
      {name ? (
        <ThemedText themeColor="textSecondary" style={[Type.caption, styles.flex]} numberOfLines={1}>
          {name}
        </ThemedText>
      ) : (
        <Skeleton width={140} height={12} />
      )}
      {people ? (
        <ThemedText themeColor="textSecondary" style={Type.caption}>
          {people === 1 ? '1 person' : `${people} people`}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * One of Home's two summary tiles: a round icon, a label, the figure, and a
 * smaller figure underneath. An undefined value shows a skeleton -- a ₹0.00
 * before the data arrives would be a claim.
 */
function StatTile({
  icon,
  tone,
  label,
  value,
  footLabel,
  footValue,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  tone: 'success' | 'danger' | 'neutral';
  label: string;
  value?: string;
  /** Short -- it shares one line with footValue: "Your share ₹9,652.78". */
  footLabel: string;
  footValue?: string;
}) {
  const theme = useTheme();
  const ink =
    tone === 'success' ? theme.success : tone === 'danger' ? theme.danger : theme.textSecondary;
  // The icon's own colour as a wash behind it (hex alpha), so the circle is
  // always the same hue as the glyph -- clearly green, red or grey.
  const wash = `${ink}${tone === 'neutral' ? '24' : '33'}`;

  return (
    <View
      style={[
        styles.statTile,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <View>
        <View style={[styles.tileIcon, { backgroundColor: wash }]}>
          <MaterialCommunityIcons name={icon} size={17} color={ink} />
        </View>
        <ThemedText themeColor="textSecondary" style={[Type.micro, styles.tileLabel]} numberOfLines={1}>
          {label}
        </ThemedText>
        {value ? (
          <ThemedText
            style={[styles.tileValue, tone !== 'neutral' && { color: ink }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}>
            {value}
          </ThemedText>
        ) : (
          <View style={styles.tileValueSkeleton}>
            <Skeleton width="80%" height={20} radius={Radius.sm} />
          </View>
        )}
      </View>

      {footValue ? (
        <ThemedText themeColor="textSecondary" style={styles.tileFoot} numberOfLines={1}>
          {footLabel} <ThemedText style={styles.tileFootValue}>{footValue}</ThemedText>
        </ThemedText>
      ) : (
        <View style={styles.tileFootLoading}>
          <ThemedText themeColor="textSecondary" style={styles.tileFoot}>
            {footLabel}
          </ThemedText>
          <Skeleton width={64} height={12} />
        </View>
      )}
    </View>
  );
}

/**
 * One category in "Where it went": a tinted line icon, the name and amount,
 * and a thin bar for its share of the month.
 */
function CategoryRow({
  icon,
  name,
  amount,
  share,
  color,
}: {
  icon: string;
  name: string;
  amount: string;
  /** 0 to 1, of the month's total. */
  share: number;
  color: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.categoryRow}>
      <View style={[styles.tileIcon, { backgroundColor: `${color}2E` }]}>
        <MaterialCommunityIcons
          name={icon as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
          size={16}
          color={color}
        />
      </View>
      <View style={[styles.flex, styles.categoryText]}>
        <View style={styles.categoryHead}>
          <ThemedText style={[Type.caption, styles.flex]} numberOfLines={1}>
            {name}
          </ThemedText>
          <ThemedText style={Type.caption}>{amount}</ThemedText>
        </View>
        <View style={[styles.categoryTrack, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.categoryFill,
              // A sliver stays visible for a tiny category rather than vanishing.
              { width: `${Math.max(share * 100, 2)}%`, backgroundColor: color },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

/** A section's "go further" link. Green, but regular weight: it's a way on, not a headline. */
function SectionLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.sectionLink, { opacity: pressed ? 0.6 : 1 }]}>
      <ThemedText style={[Type.micro, { color: theme.primary }]}>{label}</ThemedText>
      <Ionicons name="chevron-forward" size={12} color={theme.primary} />
    </Pressable>
  );
}

/** A list row's shape -- round or square tile, two lines, an amount. */
function RowSkeleton({ round = false, last = false }: { round?: boolean; last?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
      ]}>
      <Skeleton width={round ? 36 : 38} height={round ? 36 : 38} radius={round ? 18 : Radius.md} />
      <View style={[styles.flex, styles.rowSkeletonText]}>
        <Skeleton width="55%" height={12} />
        <Skeleton width="35%" height={10} />
      </View>
      <Skeleton width={64} height={13} />
    </View>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const { pending } = useSync();
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
  const prevMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString(
    'en-IN',
    { month: 'long' }
  );

  const monthRows = (totals.data ?? []).filter(
    (t) => t.year === now.getFullYear() && t.month === now.getMonth() + 1
  );
  const monthTotal = monthRows.reduce((sum, r) => sum + r.totalPaise, 0);

  const palette = [theme.chart1, theme.chart2, theme.chart3, theme.chart4];
  // Not hand-memoized: React Compiler is enabled (app.json), and it could not
  // preserve a useMemo whose deps are rebuilt every render -- it reported
  // "Compilation Skipped", meaning the whole file went un-optimised to keep a
  // memo that was not helping. Plain derivation lets the compiler do it.
  const topCategories = [...monthRows].sort((a, b) => b.totalPaise - a.totalPaise).slice(0, 4);

  const others = (balances.data ?? []).filter((b) => b.memberId !== member?.id);
  const openBalances = others
    .filter((b) => b.balancePaise !== 0)
    .sort((a, b) => Math.abs(b.balancePaise) - Math.abs(a.balancePaise));
  const settledCount = others.length - openBalances.length;

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

        {/* Two plain tiles side by side, both visible without a swipe. They
            used to be pages of a horizontal pager, which had to share one
            height and so left the shorter card half empty.

            No coloured fill: the colour is in the small round icon and, on
            the balance, in the amount -- green when the house owes you, red
            when you owe it, grey when you're square. That keeps colour for
            meaning, the way the rest of the app uses it, instead of as
            decoration. */}
        <Appear style={styles.cards}>
          <HouseholdLine name={household.data?.name} people={members.data?.length} />

          <View style={styles.tiles}>
            <StatTile
              icon={
                !balances.data
                  ? 'wallet-outline'
                  : myBalance > 0
                    ? 'arrow-bottom-left'
                    : myBalance < 0
                      ? 'arrow-top-right'
                      : 'check'
              }
              tone={!balances.data || myBalance === 0 ? 'neutral' : myBalance > 0 ? 'success' : 'danger'}
              label={
                !balances.data
                  ? 'Your balance'
                  : myBalance > 0
                    ? 'The house owes you'
                    : myBalance < 0
                      ? 'You owe the house'
                      : 'You’re all square'
              }
              value={balances.data ? formatPaise(Math.abs(myBalance)) : undefined}
              footLabel="Your share"
              footValue={spend.data ? formatPaise(spend.data.myMonthPaise) : undefined}
            />
            <StatTile
              icon="receipt-text-outline"
              tone="neutral"
              label={`Spent in ${monthName}`}
              value={spend.data ? formatPaise(spend.data.roomMonthPaise) : undefined}
              footLabel={prevMonthName}
              footValue={spend.data ? formatPaise(spend.data.roomPrevMonthPaise) : undefined}
            />
          </View>
        </Appear>

        <Appear delay={60}>
        <QuickActions
          // No Add here: the floating + button already adds an expense, and
          // two Add buttons on one screen left recurring bills with no way in
          // from Home.
          actions={[
            {
              key: 'settle',
              icon: 'swap-horizontal',
              label: 'Settle',
              onPress: () => router.push('/settle'),
            },
            {
              key: 'bills',
              // A calendar, not the repeat arrows: those sat beside Settle's
              // swap arrows and the two read as the same button.
              icon: 'calendar-outline',
              label: 'Bills',
              onPress: () => router.push('/recurring'),
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
          <Section title="Needs you" count={approvalCount}>
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

        {/* Still loading: the card's shape, so the page does not jump when it
            arrives. Loaded and empty: no card at all, as before. */}
        {!totals.data ? (
          <Section title="Where it went">
            <Card style={styles.spendCard}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.categoryRow}>
                  <Skeleton width={30} height={30} radius={15} />
                  <View style={[styles.flex, styles.categoryText]}>
                    <Skeleton width={i % 2 ? '45%' : '60%'} height={12} />
                    <Skeleton height={4} radius={2} />
                  </View>
                </View>
              ))}
            </Card>
          </Section>
        ) : monthTotal > 0 ? (
          <Section
            title="Where it went"
            action={<SectionLink label="Reports" onPress={() => router.push('/reports')} />}>
            {/* Categories only. The month's total is in the spend tile at the
                top of Home; repeating it here put the same figure on screen
                twice. Rows rather than a ring: an amount you can read beats a
                percentage you have to turn back into rupees, and the line
                icons match the tiles above. */}
            <Card style={styles.spendCard}>
              {topCategories.map((r, i) => (
                <CategoryRow
                  key={r.categoryId}
                  icon={lineIconFor(r.icon)}
                  name={r.categoryName}
                  amount={formatPaise(r.totalPaise)}
                  share={r.totalPaise / monthTotal}
                  color={palette[i % palette.length]}
                />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section
          // No "Manage" link: the People quick action above goes to the same
          // screen, and two doors to one place on a single screen is just
          // something else to read.
          title="Balances">
          {/* Other people, and only those with something open, largest
              first. Your own row repeated the balance tile at the top, and a
              settled housemate's "—" row answers nothing. */}
          <Card padded={false}>
            {!balances.data
              ? [0, 1, 2].map((i) => <RowSkeleton key={i} round last={i === 2} />)
              : null}
            {balances.data && openBalances.length === 0 ? (
              <View style={styles.row}>
                <View style={[styles.lineIcon, { backgroundColor: theme.backgroundSelected }]}>
                  <MaterialCommunityIcons name="check" size={17} color={theme.textSecondary} />
                </View>
                <ThemedText themeColor="textSecondary" style={[Type.caption, styles.flex]}>
                  Everyone else is settled up
                </ThemedText>
              </View>
            ) : null}
            {openBalances.map((b, i) => (
              <View
                key={b.memberId}
                style={[
                  styles.row,
                  (i < openBalances.length - 1 || settledCount > 0) && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.border,
                  },
                ]}>
                <Avatar name={b.displayName} seed={b.memberId} size={36} />
                <View style={styles.flex}>
                  <ThemedText style={Type.body} numberOfLines={1}>
                    {b.displayName}
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
                  {`${b.balancePaise > 0 ? '+' : '−'}${formatPaise(Math.abs(b.balancePaise))}`}
                </ThemedText>
              </View>
            ))}
            {openBalances.length > 0 && settledCount > 0 ? (
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.settledNote]}>
                {settledCount === 1 ? '1 other is' : `${settledCount} others are`} settled up
              </ThemedText>
            ) : null}
          </Card>
        </Section>

        <Section
          title="Recent"
          action={
            expenses.data && expenses.data.length > 0 ? (
              <SectionLink label="See all" onPress={() => router.push('/history')} />
            ) : null
          }>
          {/* Loading is not empty: "Nothing logged yet" used to show for the
              moment before the list arrived, in a household full of expenses. */}
          {!expenses.data && pending.length === 0 ? (
            <Card padded={false}>
              {[0, 1, 2].map((i) => (
                <RowSkeleton key={i} last={i === 2} />
              ))}
            </Card>
          ) : (expenses.data && expenses.data.length > 0) || pending.length > 0 ? (
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
                Tap + to record your first expense.
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
          {/* Sentence case at caption size, not spaced capitals: a section
              title orients, it shouldn't shout like the figures under it. */}
          <ThemedText themeColor="textSecondary" style={Type.caption}>
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

  cards: { gap: Spacing.two },
  householdLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.half,
  },
  // Two equal halves. The row stretches both to the taller one's height, and
  // space-between pins each footer to the bottom, so the two rules line up.
  tiles: { flexDirection: 'row', gap: Spacing.two + Spacing.one },
  statTile: {
    flex: 1,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
    justifyContent: 'space-between',
  },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { marginTop: Spacing.two + Spacing.one },
  tileValue: { fontSize: 21, lineHeight: 27, fontWeight: '500', letterSpacing: -0.4, marginTop: 2 },
  // The same 26px line as the figure it stands in for, so nothing moves.
  tileValueSkeleton: { height: 27, marginTop: 2, justifyContent: 'center' },
  tileFoot: { fontSize: 12, lineHeight: 17 },
  tileFootValue: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  tileFootLoading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  rowSkeletonText: { gap: 6 },

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

  spendCard: { gap: Spacing.three + Spacing.one },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  categoryText: { gap: 6 },
  categoryHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  categoryTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  categoryFill: { height: 4, borderRadius: 2 },

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
  lineIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  settledNote: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },

  approval: { gap: Spacing.three },
  approvalHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  approvalActions: { flexDirection: 'row', gap: Spacing.two },

  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
});
