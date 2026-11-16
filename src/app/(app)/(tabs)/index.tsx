import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApprovalTag, approvalAmountStyle } from '@/components/approval-tag';
import { ThemedText } from '@/components/themed-text';
import { HomeHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';

import { Appear, Reveal } from '@/components/ui/motion';
import { Money } from '@/components/ui/money';
import { QuickActions } from '@/components/ui/quick-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { MaxContentWidth, Radius, Spacing, TabBarClearance, Type, washLocations } from '@/constants/theme';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise, formatWholeRupees } from '@/lib/money';
import {
  useAwaitingApproval,
  useAwayPeriods,
  useBalances,
  useExpenses,
  useMembers,
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
 * Where you stand, written straight onto the green wash at the top of Home
 * rather than boxed in a card: what the balance means, and the amount.
 *
 * The amount is white whichever way it goes (on green, "owed to you" can't
 * itself be green); the caption, the frosted chip and the + or − all say the
 * direction, so colour is never the only signal. Anything still loading shows
 * a skeleton -- a ₹0.00 before the data arrives would be a claim.
 */
function BalanceHero({
  householdName,
  balancePaise,
}: {
  /** Not drawn -- the mockup keeps the wash to the balance -- but read out
   *  first, so a screen reader still hears which household this is. */
  householdName?: string;
  balancePaise?: number;
}) {
  const theme = useTheme();
  const owed = balancePaise !== undefined && balancePaise > 0;
  const owing = balancePaise !== undefined && balancePaise < 0;

  return (
    <View style={styles.hero}>
      <View style={styles.balanceCaptionRow}>
        <ThemedText style={[Type.caption, styles.flexShrink, { color: theme.onWashMuted }]} numberOfLines={1}>
          {balancePaise === undefined
            ? 'Your balance'
            : owed
              ? 'The house owes you'
              : owing
                ? 'You owe the house'
                : 'You’re all square'}
        </ThemedText>

        {/* The direction as a shape too: an arrow in when it comes back to
            you, out when you pay. The amount's label already says it to a
            screen reader. */}
        {owed || owing ? (
          <View
            style={[styles.balanceChip, { backgroundColor: theme.frost, borderColor: theme.frostEdge }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <Ionicons
              name={owed ? 'arrow-down' : 'arrow-up'}
              size={12}
              color={theme.onWash}
              style={styles.chipArrow}
            />
            <ThemedText style={[Type.micro, styles.semi, { color: theme.onWash }]} numberOfLines={1}>
              {owed ? 'You get back' : 'You pay'}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {balancePaise !== undefined ? (
        // A − when you owe, so a debt never reads as money coming to you.
        // Owed to you stays unsigned, as in the mockup: the caption and the
        // chip above say it, and the label reads it out either way.
        <Money
          paise={owing ? balancePaise : Math.abs(balancePaise)}
          signed={owing}
          size="hero"
          color={theme.onWash}
          accessibilityLabel={`${householdName ? `${householdName}: ` : ''}${
            owed
              ? `You get back ${formatPaise(balancePaise)}`
              : owing
                ? `You pay ${formatPaise(-balancePaise)}`
                : formatPaise(0)
          }`}
        />
      ) : (
        <View style={styles.balanceSkeleton}>
          <Skeleton width="55%" height={30} radius={Radius.sm} tint={theme.frost} />
        </View>
      )}
    </View>
  );
}

/**
 * This month's spending, in the one white card lifted over the bottom of the
 * wash: the household's figure and yours side by side, each with last month's
 * under it.
 *
 * Each figure's second line names last month ("Oct ₹38,110"). Whole rupees here
 * (formatWholeRupees): it's a glance at a month's spending. History has the
 * exact figures.
 */
function MonthCard({
  month,
  prevMonth,
  housePaise,
  housePrevPaise,
  minePaise,
  minePrevPaise,
}: {
  /** "November" */
  month: string;
  /** "Oct" */
  prevMonth: string;
  housePaise?: number;
  housePrevPaise?: number;
  minePaise?: number;
  minePrevPaise?: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.lift,
        { backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow },
      ]}>
      <View style={styles.liftHead}>
        <ThemedText style={[Type.caption, styles.semi]}>This month</ThemedText>
        <View style={[styles.monthChip, { backgroundColor: theme.liftTile }]}>
          <Ionicons name="calendar-clear-outline" size={12} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" style={Type.micro}>
            {month}
          </ThemedText>
        </View>
      </View>

      {/* Two columns on the one card, split by a hairline -- no inner boxes. */}
      <View style={styles.columns}>
        <MonthColumn
          icon="home-outline"
          label="Household"
          paise={housePaise}
          prevPaise={housePrevPaise}
          prevMonth={prevMonth}
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <MonthColumn
          icon="person-outline"
          label="Your share"
          paise={minePaise}
          prevPaise={minePrevPaise}
          prevMonth={prevMonth}
        />
      </View>
    </View>
  );
}

/**
 * One figure: a line icon in a soft green circle, the label, this month so
 * far, and last month's whole figure under it. Users read "Last month
 * ₹42,175" at a glance; a "₹3.7k under Oct" chip or a percentage made them
 * work out what was being compared with what.
 */
function MonthColumn({
  icon,
  label,
  paise,
  prevPaise,
  prevMonth,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  paise?: number;
  prevPaise?: number;
  prevMonth: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.column}>
      <View style={styles.columnHead}>
        <View style={[styles.columnIcon, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name={icon} size={14} color={theme.brandInk} />
        </View>
        <ThemedText themeColor="textSecondary" style={[Type.micro, styles.flexShrink]} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>

      {paise !== undefined ? (
        <ThemedText style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {formatWholeRupees(paise)}
        </ThemedText>
      ) : (
        <View style={styles.tileValueSkeleton}>
          <Skeleton width="70%" height={20} radius={Radius.sm} />
        </View>
      )}

      {/* Last month's whole figure, plainly: the two numbers make the
          comparison without anything to decode. */}
      {prevPaise === undefined ? (
        <View style={styles.tileFootSkeleton}>
          <Skeleton width={80} height={10} />
        </View>
      ) : (
        <ThemedText themeColor="textSecondary" style={[Type.micro, styles.lastMonth]} numberOfLines={1}>
          Last month {formatWholeRupees(prevPaise)}
        </ThemedText>
      )}
    </View>
  );
}

/** The page's side margin and the gap between Balances cards. */
const STRIP_SIDE = 18;
const STRIP_GAP = 10;
/** How much of the third Balances card shows at the right edge. */
const STRIP_PEEK = 44;

/**
 * A Balances card's width: two whole cards across the screen, and the third
 * peeking in STRIP_PEEK from the right edge, so the row plainly scrolls.
 * From the app's column width, so it holds on any phone.
 */
function usePersonCardWidth() {
  const screen = Math.min(useWindowDimensions().width, MaxContentWidth);
  return Math.round((screen - STRIP_SIDE - STRIP_GAP * 2 - STRIP_PEEK) / 2);
}

/**
 * One housemate's open balance, as a small card in a sideways row: their
 * avatar, name, and the amount -- green and + when the house owes them, red
 * and − when they owe it. The sign says it as well as the colour.
 */
function PersonCard({ memberId, name, paise }: { memberId: string; name: string; paise: number }) {
  const theme = useTheme();
  const width = usePersonCardWidth();
  return (
    <View
      style={[styles.personCard, { width, backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow }]}
      accessible
      accessibilityLabel={
        paise > 0
          ? `${name} gets back ${formatPaise(paise)}`
          : `${name} owes the house ${formatPaise(-paise)}`
      }>
      {/* The person on the left, name over amount beside them. */}
      <Avatar name={name} seed={memberId} size={38} />
      <View style={styles.personText}>
        <ThemedText style={[Type.caption, styles.semi]} numberOfLines={1}>
          {name}
        </ThemedText>
        <Money
          paise={paise}
          signed
          size="card"
          color={paise > 0 ? theme.positive : theme.negative}
        />
      </View>
    </View>
  );
}

/** A section's "go further" link: quiet grey and an arrow, after the mockup. */
function SectionLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.sectionLink, { opacity: pressed ? 0.6 : 1 }]}>
      <ThemedText themeColor="textSecondary" style={Type.caption}>{label}</ThemedText>
      <Ionicons name="arrow-forward" size={13} color={theme.textSecondary} />
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
  const dialog = useDialog();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const { pending } = useSync();
  const isOwner = member?.role === 'owner';
  const focused = useIsFocused();
  const cardWidth = usePersonCardWidth();
  const insets = useSafeAreaInsets();
  // How far down the green wash reaches: measured from the header, balance
  // and quick actions, plus enough to run behind the top of the month card.
  const [washHeight, setWashHeight] = useState(520);

  const members = useMembers();
  const balances = useBalances();
  // The six newest, each its own card under Recent; "See all" opens History.
  const expenses = useExpenses(6);
  const away = useAwayPeriods();
  const changes = usePendingChanges();
  const awaiting = useAwaitingApproval();
  const recurring = useRecurring();
  const spend = useSpendSummary(member?.id);
  // Resolves once every active query has refetched, so the disc stays up for
  // the whole of a pull and never for a background refresh.
  const pull = usePullRefresh(() => queryClient.invalidateQueries());

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
    onSuccess: () => queryClient.invalidateQueries(),
  });

  // A housemate's new expense, which counts nowhere until someone other than
  // whoever added it says yes (migration 0039).
  const reviewExpense = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_expense', {
        p_expense: id,
        p_approve: approve,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) =>
      void dialog.alert({ tone: 'danger', title: 'That didn’t go through', message: humanError(e) }),
  });

  async function rejectExpense(id: string) {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'close-circle-outline',
      title: 'Reject this expense?',
      message: 'It won’t count towards anyone’s balance, and stays in History marked rejected.',
      confirmLabel: 'Reject',
    });
    if (ok) reviewExpense.mutate({ id, approve: false });
  }

  const reviewJoin = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('review_join_request', {
        p_request: id,
        p_approve: approve,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const myBalance = balances.data?.find((b) => b.memberId === member?.id)?.balancePaise ?? 0;
  const today = todayIso();
  const awayToday = (members.data ?? []).filter(
    (m) => away.data && !isPresent(m.id, today, away.data)
  );
  // Join requests and change requests are the owner's to answer; a new
  // expense is answered by whoever can_review_expense() says may, owner or not.
  const toApprove = (awaiting.data ?? []).filter((e) => e.canReview);
  const approvalCount =
    (isOwner ? (requests.data?.length ?? 0) + (changes.data?.length ?? 0) : 0) + toApprove.length;
  const dueForAmount = (recurring.data ?? []).filter(
    (r) => r.isDue && r.mode === 'confirm'
  ).length;

  const now = new Date();

  // The header greets you instead of showing the logo — you know which app you
  // opened; what you want to know is where you stand.
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (member?.display_name ?? '').trim().split(/\s+/)[0] || 'there';
  // "November" on the month card; last month short ("Oct") beside each
  // figure from it.
  const monthLong = now.toLocaleDateString('en-IN', { month: 'long' });
  const prevMonthShort = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString(
    'en-IN',
    { month: 'short' }
  );

  // Not hand-memoized: React Compiler is enabled (app.json), and it could not
  // preserve a useMemo whose deps are rebuilt every render -- it reported
  // "Compilation Skipped", meaning the whole file went un-optimised to keep a
  // memo that was not helping. Plain derivation lets the compiler do it.
  const others = (balances.data ?? []).filter((b) => b.memberId !== member?.id);
  const openBalances = others
    .filter((b) => b.balancePaise !== 0)
    .sort((a, b) => Math.abs(b.balancePaise) - Math.abs(a.balancePaise));
  const settledCount = others.length - openBalances.length;

  return (
    // No top edge: the green wash runs up under the status bar, and the
    // scroll content pads itself by the inset instead.
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* White status bar icons while Home is showing, over the dark wash.
          Unmounted on blur, so other screens keep their own. */}
      {focused ? <StatusBar style="light" /> : null}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.onWash}
            progressViewOffset={insets.top}
          />
        }>
        {/* The wash: deep green at the top, fading into the page about half
            way down the month card. It scrolls with the content, so the white
            text on it never ends up over the pale page. */}
        <LinearGradient
          pointerEvents="none"
          colors={[
            theme.washTop,
            theme.washMid,
            theme.washLow,
            theme.washFade,
            theme.washMint,
            theme.background,
          ]}
          // Each colour where the mockup put it (see washLocations).
          locations={washLocations(washHeight)}
          style={[styles.wash, { height: washHeight }]}
        />

        <View
          style={styles.top}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height + 150);
            if (h !== washHeight) setWashHeight(h);
          }}>
          <HomeHeader
            greeting={greeting}
            name={firstName}
            // The owner's items only. The badge sits on the account button, which
            // opens Settings and Owner tools; expense approvals are answered here
            // on Home, so counting them there sent members to a screen with
            // nothing to approve.
            badge={isOwner ? (requests.data?.length ?? 0) + (changes.data?.length ?? 0) : 0}
          />

          <Appear index={0}>
            <BalanceHero
              householdName={household.data?.name}
              balancePaise={balances.data ? myBalance : undefined}
            />
          </Appear>

          {/* Steps 1 to 4, one per action. Frosted, on the wash. */}
          <QuickActions
            onWash
            enterIndex={1}
            // No Add here: the Add button beside the tab bar already adds an
            // expense, and two Add buttons on one screen left recurring bills
            // with no way in from Home.
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
              {
                key: 'away',
                icon: 'navigate-outline',
                label: 'Away',
                onPress: () => router.push('/away'),
              },
              {
                key: 'people',
                icon: 'people-outline',
                label: 'People',
                onPress: () => router.push('/household'),
              },
            ]}
          />
        </View>
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

        {/* This month, in the one white card lifted over the bottom of the
            wash. Everything rises on its own, top to bottom: balance, each
            quick action, this card, the notes, Balances, then each recent
            expense. Everything draws at once -- skeletons included -- and
            only its arrival is staggered. */}
        <Appear index={5}>
          <MonthCard
            month={monthLong}
            prevMonth={prevMonthShort}
            housePaise={spend.data?.roomMonthPaise}
            housePrevPaise={spend.data?.roomPrevMonthFullPaise}
            minePaise={spend.data?.myMonthPaise}
            minePrevPaise={spend.data?.myPrevMonthFullPaise}
          />
        </Appear>

        {/* Notes, one line each, coloured by what they are: yellow for
            something to keep in mind, never green, which means money in. */}
        {awayToday.length > 0 ? (
          <Appear index={7}>
            <Note
              tone="warning"
              icon="airplane-outline"
              text={`${awayToday.map((m) => m.displayName).join(', ')} ${awayToday.length === 1 ? 'is' : 'are'} away`}
              onPress={() => router.push('/away')}
            />
          </Appear>
        ) : null}

        {/* Varying bills can't be auto-posted, so they surface here rather
            than silently not happening. */}
        {dueForAmount > 0 ? (
          <Appear index={7}>
            <Note
              tone="warning"
              icon="repeat"
              text={`${dueForAmount} bill${dueForAmount === 1 ? '' : 's'} need${dueForAmount === 1 ? 's' : ''} an amount`}
              onPress={() => router.push('/recurring')}
            />
          </Appear>
        ) : null}

        {approvalCount > 0 ? (
          <Appear index={8}>
          <Section title="Needs you" count={approvalCount}>
            {toApprove.map((e) => {
              const busy = reviewExpense.isPending && reviewExpense.variables?.id === e.id;
              return (
                <Card key={e.id} style={styles.approval}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/expense/[id]', params: { id: e.id } })}
                    style={styles.approvalHead}>
                    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText allowFontScaling={false} style={styles.tileGlyph}>
                        {iconFor(e.categoryIcon)}
                      </ThemedText>
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={Type.headline}>
                        {e.createdByName} added {formatPaise(e.totalPaise)}
                      </ThemedText>
                      <ThemedText themeColor="textSecondary" style={Type.caption} numberOfLines={1}>
                        {e.description || e.categoryName} · paid by {e.paidByName} · tap to review
                      </ThemedText>
                    </View>
                  </Pressable>
                  <View style={styles.approvalActions}>
                    <Button
                      title="Approve"
                      onPress={() => reviewExpense.mutate({ id: e.id, approve: true })}
                      loading={busy}
                      disabled={reviewExpense.isPending}
                      style={styles.flex}
                    />
                    <Button
                      title="Reject"
                      variant="ghost"
                      onPress={() => void rejectExpense(e.id)}
                      disabled={reviewExpense.isPending}
                      style={styles.flex}
                    />
                  </View>
                </Card>
              );
            })}

            {(isOwner ? changes.data : [])?.map((c) => (
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

            {(isOwner ? requests.data : [])?.map((r) => (
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
          </Appear>
        ) : null}

        {/* No category breakdown on Home: the Reports tab has it, and Home
            stays on where you stand and what just happened. */}

        <Appear index={9}>
        <Section
          title="Balances"
          action={<SectionLink label="All" onPress={() => router.push('/household')} />}>
          {/* Other people, and only those with something open, largest
              first, as a sideways row of small cards. Your own balance is
              the big figure at the top, and a settled housemate answers
              nothing -- they are counted in the last card instead. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.stripBleed}
            contentContainerStyle={styles.strip}>
            {!balances.data
              ? [0, 1, 2].map((i) => (
                  <View
                    key={i}
                    style={[styles.personCard, { width: cardWidth, backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow }]}>
                    <Skeleton width={38} height={38} radius={19} />
                    <View style={styles.personSkeleton}>
                      <Skeleton width="60%" height={11} />
                      <Skeleton width="80%" height={13} />
                    </View>
                  </View>
                ))
              : null}
            {/* The real cards fade in where the skeletons were. Mounted once,
                when the first data lands; a refetch keeps balances.data, so it
                never replays. */}
            {balances.data ? (
              <Reveal style={styles.stripInner}>
                {openBalances.map((b) => (
                  <PersonCard
                    key={b.memberId}
                    memberId={b.memberId}
                    name={b.displayName}
                    paise={b.balancePaise}
                  />
                ))}
                {openBalances.length === 0 || settledCount > 0 ? (
                  <View
                    style={[
                      styles.personCard,
                      { width: openBalances.length === 0 ? cardWidth * 2 + STRIP_GAP : cardWidth },
                      { backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow },
                    ]}>
                    <View style={[styles.lineIcon, { backgroundColor: theme.primarySoft }]}>
                      <MaterialCommunityIcons name="check" size={17} color={theme.brandInk} />
                    </View>
                    <ThemedText themeColor="textSecondary" style={[Type.caption, styles.personText]}>
                      {openBalances.length === 0
                        ? 'Everyone else is settled up'
                        : `${settledCount === 1 ? '1 other is' : `${settledCount} others are`} settled up`}
                    </ThemedText>
                  </View>
                ) : null}
              </Reveal>
            ) : null}
          </ScrollView>
        </Section>
        </Appear>

        <Appear index={10}>
        <Section
          title="Recent"
          action={
            expenses.data && expenses.data.length > 0 ? (
              <SectionLink label="See all" onPress={() => router.push('/history')} />
            ) : null
          }>
          {/* Loading is not empty: "Nothing logged yet" used to show for the
              moment before the list arrived, in a household full of expenses. */}
          {/* One card per expense, each standing on its own -- unlike
              History's grouped days. Home shows six at most, so the gaps do
              not make it long, and a card apiece reads as six separate things
              that happened rather than one list. */}
          {!expenses.data && pending.length === 0 ? (
            <View style={styles.recentList}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.recentCard, { backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow }]}>
                  <RowSkeleton last />
                </View>
              ))}
            </View>
          ) : (expenses.data && expenses.data.length > 0) || pending.length > 0 ? (
            <View style={styles.recentList}>
              {/* Queued entries sit at the top marked as sending, so what you
                  just typed is visibly there rather than seeming lost. Each
                  card is its own step; one added later rises in by itself,
                  and the ones already there stay put. */}
              {pending.map((p, i) => (
                <Appear key={p.id} index={11 + i}>
                <View style={[styles.recentCard, { backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow }]}>
                  <View style={styles.row}>
                    <View style={[styles.rowTile, { backgroundColor: theme.liftTile }]}>
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
                    <Money paise={p.totalPaise} size="row" color={theme.textTertiary} />
                  </View>
                </View>
                </Appear>
              ))}

              {expenses.data?.map((e, i) => (
                <Appear key={e.id} index={11 + pending.length + i}>
                <View style={[styles.recentCard, { backgroundColor: theme.lift, borderColor: theme.liftEdge, shadowColor: theme.liftShadow }]}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/expense/[id]', params: { id: e.id } })}
                    // Pressed is a tint, not a fade: lowering opacity under a
                    // card with Android elevation leaves a pale band. It
                    // follows the card's corners.
                    style={({ pressed }) => [
                      styles.row,
                      pressed && [styles.rowPressed, { backgroundColor: theme.backgroundSelected }],
                    ]}>
                    <View style={[styles.rowTile, { backgroundColor: theme.liftTile }]}>
                      <ThemedText allowFontScaling={false} style={styles.tileGlyph}>{iconFor(e.categoryIcon)}</ThemedText>
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={[Type.body, styles.semi]} numberOfLines={1}>
                        {e.description || e.categoryName}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {e.paidByName} · {e.participantCount} way
                        {e.participantCount === 1 ? '' : 's'}
                      </ThemedText>
                      <ApprovalTag status={e.approvalStatus} />
                    </View>
                    <View style={styles.amountCol}>
                      <Money
                        paise={e.totalPaise}
                        size="row"
                        extra={approvalAmountStyle(theme, e.approvalStatus)}
                      />
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {dayLabel(e.expenseDate)}
                      </ThemedText>
                    </View>
                  </Pressable>
                </View>
                </Appear>
              ))}
            </View>
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
        </Appear>
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
          {/* Sentence case, not spaced capitals, but a step above the rows:
              at grey caption size "Balances" and "Recent" weighed the same
              as the subtitles under them, so the page had no chapters. */}
          <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
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

/**
 * A one-line note that opens a screen. Its colour says what kind it is --
 * yellow to keep in mind, blue for plain information -- so the words can
 * stay short.
 */
function Note({
  tone,
  icon,
  text,
  onPress,
}: {
  tone: 'warning' | 'info';
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = tone === 'warning' ? theme.warning : theme.info;
  const soft = tone === 'warning' ? theme.warningSoft : theme.infoSoft;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.note, { backgroundColor: soft, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={16} color={ink} />
      <ThemedText style={[Type.caption, styles.medium, styles.flex, { color: ink }]} numberOfLines={1}>
        {text}
      </ThemedText>
      <Ionicons name="chevron-forward" size={14} color={ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  // 18 at the sides, as in the mockup; the cards reach 4 further out.
  content: { paddingHorizontal: 18, paddingBottom: TabBarClearance, gap: Spacing.four },
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
  semi: { fontWeight: '600' },

  flexShrink: { flexShrink: 1 },

  // The wash spans the scroll content edge to edge, padding included, and
  // sits behind everything in it.
  wash: { position: 'absolute', top: 0, left: 0, right: 0 },
  top: { gap: Spacing.three },

  hero: { gap: Spacing.two },
  balanceCaptionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  // Never shrinks: as wide as its words, which stay on one line. The caption
  // beside it gives way instead.
  balanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 3,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Ionicons has no plain diagonal arrow. Turned 45° clockwise, the down
  // arrow points down-left (in, to you) and the up arrow up-right (out).
  chipArrow: { transform: [{ rotate: '45deg' }] },
  // The same height as the figure it stands in for, so nothing moves.
  balanceSkeleton: { height: 50, justifyContent: 'center' },

  // The lifted card: big radius and a hairline edge, no shadow (a shadowed
  // card fading in on Android drew a grey band around itself).
  lift: {
    marginHorizontal: -4,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  liftHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: 999,
  },
  columns: { flexDirection: 'row', alignItems: 'stretch' },
  column: { flex: 1, gap: 2 },
  divider: { width: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  columnIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  lastMonth: { marginTop: 2 },
  tileValue: { fontSize: 23, lineHeight: 30, fontWeight: '600', letterSpacing: -0.6, marginTop: Spacing.one },
  tileValueSkeleton: { height: 28, justifyContent: 'center', marginTop: Spacing.one },
  tileFootSkeleton: { height: 16, justifyContent: 'center' },


  // Balances: the row runs edge to edge, its cards starting at the page's
  // left margin and scrolling off the right.
  stripBleed: { marginHorizontal: -18 },
  strip: { paddingHorizontal: STRIP_SIDE, paddingVertical: Spacing.two, gap: STRIP_GAP },
  stripInner: { flexDirection: 'row', gap: STRIP_GAP },
  // Avatar left, words right.
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two + Spacing.one + 1,
  },
  personText: { flex: 1, minWidth: 0, gap: 2 },
  personSkeleton: { flex: 1, gap: 8 },

  // Recent: one card per expense, a rounded-square tile for its category.
  recentCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowTile: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowSkeletonText: { gap: 6 },

  section: { gap: Spacing.two },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: Spacing.half,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4 },
  countPill: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countText: { color: '#fff', fontSize: 10.5, fontWeight: '600', lineHeight: 14 },


  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  // A pressed tint follows the card's corners.
  rowPressed: { borderRadius: 20 },
  recentList: { gap: Spacing.two },
  medium: { fontWeight: '500' },
  amount: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  amountCol: { alignItems: 'flex-end' },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
  },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileGlyph: { fontSize: 16 },
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
