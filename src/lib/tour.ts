import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { useCallback } from 'react';
import type { View } from 'react-native';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';

/**
 * The first-run tour: a few coach marks over Home, shown once to someone who
 * has just made an account.
 *
 * "Just made an account" is decided by the server, not the phone. Register
 * writes `tour_pending: true` into the new user's metadata at sign-up, so the
 * flag exists only for accounts created by a build that has the tour --
 * everyone who signed up before it never sees it. Finishing or skipping writes
 * it back to false, so a reinstall, a second phone or the next sign-in never
 * replays it. User metadata rather than a column on `members`: a member row is
 * per household, so leaving one and joining another would show it again, and
 * metadata needs no migration to be in place before this ships by OTA.
 *
 * AsyncStorage, keyed by user, is the fast path and the offline fallback: it
 * is written first, so the tour stays done on this phone even when the server
 * write has to wait for a signal (it is retried on the next launch).
 */

export const TOUR_METADATA_KEY = 'tour_pending';

export type TourTarget =
  | 'balance'
  | 'month'
  | 'settle'
  | 'tab-home'
  | 'tab-history'
  | 'tab-reports'
  | 'tab-more'
  | 'add';

export type TourStep = { target: TourTarget; title: string; body: string };

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'balance',
    title: 'Where you stand',
    body: 'Your balance with the house: what you get back, or what you owe, after every expense.',
  },
  {
    target: 'month',
    title: 'This month’s total',
    body: 'Everything the house has spent this month, with your share beside it.',
  },
  {
    target: 'settle',
    title: 'Settle up',
    body: 'When it’s time to square up, this shows who pays whom and records the payment.',
  },
  // Then the bar along the bottom, left to right.
  {
    target: 'tab-home',
    title: 'Home',
    body: 'Your balance, this month’s spending and the latest expenses, all in one place.',
  },
  {
    target: 'tab-history',
    title: 'History',
    body: 'Every expense the house has logged, to search, filter and open.',
  },
  {
    target: 'tab-reports',
    title: 'Reports',
    body: 'Where the money goes: spending by category and by month.',
  },
  {
    target: 'tab-more',
    title: 'More',
    body: 'Your account, the household, recurring bills, categories and settings.',
  },
  {
    target: 'add',
    title: 'Add an expense',
    body: 'Paid for something shared? Tap + to log it and split it with the house.',
  },
];

/**
 * - unknown: not worked out yet for this user (a moment, on launch)
 * - pending: this account should see the tour, once Home is ready
 * - active:  showing now
 * - idle:    nothing to show, or already done
 *
 * Anything else that would pop up over Home (the phone-number sheet) waits
 * for idle, so the two never stack.
 */
export type TourStatus = 'unknown' | 'pending' | 'active' | 'idle';

type TourState = {
  userId: string | null;
  status: TourStatus;
  /** Home is focused, drawn and has its figures, so its cards can be measured. */
  homeReady: boolean;
  setHomeReady: (ready: boolean) => void;
};

export const useTourStore = create<TourState>((set) => ({
  userId: null,
  status: 'unknown',
  homeReady: false,
  setHomeReady: (homeReady) => set({ homeReady }),
}));

/** The views each step points at, by name. Not state: nothing re-renders on it. */
const targets = new Map<TourTarget, View>();

export function getTourTarget(key: TourTarget): View | undefined {
  return targets.get(key);
}

/**
 * A ref callback for the view a step points at. The view should be
 * `collapsable={false}` so Android keeps a native view to measure.
 */
export function useTourTarget(key: TourTarget | undefined) {
  return useCallback(
    (node: View | null) => {
      if (!key) return;
      if (node) targets.set(key, node);
      else if (targets.get(key)) targets.delete(key);
    },
    [key]
  );
}

const localKey = (userId: string) => `roomly.tour.v1:${userId}`;

async function readLocalDone(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(localKey(userId))) === 'done';
  } catch {
    return false;
  }
}

function serverPending(session: Session): boolean {
  return session.user.user_metadata?.[TOUR_METADATA_KEY] === true;
}

/** Clears the server flag. Failure is fine: it is retried on the next launch. */
async function clearServerFlag(): Promise<void> {
  try {
    await supabase.auth.updateUser({ data: { [TOUR_METADATA_KEY]: false } });
  } catch {
    // Offline: this phone already remembers, and the next launch tries again.
  }
}

/**
 * Works out whether this user should see the tour. Called once per signed-in
 * user from the tab shell.
 */
export async function resolveTour(session: Session): Promise<void> {
  const userId = session.user.id;
  const { userId: current, status } = useTourStore.getState();
  if (current === userId && status !== 'unknown') return;
  useTourStore.setState({ userId, status: 'unknown' });

  const pending = serverPending(session);
  const localDone = await readLocalDone(userId);

  // Signed out or switched while reading.
  if (useTourStore.getState().userId !== userId) return;

  if (!pending) {
    useTourStore.setState({ status: 'idle' });
    return;
  }
  if (localDone) {
    // Done on this phone, but the server write never landed. Try again.
    useTourStore.setState({ status: 'idle' });
    void clearServerFlag();
    return;
  }
  useTourStore.setState({ status: 'pending' });
}

export function startTour() {
  if (useTourStore.getState().status === 'pending') useTourStore.setState({ status: 'active' });
}

/** Finished or skipped: either way it never shows again for this account. */
export async function completeTour(): Promise<void> {
  const { userId } = useTourStore.getState();
  useTourStore.setState({ status: 'idle' });
  if (!userId) return;
  try {
    await AsyncStorage.setItem(localKey(userId), 'done');
  } catch {
    // The server flag below is the record that matters.
  }
  await clearServerFlag();
}
