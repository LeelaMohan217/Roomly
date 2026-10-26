import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useUpdates } from 'expo-updates';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMembers } from '@/lib/queries';
import { exportBackup } from '@/lib/backup';
import {
  applyUpdate,
  buildLabel,
  buildTime,
  checkForUpdate,
  updateState,
  updateTag,
} from '@/lib/build-info';
import { PUSH_LABELS, usePushStatus } from '@/lib/push';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const router = useRouter();
  const { member, session, signOut } = useSession();
  const members = useMembers();
  const push = usePushStatus();
  const [checking, setChecking] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Two identities, not one: the APK someone installed, and the JS bundle
  // actually running. An OTA update changes the second without the first.
  const state = updateState();
  const tag = updateTag();

  async function saveBackup() {
    setExporting(true);
    const result = await exportBackup(household.data?.name ?? 'roomly');
    setExporting(false);

    // Success needs no alert -- the share sheet opening IS the feedback, and a
    // dialog behind it would be waiting when they come back from WhatsApp.
    if (!result.ok) void dialog.alert({ tone: 'danger', title: 'Could not export', message: result.reason });
  }

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
      ? `

Running ${buildLabel()}, built ${buildTime()}.`
      : `

Running ${buildLabel()}.`;

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

  const isOwner = member?.role === 'owner';

  const household = useQuery({
    queryKey: ['household', member?.household_id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('households')
        .select('name, currency')
        .eq('id', member!.household_id)
        .single();
      if (error) throw error;
      return data;
    },
  });

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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Account" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* A row, not a centred stack: the identity reads left-to-right in one
            line of sight and costs a third of the height. */}
        {/* The identity block is the edit affordance. A separate "Edit" row
            would be a second thing to find for the same job. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your details"
          onPress={() => router.push('/account-edit')}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Card style={styles.profile}>
            <Avatar name={member?.display_name ?? '?'} seed={member?.id} size={52} />

          <View style={styles.identity}>
            <View style={styles.nameRow}>
              <ThemedText style={styles.name} numberOfLines={1}>
                {member?.display_name}
              </ThemedText>
              <View
                style={[
                  styles.rolePill,
                  { backgroundColor: isOwner ? theme.primarySoft : theme.backgroundSelected },
                ]}>
                <ThemedText
                  style={[
                    Type.micro,
                    styles.roleText,
                    { color: isOwner ? theme.primary : theme.textSecondary },
                  ]}>
                  {isOwner ? 'Owner' : 'Member'}
                </ThemedText>
              </View>
            </View>

              <ThemedText themeColor="textTertiary" style={Type.caption} numberOfLines={1}>
                {session?.user.email}
              </ThemedText>
            </View>

            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
          </Card>
        </Pressable>

        {/* Account is who you are, not a second navigation menu. Recurring,
            Away and Settle live in More and Owner tools — repeating them here
            was three ways to reach the same screen. */}
        {/* Informational, not a link. Owner tools and Household both live in
            More, and listing them here as well made three ways to reach one
            screen -- which is what this screen's own comment already said
            about Recurring, Away and Settle. */}
        <Group title="HOUSEHOLD">
          <Row
            icon="home-outline"
            label={household.data?.name ?? '…'}
            value={`${members.data?.length ?? 0} people`}
            last
          />
        </Group>

        {/* Its own group, not tucked under ABOUT: the free tier has no
            point-in-time recovery, so this file is the only thing standing
            between a mistake and a lost ledger. */}
        <Group title="YOUR DATA">
          <Row
            icon="download-outline"
            label={exporting ? 'Preparing…' : 'Export a backup'}
            value="CSV"
            onPress={exporting ? undefined : () => void saveBackup()}
            last
          />
        </Group>

        <Group title="ABOUT">
          {/* Registration is silent by design, so this is the only place that
              distinguishes "push is off" from "push is quietly broken". */}
          <Row
            icon="notifications-outline"
            label="Notifications"
            value={PUSH_LABELS[push].value}
            hint={PUSH_LABELS[push].hint}
          />
          <Row icon="cash-outline" label="Currency" value={household.data?.currency ?? 'INR'} />

          {/* The real identity, not a hardcoded string. Every APK built in one
              afternoon used to report "1.0.0", which made "is your build the
              one with the fix?" unanswerable. */}
          <Row
            icon="information-circle-outline"
            label="Version"
            value={buildLabel()}
            last={state === 'disabled'}
          />

          {state !== 'disabled' ? (
            <Row
              icon="cloud-download-outline"
              label={checking ? 'Checking…' : 'Check for updates'}
              value={tag ? `update ${tag}` : 'installed build'}
              onPress={checking ? undefined : () => void lookForUpdate()}
              last
            />
          ) : null}
        </Group>

        <Pressable
          onPress={confirmSignOut}
          style={({ pressed }) => [
            styles.signOut,
            { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
          ]}>
          <Ionicons name="log-out-outline" size={18} color={theme.danger} />
          <ThemedText style={[Type.body, { color: theme.danger, fontWeight: '600' }]}>
            Sign out
          </ThemedText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <ThemedText themeColor="textTertiary" style={Type.label}>
        {title}
      </ThemedText>
      <Card padded={false}>{children}</Card>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  hint,
  onPress,
  last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  /** A second line under the label. push.ts writes one for every state and
   *  nothing rendered it, so "Blocked" appeared with no explanation. */
  hint?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        { opacity: pressed && onPress ? 0.6 : 1 },
      ]}>
      <View style={[styles.rowIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Ionicons name={icon} size={16} color={theme.textSecondary} />
      </View>

      {/* The label never wraps to make room for the value — the value is the
          secondary information, so it truncates first. */}
      <View style={styles.rowLabel}>
        <ThemedText style={Type.body} numberOfLines={1}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText themeColor="textTertiary" style={Type.micro} numberOfLines={2}>
            {hint}
          </ThemedText>
        ) : null}
      </View>

      {value ? (
        <ThemedText themeColor="textTertiary" style={[Type.caption, styles.rowValue]} numberOfLines={1}>
          {value}
        </ThemedText>
      ) : null}

      {onPress ? <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },

  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  identity: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 },
  rolePill: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  roleText: { fontWeight: '700' },

  group: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flexShrink was 0, so a long household name — "The Rooftop Apartment,
  // Bandra West" — refused to give up any width and pushed the value and the
  // chevron clean off the card. The label still wins the space it needs; it
  // just yields once there is none left.
  rowLabel: { flexShrink: 1 },
  rowValue: { flex: 1, textAlign: 'right' },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
  },
});
