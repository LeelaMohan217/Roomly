import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { AVATAR_COLORS, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { humanError } from '@/lib/errors';
import { useMembers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Everything about you that you are allowed to change.
 *
 * Split into three cards because they fail in three different ways: a name
 * saves instantly, a household rename is owner-only, and an email change is
 * not real until you click a link in your inbox. One combined Save button
 * would have to explain all three outcomes at once.
 */
export default function AccountEditScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { member, session, refresh } = useSession();
  const members = useMembers();
  const isOwner = member?.role === 'owner';

  const me = members.data?.find((m) => m.id === member?.id);

  const [name, setName] = useState(member?.display_name ?? '');
  const [color, setColor] = useState<string | null>(null);
  // null means "untouched, show whatever the server says". Seeding this from
  // inside the query function would be a setState during a fetch.
  const [houseName, setHouseName] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

  // Through an RPC, not a direct update: members_owner_update is owner-only,
  // so a non-owner renaming themselves would have matched no policy, updated
  // zero rows and reported success. Silently.
  const saveProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('update_my_profile', {
        p_display_name: name.trim(),
        p_avatar_color: color,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setColor(null);
      await refresh();
      void queryClient.invalidateQueries();
    },
    onError: (e) => Alert.alert('Could not save', message(e)),
  });

  const saveHousehold = useMutation({
    mutationFn: async () => {
      // .select() so a policy that filters this row shows up as zero rows
      // instead of a silent success, which is how the delete bug hid.
      const { data, error } = await supabase
        .from('households')
        .update({ name: shownHouseName.trim() })
        .eq('id', member!.household_id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Only the owner can rename the household.');
    },
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (e) => Alert.alert('Could not rename', message(e)),
  });

  const changeEmail = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert(
        'Check your new inbox',
        `We sent a confirmation link to ${email.trim()}. Your sign-in email changes once you open it.`
      );
      setEmail('');
    },
    onError: (e) => Alert.alert('Could not change email', message(e)),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('Password changed', 'Any other device will need the new password.');
      setPassword('');
    },
    onError: (e) => Alert.alert('Could not change password', message(e)),
  });

  const trimmedName = name.trim();
  const nameDirty = trimmedName !== (member?.display_name ?? '') || color !== null;
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 40;

  const shownHouseName = houseName ?? household.data?.name ?? '';
  const houseDirty =
    shownHouseName.trim() !== (household.data?.name ?? '') && shownHouseName.trim() !== '';
  const emailValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const passwordShort = password.length > 0 && password.length < 8;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Edit your details" />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* ------------------------------- you ------------------------------- */}
        <Section title="YOU">
          <Card style={styles.card}>
            <View style={styles.preview}>
              <Avatar
                name={trimmedName || (member?.display_name ?? '?')}
                seed={member?.id}
                color={color ?? me?.avatarColor}
                size={56}
              />
              <View style={styles.swatches}>
                {AVATAR_COLORS.map(([hex]) => {
                  const active = (color ?? me?.avatarColor)?.toLowerCase() === hex.toLowerCase();
                  return (
                    <Pressable
                      key={hex}
                      accessibilityRole="button"
                      accessibilityLabel={`Avatar colour ${hex}`}
                      onPress={() => setColor(hex)}
                      style={({ pressed }) => [
                        styles.swatch,
                        {
                          backgroundColor: hex,
                          borderColor: active ? theme.text : 'transparent',
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            </View>

            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              autoCapitalize="words"
              editable={!saveProfile.isPending}
              hint="This is the name on every expense you add"
              error={trimmedName.length > 40 ? 'That name is too long' : undefined}
            />

            <Button
              title="Save"
              onPress={() => saveProfile.mutate()}
              loading={saveProfile.isPending}
              disabled={!nameDirty || !nameValid}
            />
          </Card>
        </Section>

        {/* ---------------------------- household ---------------------------- */}
        {isOwner ? (
          <Section title="HOUSEHOLD">
            <Card style={styles.card}>
              <TextField
                label="Name"
                value={shownHouseName}
                onChangeText={setHouseName}
                placeholder="Room 302"
                autoCapitalize="words"
                editable={!saveHousehold.isPending}
                hint="Everyone in the household sees this"
              />
              <Button
                title="Rename household"
                onPress={() => saveHousehold.mutate()}
                loading={saveHousehold.isPending}
                disabled={!houseDirty}
              />
            </Card>
          </Section>
        ) : null}

        {/* ----------------------------- sign-in ----------------------------- */}
        <Section title="SIGN-IN">
          <Card style={styles.card}>
            <View style={[styles.note, { backgroundColor: theme.backgroundSunken }]}>
              <Ionicons name="mail-outline" size={14} color={theme.textTertiary} />
              <ThemedText themeColor="textTertiary" style={[Type.micro, styles.flex]}>
                Signed in as {session?.user.email}
              </ThemedText>
            </View>

            <TextField
              label="New email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              editable={!changeEmail.isPending}
              hint="You confirm the change from a link sent to the new address"
            />
            <Button
              title="Send confirmation"
              variant="ghost"
              onPress={() => changeEmail.mutate()}
              loading={changeEmail.isPending}
              disabled={!emailValid}
            />
          </Card>

          <Card style={styles.card}>
            <TextField
              label="New password"
              value={password}
              onChangeText={setPassword}
              secure
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              editable={!changePassword.isPending}
              error={passwordShort ? 'Use at least 8 characters' : undefined}
            />
            <Button
              title="Change password"
              variant="ghost"
              onPress={() => changePassword.mutate()}
              loading={changePassword.isPending}
              disabled={password.length < 8}
            />
          </Card>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function message(e: unknown): string {
  return humanError(e);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText themeColor="textTertiary" style={Type.label}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  flex: { flex: 1 },

  section: { gap: Spacing.two },
  card: { gap: Spacing.three },

  preview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  swatches: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
});
