import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { humanError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Whether this build can pick a photo.
 *
 * expo-image-picker is a native module, so an APK built before it was added
 * does not have it -- and an EAS update can reach that APK. Importing the
 * package there throws at load, so callers check this first and the package
 * is only ever imported lazily, inside pickAndUploadPhoto.
 */
export function canPickPhoto(): boolean {
  return Platform.OS === 'web' || requireOptionalNativeModule('ExponentImagePicker') != null;
}

export type PhotoResult = { kind: 'saved' } | { kind: 'canceled' } | { kind: 'failed'; reason: string };

/**
 * Pick a photo, crop it square, upload it to your folder and point your
 * avatar at it. The old file is removed afterwards, best effort: a stray file
 * in your own folder costs storage, not correctness.
 */
export async function pickAndUploadPhoto(
  householdId: string,
  memberId: string,
  previousPath: string | null
): Promise<PhotoResult> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      // Avatars are drawn at most ~80pt; this keeps a phone photo well under
      // the bucket's 2 MB cap.
      quality: 0.5,
    });
    if (picked.canceled || !picked.assets?.[0]) return { kind: 'canceled' };

    const asset = picked.assets[0];
    const contentType = asset.mimeType ?? 'image/jpeg';
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    // A new name each time, so a cached copy of the old photo is never shown
    // under the new one's URL.
    const path = `${householdId}/${memberId}/${Date.now()}.${extension}`;

    const body = await (await fetch(asset.uri)).arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, body, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const { error: rpcError } = await supabase.rpc('set_my_photo', { p_path: path });
    if (rpcError) throw rpcError;

    if (previousPath) void supabase.storage.from('avatars').remove([previousPath]);
    return { kind: 'saved' };
  } catch (e) {
    return { kind: 'failed', reason: humanError(e) };
  }
}

/** Take your photo off your avatar and delete the file. */
export async function removePhoto(previousPath: string | null): Promise<PhotoResult> {
  const { error } = await supabase.rpc('set_my_photo', { p_path: null });
  if (error) return { kind: 'failed', reason: humanError(error) };
  if (previousPath) void supabase.storage.from('avatars').remove([previousPath]);
  return { kind: 'saved' };
}
