import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * Which build is this, and is it running an over-the-air update?
 *
 * Both halves matter, and they are different things. The APK someone installed
 * is one identity; the JS bundle actually running may be newer, because an OTA
 * update replaces the bundle without replacing the app. "It's still broken"
 * needs both answers to be diagnosable at all.
 */

type Extra = { buildNumber?: number; buildTime?: string };

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** e.g. "1.0.0 (build 4)". Stamped by scripts/stamp-build.mjs. */
export function buildLabel(): string {
  const version = Constants.expoConfig?.version ?? '?';
  const n = extra.buildNumber;
  return n ? `${version} (build ${n})` : version;
}

/** When the APK was built, or null on an unstamped build. */
export function buildTime(): string | null {
  return extra.buildTime ?? null;
}

export type UpdateState =
  /** expo-updates is not active -- a dev client, or updates disabled. */
  | 'disabled'
  /** Running the bundle that shipped inside the APK. */
  | 'embedded'
  /** Running a bundle downloaded over the air. */
  | 'updated';

export function updateState(): UpdateState {
  if (!Updates.isEnabled) return 'disabled';
  // isEmbeddedLaunch, NOT updateId. The embedded bundle has a UUID of its own,
  // so updateId is non-null on a completely fresh install -- which made the
  // Account row claim "update c0664217" on a build that had never seen an OTA.
  return Updates.isEmbeddedLaunch ? 'embedded' : 'updated';
}

/**
 * A short, human-comparable id for the running OTA bundle.
 *
 * The full updateId is a UUID; nobody is reading that over a phone call. Eight
 * characters is enough to tell two updates apart, which is all it is for.
 */
export function updateTag(): string | null {
  // Only meaningful once a downloaded update is running: the embedded id
  // identifies the APK, which the version row already names.
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return null;
  return Updates.updateId.slice(0, 8);
}

/** The channel this build listens to, when one was pinned. */
export function updateChannel(): string | null {
  return Updates.channel ?? null;
}

/**
 * Ask for an update now, and report what happened in words.
 *
 * Deliberately does NOT reload the app on its own. Restarting under someone
 * mid-way through typing an expense is worse than making them tap twice.
 */
export type CheckOutcome =
  | { kind: 'unavailable' }
  | { kind: 'none' }
  | { kind: 'downloaded' }
  /**
   * Already downloaded on a previous launch and waiting for a restart.
   *
   * This is NOT the same as 'none', and reporting it as such is what made a
   * published update look like it had never arrived: EXPO_UPDATES_CHECK_ON_LAUNCH
   * is ALWAYS with LAUNCH_WAIT_MS 0, so the app fetches in the background and
   * applies on the NEXT launch. By the time somebody taps the button, the new
   * bundle is on the phone -- so checkForUpdateAsync() correctly answers "nothing
   * newer available", and the screen then said "You are on the latest version"
   * while showing the old build number. Both true, together useless.
   */
  | { kind: 'pending' }
  /** Reachable but nothing published to this channel, or the channel is new. */
  | { kind: 'nothing-published' }
  | { kind: 'offline' };

/**
 * Ask for an update now, and say which of several different things happened.
 *
 * The first version collapsed every failure into "try again when you have
 * signal", which was actively misleading: the overwhelmingly likely cause is
 * that no update has ever been published to the channel, and telling someone
 * on full LTE to find signal sends them looking in the wrong place.
 *
 * Deliberately does NOT reload the app on its own. Restarting under someone
 * mid-way through typing an expense is worse than making them tap twice.
 */
export async function checkForUpdate(alreadyPending = false): Promise<CheckOutcome> {
  if (!Updates.isEnabled) return { kind: 'unavailable' };

  // Checked before asking the server anything. An update downloaded on a
  // previous launch is already here, and the server will correctly say there
  // is nothing newer -- which is the opposite of what the person needs to
  // hear.
  //
  // Passed in rather than read here: in SDK 57 this lives on the useUpdates()
  // hook, and this module stays free of hooks so it can be reasoned about (and
  // tested) as plain functions.
  if (alreadyPending) return { kind: 'pending' };

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return { kind: 'none' };
    await Updates.fetchUpdateAsync();
    return { kind: 'downloaded' };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).toLowerCase();
    const looksOffline =
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('internet') ||
      message.includes('timeout') ||
      message.includes('unreachable');
    return looksOffline ? { kind: 'offline' } : { kind: 'nothing-published' };
  }
}

/** Apply a downloaded update. Restarts the app. */
export async function applyUpdate(): Promise<void> {
  await Updates.reloadAsync();
}
