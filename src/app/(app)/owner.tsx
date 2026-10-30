import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { committed, rejected } from '@/lib/haptics';
import {
  useAllCategories,
  useMembers,
  usePendingChanges,
  usePeriods,
  useRecurring,
} from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function OwnerScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const router = useRouter();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const queryClient = useQueryClient();
  const [handOver, setHandOver] = useState(false);

  const members = useMembers();
  const categories = useAllCategories();
  const recurring = useRecurring();
  const periods = usePeriods();
  const changes = usePendingChanges();

  const requests = useQuery({
    queryKey: ['join-requests'],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('join_requests')
        .select('id')
        .eq('status', 'pending');
      if (error) throw error;
      return data;
    },
  });

  // Only someone who has claimed their account can take over -- a placeholder
  // has nobody behind it to sign in and use the powers.
  const candidates = (members.data ?? []).filter((m) => m.id !== member?.id && !!m.userId);

  const transfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('transfer_ownership', { p_member_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      committed();
      setHandOver(false);
      void queryClient.invalidateQueries();
    },
    onError: (e) => {
      rejected();
      void dialog.alert({ tone: 'danger', title: 'Could not hand over', message: humanError(e) });
    },
  });

  async function confirmHandOver(id: string, who: string) {
    const ok = await dialog.confirm({
      tone: 'warning',
      icon: 'key-outline',
      title: `Make ${who} the owner?`,
      message: `You become a regular member straight away. ${who} can hand it back to you whenever you want it.`,
      confirmLabel: `Hand over to ${who}`,
    });
    if (ok) transfer.mutate(id);
  }

  if (!isOwner) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Owner tools" />
        <View style={styles.locked}>
          <View style={[styles.lockIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="lock-closed" size={22} color={theme.textTertiary} />
          </View>
          <ThemedText style={Type.title}>Owner only</ThemedText>
          <ThemedText themeColor="textSecondary" style={[Type.caption, styles.centered]}>
            {members.data?.find((m) => m.role === 'owner')?.displayName ?? 'The owner'} manages
            people, categories and monthly bills. You can add and view expenses as normal.
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  // Each count is undefined until its list is read, and a row with no value
  // shows just its chevron. They all read 0 first, which is a claim: a
  // household with rent set up was shown "Bills 0".
  const countOf = <T,>(list: T[] | undefined, keep: (item: T) => boolean = () => true) =>
    list ? `${list.filter(keep).length}` : undefined;

  const pending = (requests.data?.length ?? 0) + (changes.data?.length ?? 0);
  const activeRecurring = countOf(recurring.data, (r) => r.isActive);
  const liveCategories = countOf(categories.data, (c) => !c.isArchived);
  const openMonths = (periods.data ?? []).filter((p) => p.status === 'open').length;
  const placeholders = (members.data ?? []).filter((m) => !m.userId).length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Owner tools" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* navigate(), not push(). Pushing a tab route onto this Stack does not
            crash — the stack does declare (tabs) — it stacks a SECOND copy of
            the whole tab shell, so Android back then returns to Owner tools
            from Home. The comment further down this file already says to use
            navigate for exactly this reason.
            Yellow, one line: it is waiting on you, not an error. */}
        {pending > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Approvals are on Home"
            onPress={() => router.navigate('/')}
            style={({ pressed }) => [
              styles.alert,
              { backgroundColor: theme.warningSoft, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
            <ThemedText style={[Type.caption, styles.medium, styles.flex, { color: theme.warning }]}>
              {pending} thing{pending === 1 ? '' : 's'} waiting on you
            </ThemedText>
            <Ionicons name="chevron-forward" size={14} color={theme.warning} />
          </Pressable>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Household</ThemedText>
          <Card padded={false}>
            <Row
              icon="people-outline"
              label="Roommates"
              value={countOf(members.data)}
              a11y={placeholders > 0 ? `${placeholders} still to claim their account` : undefined}
              href="/household"
              first
            />
            <Row icon="pricetags-outline" label="Categories" value={liveCategories} href="/categories" />
            <Row icon="repeat-outline" label="Bills" value={activeRecurring} href="/recurring" />
            <Row icon="airplane-outline" label="Away" href="/away" />
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Money</ThemedText>
          <Card padded={false}>
            <Row
              icon="swap-horizontal"
              label="Settle up"
              value={openMonths > 0 ? `${openMonths} open` : undefined}
              href="/settle"
              first
            />
            <Row icon="stats-chart-outline" label="Reports" href="/reports" />
            <Row icon="document-text-outline" label="Edit history" href="/edit-history" />
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>If you&apos;re away</ThemedText>
          <Card padded={false}>
            {/* Greyed, and saying why, when there is nobody to hand it to --
                but only once the members are read. Before that it is greyed
                with no reason, rather than "No one yet" in a full house. */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: candidates.length === 0 }}
              disabled={candidates.length === 0}
              onPress={() => setHandOver(true)}
              style={({ pressed }) => [
                styles.row,
                { opacity: candidates.length === 0 ? 0.5 : pressed ? 0.6 : 1 },
              ]}>
              <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="key-outline" size={17} color={theme.text} />
              </View>
              <ThemedText style={[Type.body, styles.flex]}>Hand over ownership</ThemedText>
              {!members.data ? null : candidates.length === 0 ? (
                <ThemedText themeColor="textTertiary" style={Type.caption}>
                  No one yet
                </ThemedText>
              ) : (
                <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
              )}
            </Pressable>
          </Card>
        </View>

        {/* Being explicit about what the owner cannot do matters as much as
            what they can — it's what keeps four friends trusting the ledger.
            One line now; the rest of it is true of every screen. */}
        <View style={styles.trust}>
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.textTertiary} />
          <ThemedText themeColor="textTertiary" style={[Type.caption, styles.flex]}>
            Every edit you make is visible to everyone
          </ThemedText>
        </View>
      </ScrollView>

      {/* The explanation lives here, where the decision is made. */}
      <Sheet
        visible={handOver}
        onClose={() => setHandOver(false)}
        title="Hand over ownership"
        subtitle="Somebody has to confirm payments and add housemates while you are away. They get every owner power; you keep your expenses and balance, and they can hand it back.">
        {candidates.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => confirmHandOver(m.id, m.displayName)}
            disabled={transfer.isPending}
            style={({ pressed }) => [
              styles.candidate,
              { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Avatar name={m.displayName} seed={m.id} size={36} />
            <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
              {m.displayName}
            </ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
          </Pressable>
        ))}
      </Sheet>
    </SafeAreaView>
  );
}

/** One link, as on More: grey tile, the name, a count, a chevron. No hint. */
function Row({
  icon,
  label,
  value,
  a11y,
  href,
  first = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  /** Extra words for a screen reader, where the count alone says too little. */
  a11y?: string;
  href: Href;
  first?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, value, a11y].filter(Boolean).join(', ')}
      // navigate, not push. Most of these rows target a screen this Stack
      // owns, but /reports lives in the (tabs) group -- pushing a tab route
      // onto a Stack that does not declare it crashed the app. navigate()
      // switches to an existing route instead of pushing a duplicate, and
      // behaves identically for the stack screens.
      onPress={() => router.navigate(href)}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        { opacity: pressed ? 0.6 : 1 },
      ]}>
      <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name={icon} size={17} color={theme.text} />
      </View>

      <ThemedText style={[Type.body, styles.flex]}>{label}</ThemedText>

      {value ? (
        <ThemedText themeColor="textSecondary" style={Type.body}>
          {value}
        </ThemedText>
      ) : null}
      <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  centered: { textAlign: 'center' },
  semi: { fontWeight: '600' },

  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five },
  lockIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },

  medium: { fontWeight: '500' },

  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  section: { gap: Spacing.two },
  // Sentence case at heading size, as on More and Account.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  // The same soft square as More's rows.
  tile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trust: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  note: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
});
