import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Touch feedback, and nothing that can throw.
 *
 * Every call is fire-and-forget inside a try/catch. Haptics are a nicety --
 * they are unavailable on web, silently absent on some Android hardware, and
 * switched off entirely by a system setting. None of that is worth an
 * unhandled rejection in the middle of saving an expense, so failure here is
 * always silent.
 *
 * Deliberately three levels and no more. Feedback that fires on everything
 * stops meaning anything, so: `tap` for a keypress, `commit` for something
 * that changed the ledger, `reject` for something refused.
 */

const enabled = Platform.OS !== 'web';

function fire(run: () => Promise<void>) {
  if (!enabled) return;
  try {
    void run().catch(() => {});
  } catch {
    // A missing native module on an older build must not surface here.
  }
}

/** A key, a digit, a toggle. The lightest thing available. */
export function tapped() {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** An expense saved, a payment marked, a member added. */
export function committed() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** A save refused: a closed month, a bad split, a rejected password. */
export function rejected() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
