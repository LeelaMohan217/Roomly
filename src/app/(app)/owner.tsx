import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
      Alert.alert('Could not hand over', humanError(e));
    },
  });

  function confirmHandOver(id: string, who: string) {
    Alert.alert(
      `Make ${who} the owner?`,
      `You become a regular member straight away. ${who} can hand it back to you whenever you want it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Hand over to ${who}`, onPress: () => transfer.mutate(id) },
      ]
    );
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

  const pending = (requests.data?.length ?? 0) + (changes.data?.length ?? 0);
  const activeRecurring = (recurring.data ?? []).filter((r) => r.isActive).length;
  const liveCategories = (categories.data ?? []).filter((c) => !c.isArchived).length;
  const openMonths = (periods.data ?? []).filter((p) => p.status === 'open').length;
  const placeholders = (members.data ?? []).filter((m) => !m.userId).length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Owner tools" subtitle="You manage the vocabulary" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* navigate(), not push(). Pushing a tab route onto this Stack does not
            crash — the stack does declare (tabs) — it stacks a SECOND copy of
            the whole tab shell, so Android back then returns to Owner tools
            from Home. The comment further down this file already says to use
            navigate for exactly this reason. */}
        {pending > 0 ? (
          <Pressable onPress={() => router.navigate('/')}>
            <Card style={[styles.alert, { backgroundColor: theme.dangerSoft }]}>
              <Ionicons name="alert-circle" size={20} color={theme.danger} />
              <View style={styles.flex}>
                <ThemedText style={[Type.body, styles.semi]}>
                  {pending} thing{pending === 1 ? '' : 's'} waiting on you
                </ThemedText>
                <ThemedText themeColor="textSecondary" style={Type.micro}>
                  Approvals sit on the Home screen — tap to review
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.danger} />
            </Card>
          </Pressable>
        ) : null}

        <View style={styles.section}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            THE HOUSEHOLD
          </ThemedText>

          <Card padded={false}>
            <Row
              icon="people"
              tint
              label="Roommates"
              value={`${members.data?.length ?? 0}`}
              hint={
                placeholders > 0
                  ? `${placeholders} still to claim their account`
                  : 'Everyone has joined'
              }
              href="/household"
            />
            <Row
              icon="pricetags"
              tint
              label="Categories"
              value={`${liveCategories}`}
              hint="Names, icons, and how each one splits"
              href="/categories"
            />
            <Row
              icon="repeat"
              tint
              label="Recurring bills"
              value={`${activeRecurring}`}
              hint="Rent, wifi and the maid, posted automatically"
              href="/recurring"
            />
            <Row
              icon="calendar"
              label="Away calendar"
              hint="You can mark trips for anyone"
              href="/away"
              last
            />
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            THE MONEY
          </ThemedText>

          <Card padded={false}>
            <Row
              icon="swap-horizontal"
              label="Settle up"
              value={openMonths > 0 ? `${openMonths} open` : undefined}
              hint="Who pays whom, and closing a month"
              href="/settle"
            />
            <Row
              icon="stats-chart"
              label="Reports"
              hint="Where the money went, month by month"
              href="/reports"
            />
            <Row
              icon="document-text"
              label="Edit history"
              hint="Every change, and who made it"
              href="/edit-history"
              last
            />
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText themeColor="textTertiary" style={Type.label}>
            IF YOU ARE AWAY
          </ThemedText>

          <Card style={styles.handOver}>
            <ThemedText themeColor="textSecondary" style={Type.caption}>
              Somebody has to be able to confirm payments and add housemates while you are not
              around. Hand ownership over and take it back when you return.
            </ThemedText>
            <Button
              title="Hand over ownership"
              variant="ghost"
              onPress={() => setHandOver(true)}
              disabled={candidates.length === 0}
            />
            {candidates.length === 0 ? (
              <ThemedText themeColor="textTertiary" style={Type.micro}>
                Nobody else has claimed their account yet, so there is no one to hand it to.
              </ThemedText>
            ) : null}
          </Card>
        </View>

        {/* Being explicit about what the owner cannot do matters as much as
            what they can — it's what keeps four friends trusting the ledger. */}
        <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
          <Ionicons name="shield-checkmark-outline" size={15} color={theme.textTertiary} />
          <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
            Being owner doesn&apos;t give you power over anyone&apos;s money. Every edit you make
            is recorded and visible to everyone, and balances are always derived from the
            expenses themselves.
          </ThemedText>
        </View>
      </ScrollView>

      <Sheet
        visible={handOver}
        onClose={() => setHandOver(false)}
        title="Hand over ownership"
        subtitle="They get every owner power. You keep all your expenses and your balance.">
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

function Row({
  icon,
  label,
  value,
  hint,
  href,
  tint = false,
  last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  hint: string;
  href: Href;
  tint?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      // navigate, not push. Most of these rows target a screen this Stack
      // owns, but /reports lives in the (tabs) group -- pushing a tab route
      // onto a Stack that does not declare it crashed the app. navigate()
      // switches to an existing route instead of pushing a duplicate, and
      // behaves identically for the stack screens.
      onPress={() => router.navigate(href)}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        { opacity: pressed ? 0.6 : 1 },
      ]}>
      <View
        style={[
          styles.tile,
          { backgroundColor: tint ? theme.primarySoft : theme.backgroundSelected },
        ]}>
        <Ionicons name={icon} size={18} color={tint ? theme.primary : theme.textSecondary} />
      </View>

      <View style={styles.flex}>
        <ThemedText style={Type.body}>{label}</ThemedText>
        <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={1}>
          {hint}
        </ThemedText>
      </View>

      {value ? (
        <ThemedText themeColor="textSecondary" style={Type.amount}>
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
  semi: { fontWeight: '700' },

  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five },
  lockIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },

  alert: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  section: { gap: Spacing.two },

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

  handOver: { gap: Spacing.three },
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
