import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  canTakePhoto,
  loadAttachments,
  MAX_PHOTOS,
  pickBillPhotos,
  removeAttachment,
  uploadBillPhotos,
  type Attachment,
  type PickedPhoto,
} from '@/lib/attachments';
import { humanError } from '@/lib/errors';
import { canPickPhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';

const TILE = 72;

/** An expense's photos, signed. Shared by the strip and the edit form's room count. */
export function useExpenseAttachments(expenseId: string) {
  return useQuery({
    queryKey: ['expense-attachments', expenseId],
    queryFn: () => loadAttachments(expenseId),
    // The URLs are signed for a week; there is no need to re-sign on every
    // visit.
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Bill photos chosen on the form, before the expense exists. They are only
 * uploaded once it is saved -- the caller does that with uploadBillPhotos().
 *
 * Renders nothing on an APK without the picker module.
 */
export function BillPhotoPicker({
  photos,
  onChange,
  max = MAX_PHOTOS,
  disabled = false,
}: {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  /** How many may be chosen here: fewer when the expense already has some. */
  max?: number;
  disabled?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);

  if (!canPickPhoto() || max <= 0) return null;

  async function add(source: 'library' | 'camera') {
    setNote(null);
    const result = await pickBillPhotos(source, max - photos.length);
    if (result.kind === 'picked') {
      onChange([...photos, ...result.photos]);
      setNote(result.skipped);
    } else if (result.kind === 'failed') {
      setNote(result.reason);
    }
  }

  return (
    <View style={styles.field}>
      <View style={styles.head}>
        <ThemedText style={styles.sectionTitle}>Bill photos</ThemedText>
        <ThemedText themeColor="textTertiary" style={Type.caption}>
          {photos.length > 0 ? `${photos.length} of ${max}` : 'Optional'}
        </ThemedText>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.strip}>
        {photos.map((p, i) => (
          <Thumb
            key={p.uri}
            uri={p.uri}
            label={`Photo ${i + 1}`}
            onRemove={disabled ? undefined : () => onChange(photos.filter((x) => x !== p))}
          />
        ))}
        {photos.length < max ? (
          <AddTiles disabled={disabled} onAdd={add} />
        ) : null}
      </ScrollView>
      {note ? <Notice tone="warning" message={note} /> : null}
    </View>
  );
}

/**
 * An expense's photos on its screen. Tap one to see it full size. Anyone in
 * the household may add one (0040); the person who added a photo, or the
 * owner, may remove it.
 */
export function ExpensePhotos({ expenseId, canAdd }: { expenseId: string; canAdd: boolean }) {
  const theme = useTheme();
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const photos = useExpenseAttachments(expenseId);

  const upload = useMutation({
    mutationFn: async (picked: PickedPhoto[]) =>
      uploadBillPhotos(member!.household_id, member!.id, expenseId, picked),
    onMutate: () => setNote(null),
    onSuccess: ({ failed, reason }) => {
      if (failed > 0) {
        setNote(`${failed === 1 ? 'A photo' : `${failed} photos`} did not upload. ${reason ?? ''}`.trim());
      }
    },
    onError: (e) => setNote(humanError(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expense-attachments', expenseId] }),
  });

  const remove = useMutation({
    mutationFn: removeAttachment,
    onSuccess: () => setOpen(null),
    onError: (e) => setNote(humanError(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expense-attachments', expenseId] }),
  });

  const list = photos.data ?? [];
  const room = MAX_PHOTOS - list.length;
  const showAdd = canAdd && canPickPhoto() && room > 0 && !photos.isError && !photos.isLoading;

  // Nothing to show and nothing to do: no heading for an empty section.
  if (photos.data && list.length === 0 && !showAdd) return null;

  async function add(source: 'library' | 'camera') {
    setNote(null);
    const result = await pickBillPhotos(source, room);
    if (result.kind === 'picked') {
      setNote(result.skipped);
      upload.mutate(result.photos);
    } else if (result.kind === 'failed') {
      setNote(result.reason);
    }
  }

  async function confirmRemove(a: Attachment) {
    const ok = await dialog.confirm({
      tone: 'danger',
      icon: 'trash-outline',
      title: 'Remove this photo?',
      message: 'It is deleted for everyone in the household.',
      confirmLabel: 'Remove',
    });
    if (ok) remove.mutate(a);
  }

  const current = open !== null ? list[open] : undefined;

  return (
    <View style={styles.field}>
      <View style={styles.head}>
        <ThemedText style={styles.sectionTitle}>Bill photos</ThemedText>
        {list.length > 0 ? (
          <ThemedText themeColor="textTertiary" style={Type.caption}>
            {list.length}
          </ThemedText>
        ) : null}
      </View>

      {photos.isError ? (
        <Notice tone="danger" message={`Couldn’t load the photos. ${humanError(photos.error)}`} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {photos.isLoading
            ? [0, 1].map((i) => <Skeleton key={i} width={TILE} height={TILE} radius={Radius.md} />)
            : list.map((a, i) => (
                <Thumb key={a.id} uri={a.url} label={`Bill photo ${i + 1}`} onPress={() => setOpen(i)} />
              ))}
          {upload.isPending ? (
            <View
              accessible
              accessibilityLabel="Uploading"
              style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : showAdd ? (
            <AddTiles onAdd={add} />
          ) : null}
        </ScrollView>
      )}

      {note ? <Notice tone="warning" message={note} /> : null}

      <PhotoViewer
        photos={list}
        index={open}
        onIndexChange={setOpen}
        onClose={() => setOpen(null)}
        canRemove={
          !!current && (current.uploadedBy === member?.id || member?.role === 'owner')
        }
        removing={remove.isPending}
        onRemove={() => current && void confirmRemove(current)}
      />
    </View>
  );
}

function Thumb({
  uri,
  label,
  onPress,
  onRemove,
}: {
  uri: string;
  label: string;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  return (
    <View>
      <Pressable
        accessibilityRole={onPress ? 'imagebutton' : 'image'}
        accessibilityLabel={label}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tile,
          { backgroundColor: theme.backgroundSelected, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
        ]}>
        <Image source={{ uri }} style={styles.thumb} contentFit="cover" transition={150} />
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label.toLowerCase()}`}
          onPress={onRemove}
          hitSlop={8}
          style={[styles.removeBadge, { backgroundColor: theme.text, borderColor: theme.background }]}>
          <Ionicons name="close" size={12} color={theme.background} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Gallery always; Camera only on an APK whose manifest allows it. */
function AddTiles({
  onAdd,
  disabled = false,
}: {
  onAdd: (source: 'library' | 'camera') => void;
  disabled?: boolean;
}) {
  const camera = canTakePhoto();
  return (
    <>
      <AddTile icon="images-outline" label="Gallery" disabled={disabled} onPress={() => onAdd('library')} />
      {camera ? (
        <AddTile icon="camera-outline" label="Camera" disabled={disabled} onPress={() => onAdd('camera')} />
      ) : null}
    </>
  );
}

function AddTile({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add a bill photo from the ${label.toLowerCase()}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        styles.addTile,
        { borderColor: theme.borderStrong, opacity: pressed || disabled ? 0.6 : 1 },
      ]}>
      <Ionicons name={icon} size={20} color={theme.textSecondary} />
      <ThemedText themeColor="textSecondary" style={Type.micro}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Full size, one at a time, swiped sideways. Dark whatever the theme: it is a photo. */
function PhotoViewer({
  photos,
  index,
  onIndexChange,
  onClose,
  canRemove,
  removing,
  onRemove,
}: {
  photos: Attachment[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const { width } = useWindowDimensions();
  const visible = index !== null && index < photos.length;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent>
      <SafeAreaView style={styles.viewer}>
        <View style={styles.viewerBar}>
          <ViewerButton icon="close" label="Close" onPress={onClose} />
          <ThemedText style={[Type.caption, styles.viewerCount]}>
            {visible ? `${index + 1} of ${photos.length}` : ''}
          </ThemedText>
          {canRemove ? (
            <ViewerButton icon="trash-outline" label="Remove photo" busy={removing} onPress={onRemove} />
          ) : (
            <View style={styles.viewerButton} />
          )}
        </View>
        {visible ? (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(a) => a.id}
            onMomentumScrollEnd={(e) => onIndexChange(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index: i }) => (
              <View style={{ width }}>
                <Image
                  source={{ uri: item.url }}
                  style={styles.full}
                  contentFit="contain"
                  accessibilityLabel={`Bill photo ${i + 1} of ${photos.length}`}
                />
              </View>
            )}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function ViewerButton({
  icon,
  label,
  onPress,
  busy = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.viewerButton, { opacity: pressed ? 0.6 : 1 }]}>
      {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name={icon} size={22} color="#fff" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Sentence case at heading size, as on the rest of the form.
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.3 },
  // Room at the top right for the remove badge, which overhangs its tile.
  strip: { gap: Spacing.two, paddingTop: Spacing.two, paddingRight: Spacing.two },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: '100%', height: '100%' },
  addTile: { borderStyle: 'dashed', borderWidth: 1, gap: 2 },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  viewerCount: { color: '#fff' },
  viewerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  full: { flex: 1 },
});
