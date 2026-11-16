import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ScreenHeader } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { useDialog } from '@/components/ui/dialog';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPhone } from '@/lib/phone';
import { canPickPhoto, pickAndUploadPhoto, removePhoto, type PhotoResult } from '@/lib/photo';
import { useMemberPhotos, useMembers, useMyPhone } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Your details, read-only: photo or person glyph, your name, what you sign
 * in with, your role, and the household you are in. Opened from the card at
 * the top of More; everything else that used to sit on an Account screen
 * lives in More itself.
 *
 * Rows carry an icon and the value, no label -- an envelope beside an address
 * says "email" already. The photo is the one thing you can change here:
 * editing the rest is switched off for now, and the form it had (name,
 * household, email, phone, password in one sheet) is in git history.
 */
export default function AccountEditScreen() {
  const theme = useTheme();
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { member, session } = useSession();
  const isOwner = member?.role === 'owner';
  const myPhone = useMyPhone(session?.user.id);
  const members = useMembers();

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

  const photos = useMemberPhotos();
  const myPhoto = member ? photos.data?.[member.id] : undefined;
  const pickable = canPickPhoto();
  const [busy, setBusy] = useState(false);

  async function finish(result: PhotoResult, done: string) {
    setBusy(false);
    if (result.kind === 'saved') {
      void queryClient.invalidateQueries({ queryKey: ['member-photos'] });
      dialog.toast({ message: done });
    } else if (result.kind === 'failed') {
      void dialog.alert({ tone: 'danger', title: 'Could not save the photo', message: result.reason });
    }
  }

  async function choosePhoto() {
    if (!member) return;
    setBusy(true);
    await finish(
      await pickAndUploadPhoto(member.household_id, member.id, myPhoto?.path ?? null),
      'Photo saved'
    );
  }

  async function dropPhoto() {
    setBusy(true);
    await finish(await removePhoto(myPhoto?.path ?? null), 'Photo removed');
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Your details" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Who you are, at a glance. A plain person glyph until photos
            arrive -- no colour, so nothing here competes with the money
            colours elsewhere. */}
        <View style={styles.hero}>
          {/* Tap the avatar to choose a photo; the camera badge says so. Only
              in builds that include the picker -- older APKs get the plain
              avatar, since an update cannot add a native module. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={myPhoto ? 'Change your photo' : 'Add a photo'}
            disabled={!pickable || busy}
            onPress={() => void choosePhoto()}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <Avatar name={member?.display_name ?? '?'} seed={member?.id} size={84} icon />
            {pickable ? (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: theme.primary, borderColor: theme.background },
                ]}>
                {busy ? (
                  <ActivityIndicator size="small" color={theme.onPrimary} />
                ) : (
                  <Ionicons name="camera" size={15} color={theme.onPrimary} />
                )}
              </View>
            ) : null}
          </Pressable>

          <ThemedText style={styles.heroName} numberOfLines={1}>
            {member?.display_name}
          </ThemedText>

          {pickable && myPhoto ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void dropPhoto()}
              hitSlop={8}
              style={({ pressed }) => [
                styles.pill,
                { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
              ]}>
              <ThemedText themeColor="textSecondary" style={styles.pillText}>
                Remove photo
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <Card padded={false}>
          <Detail icon="mail-outline" label="Email" value={session?.user.email ?? ''} first />
          <Detail
            icon="call-outline"
            label="Phone"
            value={myPhone.data ? formatPhone(myPhone.data) : 'No number added'}
          />
          <Detail icon="shield-checkmark-outline" label="Role" value={isOwner ? 'Owner' : 'Member'} />
        </Card>

        {/* The household you are in: the facts the old Account screen showed,
            here with the rest of who you are. */}
        <View style={styles.group}>
          <ThemedText style={styles.groupTitle}>Household</ThemedText>
          <Card padded={false}>
            <Detail
              icon="home-outline"
              label="Household"
              value={household.data?.name ?? '…'}
              trail={`${members.data?.length ?? 0} people`}
              first
            />
            <Detail icon="cash-outline" label="Currency" value={household.data?.currency ?? 'INR'} />
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** One detail: its icon and the value. `label` is for screen readers only. */
function Detail({
  icon,
  label,
  value,
  trail,
  first = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  /** A quiet second fact at the right: "4 people". */
  trail?: string;
  first?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${value}${trail ? `, ${trail}` : ''}`}
      style={[
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
      ]}>
      <View style={[styles.rowIcon, { backgroundColor: theme.liftTile }]}>
        <Ionicons name={icon} size={18} color={theme.brandInk} />
      </View>
      <ThemedText style={[Type.body, styles.flex]} numberOfLines={1}>
        {value}
      </ThemedText>
      {trail ? (
        <ThemedText themeColor="textTertiary" style={Type.caption}>
          {trail}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },

  hero: { alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.two },
  heroName: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.4 },
  // Overlaps the avatar's lower right, ringed in the page colour so it reads
  // as sitting on top.
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    minHeight: 30,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  group: { gap: Spacing.two + 2 },
  groupTitle: { fontSize: 19, lineHeight: 25, fontWeight: '500', letterSpacing: -0.4, paddingLeft: Spacing.half },
  // A soft square, as on More's rows.
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
