import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MonthCalendar } from '@/components/ui/month-calendar';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRange } from '@/lib/dates';
import { humanError } from '@/lib/errors';
import { useMembers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function HouseholdScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const isOwner = member?.role === 'owner';

  const members = useMembers();

  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinedOn, setJoinedOn] = useState<string | null>(null);
  const [pickingJoined, setPickingJoined] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  const addMember = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await supabase.rpc('add_placeholder_member', {
        p_name: name.trim(),
        p_email: email.trim() || null,
        // Null lets the server default to the household's own start date
        // rather than today. joined_on was unsettable until migration 0028,
        // and check_split_residency refuses any split dated before it — so a
        // housemate added in March could not be given a share of January.
        p_joined_on: joinedOn,
      });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      setName('');
      setEmail('');
      setJoinedOn(null);
      setError(null);
      setAddOpen(false);
      void queryClient.invalidateQueries();
    },
    onError: (e) => setError(humanError(e)),
  });

  // Goes through an RPC rather than a direct delete. members has no DELETE
  // policy, and under RLS that is not an error — it filters, removes zero
  // rows and reports success, which is why the trash icon used to do nothing
  // at all. The function also decides between deleting and moving out, since
  // only the server can see whether they have any financial history.
  const removeMember = useMutation({
    mutationFn: async ({ id }: { id: string; name: string }) => {
      const { data, error: rpcError } = await supabase.rpc('remove_member', {
        p_member_id: id,
      });
      if (rpcError) throw rpcError;
      return data as 'deleted' | 'moved_out';
    },
    onSuccess: (outcome, { name }) => {
      void queryClient.invalidateQueries();
      // A plain delete needs no announcement — they simply disappear. A
      // move-out does, because the name stays on every past expense.
      if (outcome === 'moved_out') {
        Alert.alert(
          `${name} has moved out`,
          'Their past expenses and balances stay exactly as they are. They just will not be part of any new split.'
        );
      }
    },
    onError: (e) => Alert.alert('Could not remove', humanError(e)),
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('create_invite', {
        p_max_uses: 1,
        p_valid_days: 7,
      });
      if (rpcError) throw rpcError;
      return data as string;
    },
    onSuccess: (code) => {
      setInviteCode(code);
      setCopied(false);
    },
    onError: (e) => setError(humanError(e)),
  });

  function confirmRemove(id: string, who: string) {
    Alert.alert(
      `Remove ${who}?`,
      'If they have no expenses yet they are removed outright. If they do, their history stays and they are marked as moved out instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMember.mutate({ id, name: who }),
        },
      ]
    );
  }

  const list = members.data ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Household" subtitle={`${list.length} people`} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* The list is the screen. Everything else is an action below it. */}
        <Card padded={false}>
          {list.map((m, i) => {
            const joined = !!m.userId;
            return (
              <View
                key={m.id}
                style={[
                  styles.row,
                  i < list.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.border,
                  },
                ]}>
                <Avatar
                  name={m.displayName}
                  seed={m.id}
                  size={40}
                  style={joined ? undefined : styles.dim}
                />

                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <ThemedText style={Type.body} numberOfLines={1}>
                      {m.displayName}
                      {m.id === member?.id ? ' (you)' : ''}
                    </ThemedText>
                    {m.role === 'owner' ? (
                      <View style={[styles.pill, { backgroundColor: theme.primarySoft }]}>
                        <ThemedText style={[Type.micro, { color: theme.primary, fontWeight: '700' }]}>
                          Owner
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                  <ThemedText themeColor="textTertiary" style={Type.micro}>
                    {joined ? 'Joined' : 'Waiting to claim their account'}
                  </ThemedText>
                </View>

                {/* Anyone but yourself and the owner. Someone who has already
                    paid for things is no longer un-removable — they are moved
                    out instead, which keeps their history intact. */}
                {isOwner && m.role !== 'owner' && m.id !== member?.id ? (
                  <Pressable onPress={() => confirmRemove(m.id, m.displayName)} hitSlop={14}>
                    <Ionicons name="trash-outline" size={17} color={theme.textTertiary} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </Card>

        {isOwner ? (
          <View style={styles.actions}>
            <Button title="＋  Add housemate" onPress={() => setAddOpen(true)} />
            <Button
              title="Invite with a code"
              variant="ghost"
              onPress={() => {
                setError(null);
                setInviteOpen(true);
              }}
            />
          </View>
        ) : (
          <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
            <Ionicons name="lock-closed-outline" size={14} color={theme.textTertiary} />
            <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
              Only the owner can add or remove people.
            </ThemedText>
          </View>
        )}
      </ScrollView>

      <Sheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a housemate"
        subtitle="They claim their account later — all their expenses come with them">
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Ravi"
          autoCapitalize="words"
          editable={!addMember.isPending}
        />

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="Optional"
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!addMember.isPending}
          hint="Just a reminder of who this is — no email is sent"
        />

        <Pressable onPress={() => setPickingJoined(true)} disabled={addMember.isPending}>
          <View style={styles.field}>
            <ThemedText themeColor="textTertiary" style={Type.label}>
              LIVING HERE SINCE
            </ThemedText>
            <View style={[styles.dateBox, { backgroundColor: theme.backgroundSunken }]}>
              <Ionicons name="calendar-outline" size={15} color={theme.textTertiary} />
              <ThemedText style={[Type.body, styles.flex]}>
                {joinedOn ? formatRange(joinedOn, joinedOn) : 'Since the household started'}
              </ThemedText>
              <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
            </View>
            <ThemedText themeColor="textTertiary" style={Type.micro}>
              They cannot be given a share of anything dated before this.
            </ThemedText>
          </View>
        </Pressable>

        {error ? (
          <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
            <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
              {error}
            </ThemedText>
          </View>
        ) : null}

        <Button
          title="Add to household"
          onPress={() => addMember.mutate()}
          loading={addMember.isPending}
          disabled={!name.trim()}
        />
      </Sheet>

      <Sheet
        visible={pickingJoined}
        title="Living here since"
        subtitle="Pick the day they moved in. Leave it alone if they have been here all along."
        onClose={() => setPickingJoined(false)}>
        <MonthCalendar
          year={pickerMonth.year}
          month={pickerMonth.month}
          onMonthChange={(year, month) => setPickerMonth({ year, month })}
          start={joinedOn}
          end={joinedOn}
          onDayPress={(iso) => {
            setJoinedOn(iso);
            setPickingJoined(false);
          }}
        />
      </Sheet>

      <Sheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite with a code"
        subtitle="They claim their name on their own phone — you still approve it">
        {inviteCode ? (
          <>
            <View style={[styles.codeBox, { backgroundColor: theme.backgroundSunken }]}>
              <ThemedText style={styles.code}>{inviteCode}</ThemedText>
              <ThemedText themeColor="textTertiary" style={Type.micro}>
                Valid 7 days · single use
              </ThemedText>
            </View>
            <Button
              title={copied ? 'Copied' : 'Copy code'}
              onPress={async () => {
                await Clipboard.setStringAsync(inviteCode);
                setCopied(true);
              }}
            />
          </>
        ) : (
          <>
            {/* The error state was written here but rendered only inside the
                Add-a-housemate sheet, so a failed "Create a code" stopped its
                spinner and did nothing else — forever. */}
            {error ? (
              <View style={[styles.note, { backgroundColor: theme.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
                <ThemedText style={[Type.micro, styles.flex, { color: theme.danger }]}>
                  {error}
                </ThemedText>
              </View>
            ) : null}
            <Button
              title="Create a code"
              onPress={() => createInvite.mutate()}
              loading={createInvite.isPending}
            />
          </>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  dateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  flex: { flex: 1 },
  dim: { opacity: 0.45 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pill: { borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: 1 },

  actions: { gap: Spacing.two },
  codeBox: { borderRadius: Radius.md, padding: Spacing.four, alignItems: 'center', gap: Spacing.one },
  code: { fontSize: 28, fontWeight: '700', letterSpacing: 6 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
});
