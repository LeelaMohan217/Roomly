import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ApprovalRows, useApprovals } from '@/components/approvals';
import { ThemedText } from '@/components/themed-text';
import { HomeHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';

import { Appear, Reveal } from '@/components/ui/motion';
import { Money } from '@/components/ui/money';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MaxContentWidth,
  Radius,
  Spacing,
  TabBarClearance,
  Type,
  washLocations,
} from '@/constants/theme';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { useCountUp } from '@/hooks/use-count-up';
import { homeInsights, pickInsight } from '@/lib/insight';
import { useInsightRotation } from '@/lib/insight-hidden';
import { tapped } from '@/lib/haptics';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, todayIso } from '@/lib/dates';
import { categoryColor, categoryIcon, categoryTint } from '@/lib/icons';
import { formatPaise, formatWholeRupees } from '@/lib/money';
import {
  useAwayPeriods,
  useBalances,
  useMonthlyTotals,
  useExpenses,
  useMembers,
  useRecurring,
  useSpendSummary,
} from '@/lib/queries';
import { useSession } from '@/lib/session';
import { isPresent } from '@/lib/split';
import { supabase } from '@/lib/supabase';
import { isNetworkError } from '@/lib/errors';
import { useSync } from '@/lib/sync';
import { useTourStore, useTourTarget } from '@/lib/tour';
import { FeatureCards } from '@/components/ui/feature-cards';
import { Icon, type IconName } from '@/components/ui/icon';

/** How many approvals Home shows before "Show all". */
const HOME_APPROVALS = 2;


/**
 * Where you stand, written straight onto the green wash at the top of Home
 * rather than boxed in a card: what the balance means, and the amount.
 *
 * The amount is white whichever way it goes (on green, "owed to you" can't
 * itself be green); the caption and the − say the direction, so colour is
 * never the only signal. Anything still loading shows
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
  const tourTarget = useTourTarget('balance');
  const owed = balancePaise !== undefined && balancePaise > 0;
  const owing = balancePaise !== undefined && balancePaise < 0;
  // The figure runs up from ₹0 as Home opens. Only what is drawn counts; the
  // label below always reads out the real amount.
  const counted = useCountUp(balancePaise);

  return (
    <View ref={tourTarget} collapsable={false} style={styles.hero}>
      <View style={styles.balanceCaptionRow}>
        <ThemedText style={[styles.balanceCaption, styles.flexShrink, { color: theme.onWashMuted }]} numberOfLines={1}>
          {balancePaise === undefined
            ? 'Your balance'
            : owed
              ? 'The house owes you'
              : owing
                ? 'You owe the house'
                : 'You’re all square'}
        </ThemedText>
      </View>

      {balancePaise !== undefined ? (
        // A − when you owe, so a debt never reads as money coming to you.
        // Owed to you stays unsigned, as in the mockup: the caption and the
        // chip above say it, and the label reads it out either way.
        <Money
          paise={owing ? (counted ?? balancePaise) : Math.abs(counted ?? balancePaise)}
          signed={owing}
          size="display"
          // White on the green; the pill below says which way it goes.
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
          <Skeleton width="55%" height={40} radius={Radius.sm} tint={theme.frost} />
        </View>
      )}

      {/* Which way it goes, in colour and in words: red to pay, green to
          receive. Nothing when you're square. The amount's label already
          says it to a screen reader. */}
      {owed || owing ? (
        <View
          // Frosted, like the bell beside the greeting: see-through white on
          // the green, the arrow and words saying which way.
          style={[
            styles.directionPill,
            { backgroundColor: theme.frost, borderColor: theme.frostEdge },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <Icon name={owing ? 'arrow-up' : 'arrow-down'} size={15} color="#FFFFFF" />
          <ThemedText style={[styles.directionText, styles.semi]}>
            {owing ? 'To pay' : 'To receive'}
          </ThemedText>
        </View>
      ) : null}
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
  const tourTarget = useTourTarget('month');
  return (
    <View
      ref={tourTarget}
      collapsable={false}
      style={[
        styles.lift,
        // Frosted rather than solid white: a hint of the green wash shows
        // through, so the card sits in it instead of on top of it.
        {
          backgroundColor: 'rgba(255,255,255,0.72)',
          borderColor: 'rgba(255,255,255,0.9)',
          shadowColor: theme.liftShadow,
        },
      ]}>
      <View style={styles.liftHead}>
        <ThemedText style={[Type.caption, styles.semi]}>This month</ThemedText>
        <View style={[styles.monthChip, { backgroundColor: theme.liftTile }]}>
          <Icon name="calendar-clear-outline" size={12} color={theme.textSecondary} />
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
  icon: IconName;
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
          <Icon name={icon} size={14} color={theme.brandInk} />
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
      <Icon name="arrow-forward" size={13} color={theme.textSecondary} />
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
  const { pending, online } = useSync();
  const isOwner = member?.role === 'owner';
  const focused = useIsFocused();
  const cardWidth = usePersonCardWidth();
  const insets = useSafeAreaInsets();
  // How far down the green wash reaches: measured from the header, balance
  // and quick actions, plus enough to run behind the top of the month card.
  const [washHeight, setWashHeight] = useState(520);

  const members = useMembers();
  const balances = useBalances();
  // The one-line insight under the month card (lib/insight).
  const monthly = useMonthlyTotals();
  const nowDate = new Date();
  // Every true insight; Home shows one, the next each time it opens, and
  // skips any you've hidden this month.
  const rotation = useInsightRotation(member?.id ? `${member.id}` : undefined);
  const insight = monthly.data
    ? pickInsight(
        homeInsights(
          monthly.data,
          nowDate.getFullYear(),
          nowDate.getMonth() + 1,
          nowDate.getDate()
        ),
        rotation.hidden,
        rotation.turn
      )
    : null;
  // The six newest, each its own card under Recent; "See all" opens History.
  const expenses = useExpenses(6);
  const away = useAwayPeriods();
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
  const [recurringFailed, setRecurringFailed] = useState(false);

  useEffect(() => {
    if (!member) return;
    // Offline there is nothing to try: the call would only fail. The effect
    // re-runs when `online` flips back, which is the retry.
    if (!online) return;

    async function postDue() {
      const { data, error } = await supabase.rpc('post_due_recurrences');
      // Previously `const { data } = await ...` — so offline, or refused, rent
      // silently failed to post and nobody ever learned why.
      if (error) {
        // A dropped connection is not news -- the offline banner already says
        // so, and this retries on reconnect and on every return to the app.
        // Only a real refusal is worth a line, and never its raw text.
        if (!isNetworkError(error)) setRecurringFailed(true);
        return;
      }
      setRecurringFailed(false);
      if (typeof data === 'number' && data > 0) {
        void queryClient.invalidateQueries();
      }
    }

    void postDue();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void postDue();
    });
    return () => sub.remove();
  }, [member, online, queryClient]);

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

  // Everything waiting for your yes or no (components/approvals).
  const approvals = useApprovals();

  const myBalance = balances.data?.find((b) => b.memberId === member?.id)?.balancePaise ?? 0;
  const today = todayIso();
  const awayToday = (members.data ?? []).filter(
    (m) => away.data && !isPresent(m.id, today, away.data)
  );
  // Join requests and change requests are the owner's to answer; a new
  // expense is answered by whoever can_review_expense() says may, owner or not.
  const approvalCount = approvals.count;
  // The owner's own items, for the badge on the account button.
  const ownerItems = approvals.items.filter((i) => i.kind !== 'expense').length;
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

  // The first-run tour measures this screen's cards, so it waits until Home
  // is showing and its figures have landed (or a few seconds have passed, so
  // a slow network never holds it off for good). See lib/tour.
  const setTourHomeReady = useTourStore((s) => s.setHomeReady);
  const figuresLoaded = !!balances.data && !!spend.data;
  useEffect(() => {
    if (!focused) {
      setTourHomeReady(false);
      return;
    }
    if (figuresLoaded) {
      setTourHomeReady(true);
      return;
    }
    const timer = setTimeout(() => setTourHomeReady(true), 4000);
    return () => clearTimeout(timer);
  }, [focused, figuresLoaded, setTourHomeReady]);

  return (
    // No top edge: the green wash runs up under the status bar, and the
    // scroll content pads itself by the inset instead.
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* White status bar icons while Home is showing, over the green wash.
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
        {/* The wash: the app's green, lighter than before, fading into the
            page about half way down the month card, with white text on it. */}
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
          // Spread evenly down a taller wash, so the green dissolves into the
          // page instead of stopping at a line.
          locations={washLocations()}
          style={[styles.wash, { height: washHeight }]}
        />

        <View style={styles.top}>
          <HomeHeader
            greeting={greeting}
            name={firstName}
            // The owner's items only. The badge sits on the account button, which
            // opens Settings and Owner tools; expense approvals are answered here
            // on Home, so counting them there sent members to a screen with
            // nothing to approve.
            badge={isOwner ? ownerItems : 0}
          />

          <Appear index={0}>
            <BalanceHero
              householdName={household.data?.name}
              balancePaise={balances.data ? myBalance : undefined}
            />
          </Appear>
        </View>
        {/* Recurring bills post from whoever opens the app first. When that
            call fails there is nothing else in the UI that would ever mention
            it, so rent quietly does not appear. */}
        {recurringFailed ? (
          <View style={[styles.recurringError, { backgroundColor: theme.backgroundSunken }]}>
            <Icon name="alert-circle-outline" size={15} color={theme.textTertiary} />
            <ThemedText themeColor="textTertiary" style={[Type.micro, styles.recurringErrorText]}>
              Some recurring bills haven&apos;t been added yet. We&apos;ll try again shortly.
            </ThemedText>
          </View>
        ) : null}

        {/* This month, in the one white card lifted over the bottom of the
            wash. Everything rises on its own, top to bottom: balance, each
            quick action, this card, the notes, Balances, then each recent
            expense. Everything draws at once -- skeletons included -- and
            only its arrival is staggered. */}
        {/* The wash is measured to this card: its green dissolves behind the
            card and is gone just below it, so whatever comes next -- the
            insight, or the action cards once it is hidden -- sits on the
            plain page. */}
        <Appear
          index={5}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height + 36);
            if (h !== washHeight) setWashHeight(h);
          }}>
          <MonthCard
            month={monthLong}
            prevMonth={prevMonthShort}
            housePaise={spend.data?.roomMonthPaise}
            housePrevPaise={spend.data?.roomPrevMonthFullPaise}
            minePaise={spend.data?.myMonthPaise}
            minePrevPaise={spend.data?.myPrevMonthFullPaise}
          />
        </Appear>

        {/* What the month says, in one line: a category that has passed last
            month, a real fall late in the month, or where the money goes.
            Rises a beat after the card, once the balance has counted up. */}
        {insight ? (
          // Keyed, so the next insight rises in when one is hidden.
          <Appear key={insight.key} index={6}>
            <View
              style={[
                styles.insight,
                insight.tone === 'up'
                  ? { backgroundColor: theme.warningSoft, borderColor: `${theme.warning}33` }
                  : { backgroundColor: theme.primarySoft, borderColor: theme.washFade },
              ]}>
              <View style={[styles.insightIcon, { backgroundColor: theme.backgroundElement }]}>
                <Icon
                  name={
                    insight.tone === 'up'
                      ? 'trending-up'
                      : insight.tone === 'down'
                        ? 'trending-down'
                        : 'sparkles'
                  }
                  size={16}
                  color={insight.tone === 'up' ? theme.warning : theme.brandInk}
                />
              </View>
              <ThemedText
                style={[
                  Type.caption,
                  styles.flex,
                  { color: insight.tone === 'up' ? theme.warning : theme.brandInk },
                ]}>
                <ThemedText
                  style={[
                    Type.caption,
                    styles.semi,
                    { color: insight.tone === 'up' ? theme.warning : theme.brandInk },
                  ]}>
                  {insight.lead}
                </ThemedText>
                {insight.rest}
              </ThemedText>
              {/* Seen it: hide this one for the rest of the month. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hide this tip"
                onPress={() => {
                  tapped();
                  rotation.hide(insight.key);
                }}
                hitSlop={10}
                style={({ pressed }) => [styles.insightClose, { opacity: pressed ? 0.5 : 1 }]}>
                <Icon
                  name="close"
                  size={15}
                  color={insight.tone === 'up' ? theme.warning : theme.brandInk}
                />
              </Pressable>
            </View>
          </Appear>
        ) : null}

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
          <Section
            title="Needs you"
            count={approvalCount}
            // Two at most here, so a busy week does not push the rest of Home
            // off the screen; the Approvals page has them all.
            action={
              approvalCount > HOME_APPROVALS ? (
                <SectionLink label={`Show all ${approvalCount}`} onPress={() => router.push("/approvals")} />
              ) : undefined
            }>
            <ApprovalRows approvals={approvals} limit={HOME_APPROVALS} />
          </Section>
          </Appear>
        ) : null}

        {/* No category breakdown on Home: the Reports tab has it, and Home
            stays on where you stand and what just happened. */}

        {/* The everyday actions, then the private ledger, in one row that
            scrolls sideways. No Add here: the Add button beside the tab bar
            already adds an expense. */}
        <Appear index={9}>
          <FeatureCards
            bleed={STRIP_SIDE}
            cards={[
              {
                key: 'settle',
                tourTarget: 'settle',
                icon: 'swap-horizontal',
                label: 'Settle',
                caption: 'Pay or get paid',
                color: '#16A34A',
                onPress: () => router.push('/settle'),
              },
              {
                key: 'bills',
                // A calendar, not the repeat arrows: those sat beside Settle's
                // swap arrows and the two read as the same button.
                icon: 'calendar-outline',
                label: 'Bills',
                caption: 'Rent, Wi-Fi, more',
                color: '#D97706',
                onPress: () => router.push('/recurring'),
              },
              {
                key: 'away',
                icon: 'navigate-outline',
                label: 'Away',
                caption: 'Days out of town',
                color: '#0284C7',
                onPress: () => router.push('/away'),
              },
              {
                key: 'people',
                icon: 'people-outline',
                label: 'People',
                caption: 'Your housemates',
                color: '#7C3AED',
                onPress: () => router.push('/household'),
              },
              {
                key: 'ledger',
                icon: 'lock-closed-outline',
                label: 'My ledger',
                caption: 'Just for you',
                color: '#DB2777',
                tag: 'New',
                onPress: () => router.push('/ledger'),
              },
            ]}
          />
        </Appear>

        <Appear index={9}>
        <Section
          title="Balances"
          // Everyone's balance with the house -- the same figures as these
          // cards, for the whole household. Not Settle up: that is person to
          // person, so its numbers differ from these.
          action={<SectionLink label="All" onPress={() => router.push('/balances')} />}>
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
                      <Icon name="check" size={17} color={theme.brandInk} />
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
                    <View style={[styles.rowTile, { backgroundColor: categoryTint(p.categoryIcon) }]}>
                      <Icon name={categoryIcon(p.categoryIcon)} size={18} color={categoryColor(p.categoryIcon)} />
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={Type.body} numberOfLines={1}>
                        {p.description || p.categoryName}
                      </ThemedText>
                      <View style={styles.pendingRow}>
                        <Icon
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
                    <View style={[styles.rowTile, { backgroundColor: categoryTint(e.categoryIcon) }]}>
                      <Icon name={categoryIcon(e.categoryIcon)} size={18} color={categoryColor(e.categoryIcon)} />
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
              <View style={[styles.tile, { backgroundColor: theme.primarySoft }]}>
                <Icon name="receipt-outline" size={18} color={theme.brandInk} />
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
  icon: IconName;
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
      <Icon name={icon} size={16} color={ink} />
      <ThemedText style={[Type.caption, styles.medium, styles.flex, { color: ink }]} numberOfLines={1}>
        {text}
      </ThemedText>
      <Icon name="chevron-forward" size={14} color={ink} />
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

  // Centred on the wash: the caption and chip over the amount, both mid-screen.
  hero: { gap: Spacing.two, alignItems: 'center' },
  balanceCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
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
  directionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: -2,
  },
  directionText: { color: '#FFFFFF', fontSize: 14, lineHeight: 19 },
  balanceCaption: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  insight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  insightClose: { alignSelf: 'flex-start', padding: 2 },
  insightIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceSkeleton: { height: 50, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch' },

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
