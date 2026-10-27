import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { Children, cloneElement, isValidElement, useState } from 'react';
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
        {/* The identity block opens Your details. A separate row would be a
            second thing to find for the same job. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your details"
          onPress={() => router.push('/account-edit')}>
          {/* Pressed is a tint, not a fade: opacity on an elevated card fades
              the Android shadow and the contents separately, leaving a pale
              band across a grey card. */}
          {({ pressed }) => (
            <Card
              padded={false}
              style={[styles.profile, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <Avatar name={member?.display_name ?? '?'} seed={member?.id} size={48} />

              {/* The role sits beside the email as plain words, not a coloured
                  pill: green on this screen is kept for things that are on. */}
              <View style={styles.identity}>
                <ThemedText style={styles.name} numberOfLines={1}>
                  {member?.display_name}
                </ThemedText>
                <ThemedText themeColor="textTertiary" style={Type.caption} numberOfLines={1}>
                  {isOwner ? 'Owner' : 'Member'} · {session?.user.email}
                </ThemedText>
              </View>

              <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
            </Card>
          )}
        </Pressable>

        {/* Account is who you are, not a second navigation menu. Owner tools,
            Household, Recurring, Away and Settle all live in More; listing
            them here as well made three ways to reach one screen. */}
        <Group title="Household">
          <Row
            icon="home-outline"
            label={household.data?.name ?? '…'}
            value={`${members.data?.length ?? 0} people`}
          />
          <Row icon="cash-outline" label="Currency" value={household.data?.currency ?? 'INR'} />
        </Group>

        {/* Its own group: the free tier has no point-in-time recovery, so this
            file is the only thing standing between a mistake and a lost
            ledger. */}
        <Group title="Your data">
          <Row
            icon="download-outline"
            label={exporting ? 'Preparing…' : 'Export a backup'}
            value="CSV"
            onPress={exporting ? undefined : () => void saveBackup()}
          />
        </Group>

        <Group title="App">
          {/* Registration is silent by design, so this is the only place that
              distinguishes "push is off" from "push is quietly broken". The
              explanation is a tap away rather than a line under every row. */}
          <Row
            icon="notifications-outline"
            label="Notifications"
            value={PUSH_LABELS[push].value}
            valueTone={push === 'on' ? 'positive' : push === 'blocked' ? 'warning' : undefined}
            onPress={() =>
              void dialog.alert({
                tone: push === 'on' ? 'success' : push === 'blocked' ? 'warning' : 'info',
                icon: 'notifications-outline',
                title: `Notifications ${PUSH_LABELS[push].value.toLowerCase()}`,
                message: PUSH_LABELS[push].hint,
              })
            }
          />

          {/* The real identity, not a hardcoded string. Every APK built in one
              afternoon used to report "1.0.0", which made "is your build the
              one with the fix?" unanswerable. */}
          <Row icon="information-circle-outline" label="Version" value={buildLabel()} />

          {state !== 'disabled' ? (
            <Row
              icon="cloud-download-outline"
              label={checking ? 'Checking…' : 'Check for updates'}
              value={tag ? `update ${tag}` : 'installed build'}
              onPress={checking ? undefined : () => void lookForUpdate()}
            />
          ) : null}
        </Group>

        {/* A row like the rest, in red because it is the one thing here that
            ends something; alone in its group so it is never tapped by
            accident on the way to another row. */}
        <Card padded={false}>
          <Row icon="log-out-outline" label="Sign out" tone="danger" onPress={confirmSignOut} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * A heading and one white card of rows. Sentence case at heading size: the
 * spaced capitals these were (Type.label) read as quiet as the values and
 * clipped their last letter on Android.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement<RowPosition>);

  return (
    <View style={styles.group}>
      <ThemedText style={styles.groupTitle}>{title}</ThemedText>
      <Card padded={false}>
        {rows.map((row, i) => cloneElement(row, { first: i === 0, last: i === rows.length - 1 }))}
      </Card>
    </View>
  );
}

/** Where a row sits in its card, for the divider and the pressed corners. */
type RowPosition = { first?: boolean; last?: boolean };

function Row({
  icon,
  label,
  value,
  valueTone,
  tone,
  onPress,
  first = true,
  last = true,
}: RowPosition & {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  /** Colours the value by what it means: green on, yellow needs attention. */
  valueTone?: 'positive' | 'warning';
  tone?: 'danger';
  onPress?: () => void;
}) {
  const theme = useTheme();
  const ink = tone === 'danger' ? theme.danger : theme.text;
  const valueInk =
    valueTone === 'positive' ? theme.positive : valueTone === 'warning' ? theme.warning : theme.textTertiary;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      // A tint, not a fade, as on the other lists; it follows the card's
      // corners on the first and last rows.
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        pressed && onPress && { backgroundColor: theme.backgroundSelected },
        pressed && onPress && first && styles.rowFirst,
        pressed && onPress && last && styles.rowLast,
      ]}>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: tone === 'danger' ? theme.dangerSoft : theme.backgroundSelected },
        ]}>
        <Ionicons name={icon} size={17} color={tone === 'danger' ? theme.danger : theme.text} />
      </View>

      {/* The label never wraps to make room for the value — the value is the
          secondary information, so it truncates first. */}
      <View style={styles.rowLabel}>
        <ThemedText style={[Type.body, { color: ink }]} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>

      {value ? (
        <ThemedText style={[Type.caption, styles.rowValue, { color: valueInk }]} numberOfLines={1}>
          {value}
        </ThemedText>
      ) : (
        <View style={styles.flex} />
      )}

      {onPress && tone !== 'danger' ? (
        <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },

  flex: { flex: 1 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  identity: { flex: 1, gap: 2 },
  name: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },

  group: { gap: Spacing.two },
  groupTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
    letterSpacing: -0.3,
    paddingLeft: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  rowFirst: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  rowLast: { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
  // A soft square, as in the reference: rounder than a chip, not a circle,
  // so these read as settings rather than as people or expenses.
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flexShrink was 0, so a long household name — "The Rooftop Apartment,
  // Bandra West" — refused to give up any width and pushed the value and the
  // chevron clean off the card. The label still wins the space it needs; it
  // just yields once there is none left.
  rowLabel: { flexShrink: 1 },
  rowValue: { flex: 1, textAlign: 'right' },
});
