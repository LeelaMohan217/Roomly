import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { humanError } from '@/lib/errors';
import { canPickPhoto } from '@/lib/photo';
import { supabase } from '@/lib/supabase';

/**
 * Bill photos on an expense (migration 0040).
 *
 * Files go to the private 'expense-attachments' bucket under your own folder,
 * <household>/<member>/<file> -- the same layout as avatars, so the storage
 * policy is the same "your own folder" rule -- and a row in
 * expense_attachments ties each one to its expense. The household reads them
 * through signed URLs; nobody outside it can.
 *
 * Like photo.ts, expo-image-picker is only imported lazily, inside the pick
 * functions: callers check canPickPhoto() first, so an older APK without the
 * module never loads it.
 */

/** The database refuses a sixth (0040's trigger); the picker stops at five. */
export const MAX_PHOTOS = 5;

/** The bucket's own limit. The picker compresses well below it. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The first APK with the camera permission in its manifest. Every build
 * before it was made with `cameraPermission: false`, which strips CAMERA, and
 * the picker refuses to open the camera without it.
 */
const CAMERA_SINCE_VERSION_CODE = 22;

const BUCKET = 'expense-attachments';

export type PickedPhoto = { uri: string; mimeType: string };

export type PickResult =
  | { kind: 'picked'; photos: PickedPhoto[]; skipped: string | null }
  | { kind: 'canceled' }
  | { kind: 'failed'; reason: string };

/**
 * Whether this APK can take a photo, as opposed to only picking one.
 *
 * Asked of the APK's own versionCode rather than the bundle's app.json: an EAS
 * update carries the newest app.json to every phone, while the manifest that
 * decides the permission is whatever the phone installed. ExpoApplication is
 * linked in every build (expo-notifications depends on it); optional anyway,
 * so a build without it just shows no camera.
 */
export function canTakePhoto(): boolean {
  if (Platform.OS !== 'android' || !canPickPhoto()) return false;
  const app = requireOptionalNativeModule<{ nativeBuildVersion?: string | null }>('ExpoApplication');
  return Number(app?.nativeBuildVersion ?? 0) >= CAMERA_SINCE_VERSION_CODE;
}

/**
 * Pick up to `room` photos from the phone's files, or take one with the
 * camera.
 *
 * `legacy: true` on the gallery: Android's newer photo picker opens on Google
 * Photos, cloud albums and all, and housemates wanted the photos and
 * screenshots that are actually on the phone. The legacy picker is the
 * system file chooser, which opens on the phone's own images.
 */
export async function pickBillPhotos(source: 'library' | 'camera', room: number): Promise<PickResult> {
  if (room <= 0) return { kind: 'canceled' };
  try {
    const ImagePicker = await import('expo-image-picker');

    let picked;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        return {
          kind: 'failed',
          reason: 'Roomly needs the camera to photograph a bill. Allow it in your phone’s settings, or pick a photo instead.',
        };
      }
      picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    } else {
      picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        legacy: true,
        allowsMultipleSelection: room > 1,
        selectionLimit: room,
        // A receipt is text: this keeps it readable and well under the cap.
        quality: 0.6,
      });
    }
    if (picked.canceled || !picked.assets?.length) return { kind: 'canceled' };

    const fits = picked.assets.filter((a) => !a.fileSize || a.fileSize <= MAX_BYTES);
    const photos = fits.slice(0, room).map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg' }));

    const tooBig = picked.assets.length - fits.length;
    const overLimit = fits.length - photos.length;
    const skipped =
      tooBig > 0
        ? `${tooBig === 1 ? 'One photo was' : `${tooBig} photos were`} over 5 MB and left out.`
        : overLimit > 0
          ? `Only ${MAX_PHOTOS} photos fit on one expense, so ${overLimit} ${overLimit === 1 ? 'was' : 'were'} left out.`
          : null;

    if (photos.length === 0) return { kind: 'failed', reason: skipped ?? 'That photo could not be used.' };
    return { kind: 'picked', photos, skipped };
  } catch (e) {
    return { kind: 'failed', reason: humanError(e) };
  }
}

/**
 * Upload photos and attach them to an expense, one at a time. Returns how
 * many failed and why the first did, so the caller can say so -- the expense
 * itself is already saved, and a photo can be added again from its screen.
 */
export async function uploadBillPhotos(
  householdId: string,
  memberId: string,
  expenseId: string,
  photos: PickedPhoto[]
): Promise<{ failed: number; reason: string | null }> {
  let failed = 0;
  let reason: string | null = null;

  for (const [i, photo] of photos.entries()) {
    const extension =
      photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const path = `${householdId}/${memberId}/${expenseId}-${Date.now()}-${i}.${extension}`;

    try {
      const body = await (await fetch(photo.uri)).arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, body, { contentType: photo.mimeType, upsert: false });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase.from('expense_attachments').insert({
        household_id: householdId,
        expense_id: expenseId,
        path,
        uploaded_by: memberId,
      });
      if (rowError) {
        // A file with no row is invisible; take it back out, best effort.
        void supabase.storage.from(BUCKET).remove([path]);
        throw rowError;
      }
    } catch (e) {
      failed += 1;
      reason ??= humanError(e);
    }
  }

  return { failed, reason };
}

export type Attachment = {
  id: string;
  path: string;
  uploadedBy: string;
  url: string;
};

/**
 * An expense's photos with a URL each. Signed for a week, so a URL kept in
 * the persisted query cache still opens after a restart.
 */
export async function loadAttachments(expenseId: string): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from('expense_attachments')
    .select('id, path, uploaded_by')
    .eq('expense_id', expenseId)
    .order('created_at');
  if (error) throw error;
  if (data.length === 0) return [];

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      data.map((a) => a.path as string),
      60 * 60 * 24 * 7
    );
  if (signError) throw signError;

  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return data.flatMap((a) => {
    const url = urlByPath.get(a.path as string);
    return url
      ? [{ id: a.id as string, path: a.path as string, uploadedBy: a.uploaded_by as string, url }]
      : [];
  });
}

/** Take a photo off an expense and delete the file. */
export async function removeAttachment(attachment: Attachment): Promise<void> {
  const { error } = await supabase.from('expense_attachments').delete().eq('id', attachment.id);
  if (error) throw error;
  // The row is what makes it visible, so a leftover file is only storage.
  void supabase.storage.from(BUCKET).remove([attachment.path]);
}
