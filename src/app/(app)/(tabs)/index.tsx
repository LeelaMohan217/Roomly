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
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { HomeHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { Appear } from '@/components/ui/appear';
import { QuickActions } from '@/components/ui/quick-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing, TabBarClearance, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, todayIso } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { iconFor } from '@/lib/icons';
import { formatPaise, formatWholeRupees } from '@/lib/money';
import {
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
 * The big card: the household, then where you stand with it. A panel in the
 * brand green -- deep green in light mode, dark green in dark -- with faint
 * rings in the bottom right corner, after the design reference.
 *
 * The top row names the household and its head-count, a rule splits it from
 * the balance below. The amount's colour comes from the balance tokens (on a
 * green card, "owed to you" can't itself be green), and the words always say
 * the direction, so colour is never the only signal. Anything still loading
 * shows a skeleton -- a ₹0.00 before the data arrives would be a claim.
 */
function BalanceCard({
  householdName,
  people,
  balancePaise,
}: {
  householdName?: string;
  people?: number;
  balancePaise?: number;
}) {
  const theme = useTheme();
  const owed = balancePaise !== undefined && balancePaise > 0;
  const owing = balancePaise !== undefined && balancePaise < 0;
  const ink = owed ? theme.balancePositive : owing ? theme.balanceNegative : theme.onBalance;

  return (
    <View style={[styles.balanceCard, { backgroundColor: theme.balanceCard, borderColor: theme.balanceEdge }]}>
      {/* Three rings centred off the corner, so only their arcs show. */}
      <Svg style={styles.balanceRings} width={170} height={170} pointerEvents="none">
        {[28, 52, 76].map((r) => (
          <Circle key={r} cx={120} cy={120} r={r} fill="none" stroke={theme.balanceRing} strokeWidth={2} />
        ))}
      </Svg>

      <View style={styles.householdRow}>
        {householdName ? (
          <ThemedText
            style={[Type.headline, styles.flex, { color: theme.onBalance }]}
            numberOfLines={1}>
            {householdName}
          </ThemedText>
        ) : (
          <View style={styles.flex}>
            <Skeleton width={150} height={14} tint={theme.balanceRing} />
          </View>
        )}
        {people ? (
          <View
            style={styles.peopleCount}
            accessible
            accessibilityLabel={people === 1 ? '1 person' : `${people} people`}>
            <Ionicons name="people" size={16} color={theme.onBalanceMuted} />
            <ThemedText style={[Type.caption, styles.semi, { color: theme.onBalanceMuted }]}>
              {people}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={[styles.balanceRule, { backgroundColor: theme.balanceRule }]} />

      <ThemedText style={[Type.caption, { color: theme.onBalanceMuted }]} numberOfLines={1}>
        {balancePaise === undefined
          ? 'Your balance'
          : owed
            ? 'The house owes you'
            : owing
              ? 'You owe the house'
              : 'You’re all square'}
      </ThemedText>

      {/* No Settle up link here: the Settle quick action just below goes to
          the same screen. */}
      {balancePaise !== undefined ? (
        <ThemedText
          style={[styles.balanceValue, { color: ink }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}>
          {formatPaise(Math.abs(balancePaise))}
        </ThemedText>
      ) : (
        <View style={styles.balanceSkeleton}>
          <Skeleton width="55%" height={28} radius={Radius.sm} tint={theme.balanceRing} />
        </View>
      )}
    </View>
  );
}

/**
 * One of the two small cards under the balance: whose money with its icon on
 * the same line, this month's figure, a rule, and last month's figure.
 *
 * Two greens, one per card -- mint for the household, a soft lime for you --
 * so the pair stays on-brand yet reads as two different things; each tone
 * carries its own darker ink from the theme. No month on the label: the big
 * figure is plainly this month's, and the footnote names its own ("Sept
 * ₹68,825"). Whole rupees here (formatWholeRupees): it's a glance at a
 * month's spending. History has the exact figures.
 */
function SmallCard({
  tone,
  icon,
  label,
  value,
  compare,
}: {
  tone: 'house' | 'share';
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Whose money: "Household", "Your share". */
  label: string;
  value?: string;
  /** Last month's figure: "Sept ₹68,825". */
  compare?: string;
}) {
  const theme = useTheme();
  const c =
    tone === 'house'
      ? {
          card: theme.houseCard,
          edge: theme.houseEdge,
          ink: theme.houseInk,
          muted: theme.houseMuted,
          icon: theme.houseIcon,
          chip: theme.houseChip,
          rule: theme.houseRule,
        }
      : {
          card: theme.shareCard,
          edge: theme.shareEdge,
          ink: theme.shareInk,
          muted: theme.shareMuted,
          icon: theme.shareIcon,
          chip: theme.shareChip,
          rule: theme.shareRule,
        };

  return (
    <View style={[styles.smallCard, { backgroundColor: c.card, borderColor: c.edge }]}>
      {/* Label left, icon right, tops level: one line, not a tile stacked
          over the text. */}
      <View style={styles.smallHead}>
        <ThemedText style={[styles.smallLabel, { color: c.muted }]} numberOfLines={1}>
          {label}
        </ThemedText>
        <View style={[styles.smallIcon, { backgroundColor: c.chip }]}>
          <MaterialCommunityIcons name={icon} size={16} color={c.icon} />
        </View>
      </View>
      {value ? (
        <ThemedText
          style={[styles.smallValue, { color: c.ink }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}>
          {value}
        </ThemedText>
      ) : (
        <View style={styles.smallValueSkeleton}>
          <Skeleton width="70%" height={22} radius={Radius.sm} tint={c.edge} />
        </View>
      )}
      <View style={[styles.smallRule, { backgroundColor: c.rule }]} />
      {compare ? (
        <ThemedText style={[styles.smallFoot, { color: c.muted }]} numberOfLines={1}>
          {compare}
        </ThemedText>
      ) : (
        <View style={styles.smallFootSkeleton}>
          <Skeleton width={70} height={11} tint={c.edge} />
        </View>
      )}
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
      {/* brandInk, not primary: primary is a fill colour and reads 3.3:1 as
          small text on the page. */}
      <ThemedText style={[Type.caption, styles.semi, { color: theme.brandInk }]}>{label}</ThemedText>
      <Ionicons name="chevron-forward" size={14} color={theme.brandInk} />
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
  // The six newest, each its own card under Recent; "See all" opens History.
  const expenses = useExpenses(6);
  const away = useAwayPeriods();
  const changes = usePendingChanges();
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
  // opened; what you want to know is where you stand.
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (member?.display_name ?? '').trim().split(/\s+/)[0] || 'there';
  // Short ("Sept"): the small cards' footnote is half a screen wide.
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
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <HomeHeader
        greeting={greeting}
        name={firstName}
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

        {/* One big card for where you stand, two small ones under it for
            this month's spending -- the household's and yours. All visible
            without a swipe: they used to be pages of a horizontal pager,
            which had to share one height and so left the shorter card half
            empty. Each small card's second line is the whole of last
            month, labelled as such. */}
        <Appear style={styles.cards}>
          <BalanceCard
            householdName={household.data?.name}
            people={members.data?.length}
            balancePaise={balances.data ? myBalance : undefined}
          />

          <View style={styles.smallCards}>
            <SmallCard
              tone="house"
              icon="home-outline"
              label="Household"
              value={spend.data ? formatWholeRupees(spend.data.roomMonthPaise) : undefined}
              compare={
                spend.data
                  ? `${prevMonthShort} ${formatWholeRupees(spend.data.roomPrevMonthFullPaise)}`
                  : undefined
              }
            />
            <SmallCard
              tone="share"
              icon="account-outline"
              label="Your share"
              value={spend.data ? formatWholeRupees(spend.data.myMonthPaise) : undefined}
              compare={
                spend.data
                  ? `${prevMonthShort} ${formatWholeRupees(spend.data.myPrevMonthFullPaise)}`
                  : undefined
              }
            />
          </View>
        </Appear>

        <Appear delay={60}>
        <QuickActions
          // No Add here: the Add button in the tab bar already adds an
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
              icon: 'airplane',
              label: 'Away',
              onPress: () => router.push('/away'),
            },
            {
              key: 'people',
              icon: 'people',
              label: 'People',
              onPress: () => router.push('/household'),
            },
          ]}
        />
        </Appear>

        {/* Notes, one line each, coloured by what they are: yellow for
            something to keep in mind, never green, which means money in. */}
        {awayToday.length > 0 ? (
          <Note
            tone="warning"
            icon="airplane-outline"
            text={`${awayToday.map((m) => m.displayName).join(', ')} ${awayToday.length === 1 ? 'is' : 'are'} away`}
            onPress={() => router.push('/away')}
          />
        ) : null}

        {/* Varying bills can't be auto-posted, so they surface here rather
            than silently not happening. */}
        {dueForAmount > 0 ? (
          <Note
            tone="warning"
            icon="repeat"
            text={`${dueForAmount} bill${dueForAmount === 1 ? '' : 's'} need${dueForAmount === 1 ? 's' : ''} an amount`}
            onPress={() => router.push('/recurring')}
          />
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

        {/* No category breakdown on Home: the Reports tab has it, and Home
            stays on where you stand and what just happened. */}

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
                {/* Neutral, so colour on this card means only the money:
                    green coming back, red owed. The sign says it too, so no
                    "gets back" / "owes the house" caption. */}
                <Avatar name={b.displayName} seed={b.memberId} size={34} />
                <ThemedText style={[Type.body, styles.medium, styles.flex]} numberOfLines={1}>
                  {b.displayName}
                </ThemedText>
                <ThemedText
                  accessibilityLabel={
                    b.balancePaise > 0
                      ? `${b.displayName} gets back ${formatPaise(b.balancePaise)}`
                      : `${b.displayName} owes the house ${formatPaise(-b.balancePaise)}`
                  }
                  style={[
                    styles.amount,
                    {
                      color:
                        b.balancePaise > 0
                          ? theme.positive
                          : b.balancePaise < 0
                            ? theme.negative
                            : theme.textTertiary,
                    },
                  ]}>
                  {`${b.balancePaise > 0 ? '+ ' : '− '}${formatPaise(Math.abs(b.balancePaise))}`}
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
          {/* One card per expense, each standing on its own -- unlike
              History's grouped days. Home shows six at most, so the gaps do
              not make it long, and a card apiece reads as six separate things
              that happened rather than one list. */}
          {!expenses.data && pending.length === 0 ? (
            <View style={styles.recentList}>
              {[0, 1, 2].map((i) => (
                <Card key={i} padded={false}>
                  <RowSkeleton last />
                </Card>
              ))}
            </View>
          ) : (expenses.data && expenses.data.length > 0) || pending.length > 0 ? (
            <View style={styles.recentList}>
              {/* Queued entries sit at the top marked as sending, so what you
                  just typed is visibly there rather than seeming lost. */}
              {pending.map((p) => (
                <Card key={p.id} padded={false}>
                  <View style={styles.row}>
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
                    <ThemedText themeColor="textTertiary" style={styles.amount}>
                      {formatPaise(p.totalPaise)}
                    </ThemedText>
                  </View>
                </Card>
              ))}

              {expenses.data?.map((e) => (
                <Card key={e.id} padded={false}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/expense/[id]', params: { id: e.id } })}
                    // Pressed is a tint, not a fade: lowering opacity under a
                    // card with Android elevation leaves a pale band. It
                    // follows the card's corners.
                    style={({ pressed }) => [
                      styles.row,
                      pressed && [styles.rowPressed, { backgroundColor: theme.backgroundSelected }],
                    ]}>
                    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                      <ThemedText allowFontScaling={false} style={styles.tileGlyph}>{iconFor(e.categoryIcon)}</ThemedText>
                    </View>
                    <View style={styles.flex}>
                      <ThemedText style={[Type.body, styles.medium]} numberOfLines={1}>
                        {e.description || e.categoryName}
                      </ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {e.paidByName} · {e.participantCount} way
                        {e.participantCount === 1 ? '' : 's'}
                      </ThemedText>
                    </View>
                    <View style={styles.amountCol}>
                      <ThemedText style={styles.amount}>{formatPaise(e.totalPaise)}</ThemedText>
                      <ThemedText themeColor="textTertiary" style={Type.micro}>
                        {dayLabel(e.expenseDate)}
                      </ThemedText>
                    </View>
                  </Pressable>
                </Card>
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
  content: { paddingHorizontal: Spacing.four, paddingBottom: TabBarClearance, gap: Spacing.four },
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

  cards: { gap: Spacing.two + Spacing.one },
  householdRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  peopleCount: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  balanceRule: { height: StyleSheet.hairlineWidth, marginTop: Spacing.three, marginBottom: Spacing.two + Spacing.one },
  balanceCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four - Spacing.one,
    paddingTop: Spacing.three + Spacing.one,
    paddingBottom: Spacing.four - Spacing.one,
    gap: Spacing.one,
    // Clips the rings to the rounded corner.
    overflow: 'hidden',
  },
  balanceRings: { position: 'absolute', right: -30, bottom: -50 },
  balanceValue: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -1 },
  // The same line height as the figure it stands in for, so nothing moves.
  balanceSkeleton: { height: 40, justifyContent: 'center' },

  // Two equal halves; the row stretches both to the taller one's height.
  smallCards: { flexDirection: 'row', gap: Spacing.two + Spacing.one },
  smallCard: {
    flex: 1,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three + Spacing.one,
    gap: Spacing.one,
  },
  // The label and its icon on one line, centred on each other: top-aligned,
  // the text's line box put its letters visibly below the tile's top edge.
  smallHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  smallLabel: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  smallIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallRule: { height: StyleSheet.hairlineWidth, marginTop: Spacing.two + Spacing.one, marginBottom: Spacing.one },
  // The one big thing in the card, so the room around it does the work.
  smallValue: { fontSize: 26, lineHeight: 33, fontWeight: '600', letterSpacing: -0.6 },
  smallValueSkeleton: { height: 33, justifyContent: 'center' },
  // Regular weight: ThemedText's default 500 made the footnote compete with
  // the label above it.
  smallFoot: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallFootSkeleton: { height: 18, justifyContent: 'center' },
  rowSkeletonText: { gap: 6 },

  section: { gap: Spacing.two },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: Spacing.half,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.3 },
  countPill: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  countText: { color: '#fff', fontSize: 10.5, fontWeight: '700', lineHeight: 14 },


  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  // A pressed tint follows the card's corners.
  rowPressed: { borderRadius: Radius.lg },
  recentList: { gap: Spacing.two },
  medium: { fontWeight: '600' },
  amount: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
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
