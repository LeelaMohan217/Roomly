import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useDialog } from '@/components/ui/dialog';
import { applyUpdate } from '@/lib/build-info';

/**
 * "Update ready -- Restart now" as soon as a new version has downloaded.
 *
 * expo-updates already checks on every launch and downloads in the
 * background, but applies what it fetched only on the NEXT cold start -- and
 * says nothing. So housemates ran the old version for days without knowing
 * there was a new one, unless they found Settings -> Check for updates.
 *
 * Only on the four tabs. Add expense and the expense screen (where editing
 * happens) are routes of their own, so a pathname check keeps the popup from
 * landing on somebody half-way through typing an amount; it waits for them
 * to come back. "Later" means later: not again for that update this session,
 * and the next cold start applies it anyway.
 *
 * The launch check covers a phone that is opened fresh. One that keeps Roomly
 * in the background for days never relaunches, so returning to the app checks
 * again -- at most every half hour, which is more than often enough for a
 * channel that ships a few times a week.
 *
 * Mounted once in the tab shell, beside PhoneNudge. Renders nothing itself:
 * the popup is the shared dialog, the same one Settings uses.
 */

const TAB_PATHS = new Set(['/', '/history', '/reports', '/more']);
const RECHECK_MS = 30 * 60 * 1000;
/** Long enough that the screen has drawn and settled before anything pops up. */
const SHOW_AFTER_MS = 1200;

export function UpdatePrompt() {
  const dialog = useDialog();
  const pathname = usePathname();
  // isUpdatePending and downloadedUpdate live on this hook in SDK 57.
  const { isUpdatePending, downloadedUpdate } = useUpdates();

  const asked = useRef<string | null>(null);
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    // The launch check has just run (checkAutomatically ON_LOAD), so the
    // first return to the app does not need another straight away.
    lastCheck.current = Date.now();

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - lastCheck.current < RECHECK_MS) return;
      lastCheck.current = Date.now();
      void (async () => {
        try {
          const result = await Updates.checkForUpdateAsync();
          // Downloading flips isUpdatePending, which is what shows the popup.
          if (result.isAvailable) await Updates.fetchUpdateAsync();
        } catch {
          // Offline, or a fetch already in flight from launch: the next
          // return to the app tries again. Settings still has the button.
        }
      })();
    });
    return () => sub.remove();
  }, []);

  const updateId = isUpdatePending ? (downloadedUpdate?.updateId ?? 'pending') : null;
  const onTab = TAB_PATHS.has(pathname);

  useEffect(() => {
    if (!updateId || !onTab || asked.current === updateId) return;

    const timer = setTimeout(() => {
      asked.current = updateId;
      void dialog
        .confirm({
          tone: 'success',
          icon: 'cloud-download-outline',
          title: 'Update ready',
          message: 'A new version of Roomly has downloaded. Restart now to use it — it takes a second.',
          confirmLabel: 'Restart now',
          cancelLabel: 'Later',
        })
        .then((restart) => {
          // Anything queued offline is in the outbox on disk, so a reload
          // loses nothing.
          if (restart) void applyUpdate();
        });
    }, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [updateId, onTab, dialog]);

  return null;
}
