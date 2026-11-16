import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useUpdates } from 'expo-updates';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { useDialog } from '@/components/ui/dialog';
import { Appear } from '@/components/ui/motion';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, TabBarClearance, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  applyUpdate,
  buildLabel,
  buildTime,
  checkForUpdate,
  updateState,
  updateTag,
} from '@/lib/build-info';
import { humanError } from '@/lib/errors';
import { rejected } from '@/lib/haptics';
import { PUSH_LABELS, usePushStatus } from '@/lib/push';
import { useMembers, usePendingChanges } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * One row: an icon, a label, maybe a value on the right. It opens a screen
 * (href), does something (onPress), or only shows a fact (neither).
 */
type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  /** Colours the value by what it means: green on, amber needs attention. */
  valueTone?: 'positive' | 'warning';
  href?: Href;
  onPress?: () => void;
  /** Greyed and not tappable, with the value saying why. */
  disabled?: boolean;
};

/**
 * Everything not on a tab, in one place.
 *
 * A calm page with no green wash -- that is kept for Home and Reports. You at
 * the top in a card that opens your account details. Under it the household's
 * screens, the owner's tools, the app's own settings and, alone at the
 * bottom, Sign out. There is no separate Owner tools screen any more: its
 * links were the same ones listed here, so what only an owner can do --
 * categories and handing over ownership -- sits in Tools. These used to be split between here and an Account
 * screen that repeated your name and photo and then listed more options; now
 * there is one list, and the account card shows only who you are.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const router = useRouter();
  const { member, signOut } = useSession();
  const isOwner = member?.role === 'owner';
  const push = usePushStatus();
  const [checking, setChecking] = useState(false);
  const [handOver, setHandOver] = useState(false);
  const queryClient = useQueryClient();
  const members = useMembers();
  const changes = usePendingChanges();

  // What is waiting on an owner: join requests and change requests. They are
  // answered on Home; the banner here says they exist and goes there.
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
  const pending = isOwner ? (requests.data?.length ?? 0) + (changes.data?.length ?? 0) : 0;

  // Only someone who has claimed their account can take over -- a placeholder
  // has nobody behind it to sign in and use the powers.
  const candidates = (members.data ?? []).filter((m) => m.id !== member?.id && !!m.userId);

  const transfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('transfer_ownership', { p_member_id: id });
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      setHandOver(false);
      const who = members.data?.find((m) => m.id === id)?.displayName ?? 'They';
      // The toast gives the same buzz committed() did.
      dialog.toast({ message: `${who} is now the owner`, icon: 'key-outline' });
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

  // Two identities, not one: the APK someone installed, and the JS bundle
  // actually running. An OTA update changes the second without the first.
  const state = updateState();
  const tag = updateTag();

  // isUpdatePending lives on this hook in SDK 57, not on the Updates module.
  // It is true when a background fetch on a previous launch already downloaded
  // a newer bundle — the state that made a live update look like it had never
  // been published.
  const { isUpdatePending } = useUpdates();

  async function lookForUpdate() {
    setChecking(true);
    const outcome = await checkForUpdate(isUpdatePending);
    setChecking(false);

    // 'pending' means it is already on the phone from a background fetch on a
    // previous launch, so it needs the same offer as one downloaded just now.
    if (outcome.kind === 'downloaded' || outcome.kind === 'pending') {
      const restart = await dialog.confirm({
        tone: 'success',
        icon: 'cloud-download-outline',
        title: 'Update ready',
        message:
          outcome.kind === 'pending'
            ? 'A newer version is already downloaded. Restart the app to use it?'
            : 'Restart the app to use it?',
        confirmLabel: 'Restart now',
        cancelLabel: 'Later',
      });
      if (restart) void applyUpdate();
      return;
    }

    // Naming the exact build here is the point: "up to date" alone is useless
    // when the question is whether this phone has the fix.
    const stamp = buildTime()
      ? `\n\nRunning ${buildLabel()}, built ${buildTime()}.`
      : `\n\nRunning ${buildLabel()}.`;

    // Each of these is a different situation and sends you somewhere different.
    // Collapsing them into "try again when you have signal" told someone on
    // full LTE to go looking for a network problem that did not exist.
    const message =
      outcome.kind === 'none'
        ? `You are on the latest version.${stamp}`
        : outcome.kind === 'unavailable'
          ? `This build cannot receive over-the-air updates.${stamp}`
          : outcome.kind === 'offline'
            ? `Could not reach the update server. Check your connection and try again.${stamp}`
            : `No update has been published yet, so this is the newest version there is.${stamp}`;

    // Green when there is simply nothing newer, amber when something stopped
    // the check, blue when this build just cannot take updates.
    void dialog.alert({
      tone: outcome.kind === 'offline' ? 'warning' : outcome.kind === 'unavailable' ? 'info' : 'success',
      title: outcome.kind === 'offline' ? 'Could not check' : 'Updates',
      message,
    });
  }

  async function confirmSignOut() {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'log-out-outline',
      title: 'Sign out?',
      message: 'Your household and expenses stay exactly as they are.',
      confirmLabel: 'Sign out',
    });
    if (ok) void signOut();
  }

  const groups: { title: string; rows: Row[] }[] = [
    {
      // The everyday household screens, and the log of what changed in them.
      title: 'Household',
      rows: [
        { href: '/settle', icon: 'swap-horizontal-outline', label: 'Settle up' },
        // "Bills", matching the Home button that opens the same screen.
        { href: '/recurring', icon: 'calendar-outline', label: 'Bills' },
        { href: '/away', icon: 'airplane-outline', label: 'Away calendar' },
        {
          href: '/household',
          icon: 'people-outline',
          label: 'Roommates',
          value: members.data ? `${members.data.length}` : undefined,
        },
        // No backup export: History's download button gives a full
        // statement, so a second export was the same job twice.
        { href: '/edit-history', icon: 'document-text-outline', label: 'Edit history' },
      ],
    },
    // What only the owner does. Only owners see it.
    ...(isOwner
      ? [
          {
            title: 'Tools',
            rows: [
              { href: '/categories' as const, icon: 'pricetags-outline' as const, label: 'Categories' },
              // Greyed, and saying why, when there is nobody to hand it to --
              // but only once the members are read.
              {
                icon: 'key-outline' as const,
                label: 'Hand over ownership',
                value: members.data && candidates.length === 0 ? 'No one yet' : undefined,
                disabled: candidates.length === 0,
                onPress: () => setHandOver(true),
              },
            ],
          },
        ]
      : []),
    {
      title: 'App',
      rows: [
        // Registration is silent by design, so this is the only place that
        // tells "push is off" from "push is quietly broken". The explanation
        // is a tap away rather than a line under the row.
        {
          icon: 'notifications-outline',
          label: 'Notifications',
          value: PUSH_LABELS[push].value,
          valueTone: push === 'on' ? 'positive' : push === 'blocked' ? 'warning' : undefined,
          onPress: () =>
            void dialog.alert({
              tone: push === 'on' ? 'success' : push === 'blocked' ? 'warning' : 'info',
              icon: 'notifications-outline',
              title: `Notifications ${PUSH_LABELS[push].value.toLowerCase()}`,
              message: PUSH_LABELS[push].hint,
            }),
        },
        // The real identity, not a hardcoded string: every APK built in one
        // afternoon used to report "1.0.0".
        { icon: 'information-circle-outline', label: 'Version', value: buildLabel() },
        ...(state !== 'disabled'
          ? [
              {
                icon: 'cloud-download-outline' as const,
                label: checking ? 'Checking…' : 'Check for updates',
                value: tag ? `update ${tag}` : 'installed build',
                onPress: checking ? undefined : () => void lookForUpdate(),
              },
            ]
          : []),
      ],
    },
  ];

  const name = member?.display_name ?? '';
  const card = { backgroundColor: theme.lift, borderColor: theme.liftEdge };

  return (
    // A calm, neutral page: the green wash is kept for Home and Reports,
    // where there is money to look at. A utility screen reads better plain.
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <ThemedText style={styles.screenTitle}>More</ThemedText>

          {/* You: the whole block opens your account details. */}
          <Appear>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name || 'Your account'}, ${isOwner ? 'owner' : 'member'}. Open your details`}
              onPress={() => router.push('/account-edit')}
              style={({ pressed }) => [
                styles.profile,
                card,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <Avatar name={name || '?'} seed={member?.id} size={56} ring ringColor={theme.border} />
              <View style={styles.flex}>
                <ThemedText style={styles.profileName} numberOfLines={1}>
                  {name}
                </ThemedText>
                <View style={styles.profileMeta}>
                  <View style={[styles.rolePill, { backgroundColor: theme.primarySoft }]}>
                    <Ionicons
                      name={isOwner ? 'shield-checkmark-outline' : 'person-outline'}
                      size={11}
                      color={theme.brandInk}
                    />
                    <ThemedText style={[Type.micro, styles.semi, { color: theme.brandInk }]}>
                      {isOwner ? 'Owner' : 'Member'}
                    </ThemedText>
                  </View>
                  <ThemedText themeColor="textSecondary" style={Type.micro}>
                    Your details
                  </ThemedText>
                </View>
              </View>
              <View style={[styles.chevron, { backgroundColor: theme.liftTile }]}>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </View>
            </Pressable>
          </Appear>
        </View>

        {/* Waiting on the owner: yellow, one line, and it goes to Home,
            where approvals are answered. navigate, not push: Home is a tab. */}
        {pending > 0 ? (
          <Appear>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Approvals are on Home"
              onPress={() => router.navigate('/')}
              style={({ pressed }) => [
                styles.alert,
                { backgroundColor: theme.warningSoft, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
              <ThemedText style={[Type.caption, styles.semi, styles.flex, { color: theme.warning }]}>
                {pending} thing{pending === 1 ? '' : 's'} waiting on you
              </ThemedText>
              <Ionicons name="chevron-forward" size={14} color={theme.warning} />
            </Pressable>
          </Appear>
        ) : null}

        {/* A big heading for each group, and every row a card of its own. */}
        {groups.map((g, gi) => (
          <Appear key={g.title} index={gi + 1} style={styles.group}>
            <ThemedText style={styles.groupTitle}>{g.title}</ThemedText>
            <View style={styles.cards}>
              {g.rows.map((r) => (
                <RowCard key={r.icon} row={r} />
              ))}
            </View>
          </Appear>
        ))}

        {/* A pale red pill with red words, centred: clearly the way out, but
            quiet -- it is not a main action, and the confirmation that
            follows carries the solid red. Alone so it is never tapped on the
            way to another row. */}
        <Appear index={groups.length + 1}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void confirmSignOut()}
            style={({ pressed }) => [
              styles.signOut,
              { backgroundColor: theme.dangerSoft, opacity: pressed ? 0.75 : 1 },
            ]}>
            <Ionicons name="log-out-outline" size={19} color={theme.danger} />
            <ThemedText style={[Type.body, styles.semi, { color: theme.danger }]}>Sign out</ThemedText>
          </Pressable>
        </Appear>
      </ScrollView>

      {/* Hand over ownership: the explanation lives here, where the decision
          is made. */}
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
              { backgroundColor: theme.lift, borderColor: theme.liftEdge, opacity: pressed ? 0.7 : 1 },
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

/** One row as its own card: it opens a screen, does something, or just shows a fact. */
function RowCard({ row: r }: { row: Row }) {
  const theme = useTheme();
  const router = useRouter();
  const act = r.disabled ? undefined : r.href ? () => router.push(r.href!) : r.onPress;
  const valueInk =
    r.valueTone === 'positive' ? theme.positive : r.valueTone === 'warning' ? theme.warning : theme.textTertiary;

  return (
    <View
      style={[
        styles.listCard,
        { backgroundColor: theme.lift, borderColor: theme.liftEdge },
        r.disabled && styles.disabled,
      ]}>
      <Pressable
        accessibilityRole={act || r.disabled ? 'button' : undefined}
        accessibilityState={r.disabled ? { disabled: true } : undefined}
        disabled={!act}
        onPress={act}
        // A tint, not a fade: the card clips it to its corners.
        style={({ pressed }) => [styles.row, pressed && act && { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.rowIcon, { backgroundColor: theme.liftTile }]}>
          <Ionicons name={r.icon} size={19} color={theme.brandInk} />
        </View>
        {/* The label keeps its words; the value is secondary, so it is the
            one that truncates. */}
        <ThemedText style={[Type.body, styles.semi, styles.label]} numberOfLines={1}>
          {r.label}
        </ThemedText>
        {r.value ? (
          <ThemedText style={[Type.caption, styles.value, { color: valueInk }]} numberOfLines={1}>
            {r.value}
          </ThemedText>
        ) : (
          <View style={styles.flex} />
        )}
        {act ? <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  semi: { fontWeight: '600' },
  // 18 at the sides, as on the other tabs.
  content: { paddingHorizontal: 18, paddingBottom: TabBarClearance, gap: Spacing.four },
  top: { gap: Spacing.three, paddingTop: Spacing.two },
  screenTitle: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -0.9 },

  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileName: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.4 },
  profileMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 4 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  chevron: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  group: { gap: Spacing.two + 2 },
  cards: { gap: Spacing.two },
  groupTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4, paddingLeft: Spacing.half },
  listCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1 },
  disabled: { opacity: 0.5 },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 54,
    borderRadius: Radius.pill,
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  value: { flex: 1, textAlign: 'right' },
});
