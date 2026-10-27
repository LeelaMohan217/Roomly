import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';

/** A password-reset link's credential: a PKCE code, or the older token hash. */
export type RecoveryLink = { code?: string; tokenHash?: string };

const keyOf = (link: RecoveryLink) =>
  link.code ? `code:${link.code}` : link.tokenHash ? `hash:${link.tokenHash}` : null;

// For the life of the app, not per screen: two screens can come up for one
// link, and the credential has to be spent exactly once between them.
const attempts = new Map<string, Promise<{ error: Error | null }>>();

/**
 * Verify a reset link, once.
 *
 * A recovery code is single use. A reset link can reach the app twice -- the
 * router opens reset-password from it, and RootNavigator does the same for a
 * cold start where the router's copy was lost -- and each screen used to
 * verify on its own. The first spent the code, the second was refused, and the
 * screen left showing said "This link didn't work" after the reset had in fact
 * gone through. Every caller for the same link now shares one attempt.
 *
 * A successful one marks the reset as pending: see below.
 */
export function verifyRecovery(link: RecoveryLink): Promise<{ error: Error | null }> {
  const key = keyOf(link);
  if (!key) return Promise.resolve({ error: new Error('This reset link has no code') });

  let attempt = attempts.get(key);
  if (!attempt) {
    attempt = (
      link.code
        ? supabase.auth.exchangeCodeForSession(link.code)
        : supabase.auth.verifyOtp({ type: 'recovery', token_hash: link.tokenHash! })
    ).then(async (result) => {
      if (!result.error) await setRecoveryPending(true);
      return { error: result.error };
    });
    attempts.set(key, attempt);
  }
  return attempt;
}

/** Whether a screen has already started verifying this link. */
export function recoveryStarted(link: RecoveryLink): boolean {
  const key = keyOf(link);
  return key !== null && attempts.has(key);
}

// ------------------------------------------------------------------------
// A reset in progress.
//
// Verifying a reset link signs the person in -- that is how Supabase lets the
// app save their new password. Until they do, they are signed in without a
// password they know, so the app keeps them on "Choose a new password" rather
// than letting them wander in: once they had got in that way, nothing in the
// app could set a password any more, and their only way back was another
// reset email.
//
// Kept on the phone, not in memory, so closing the app half way through does
// not skip the step on the next launch.

const PENDING_KEY = 'roomly.recovery-pending';

/** null until read from storage. */
let pending: boolean | null = null;
const listeners = new Set<() => void>();

function publish(next: boolean) {
  pending = next;
  listeners.forEach((l) => l());
}

void AsyncStorage.getItem(PENDING_KEY)
  .then((v) => {
    // A verification that finished first already knows better.
    if (pending === null) publish(v === '1');
  })
  .catch(() => {
    if (pending === null) publish(false);
  });

export async function setRecoveryPending(next: boolean): Promise<void> {
  publish(next);
  try {
    if (next) await AsyncStorage.setItem(PENDING_KEY, '1');
    else await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // The in-memory flag still holds for this run; worst case a restart
    // forgets it, which is the behaviour before this existed.
  }
}

/** Whether a reset is waiting for a new password. null while still loading. */
export function useRecoveryPending(): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending
  );
}
