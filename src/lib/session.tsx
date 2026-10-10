import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { clear as clearOutbox } from '@/lib/outbox';
import { supabase } from '@/lib/supabase';

export type MemberRow = {
  id: string;
  household_id: string;
  display_name: string;
  role: 'owner' | 'member';
  avatar_color: string;
};

export type JoinRequestRow = {
  id: string;
  household_id: string;
  display_name: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_at: string;
};

/**
 * Where the user is in the funnel. The root layout maps these straight onto
 * route groups, so there is exactly one place that decides what you can see.
 */
export type SessionStatus =
  | 'loading'
  | 'signedOut'
  | 'needsOnboarding' // signed in, but belongs to no household yet
  | 'waiting' // asked to join, owner hasn't approved
  | 'ready';

type SessionValue = {
  session: Session | null;
  member: MemberRow | null;
  pending: JoinRequestRow | null;
  status: SessionStatus;
  /**
   * True when the last membership read did not come back. The difference
   * between "you are in no household" and "we could not find out" is the whole
   * of the bug this flag exists to prevent: screens must not state the former
   * when only the latter is known.
   */
  unreachable: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

/**
 * The last membership we successfully read, kept so a cold start with no signal
 * can still resolve to 'ready'.
 *
 * Without it, launching in aeroplane mode took an established member to "You're
 * in -- join a household or start one", where both buttons need the network. A
 * four-year flatmate was told they had no home and offered no way back. The app
 * promises on its own Add Expense screen that it works offline; this is part of
 * keeping that promise.
 */
const CACHE_KEY = 'roomly.membership.v1';
type CachedMembership = { userId: string; member: MemberRow };

async function readCachedMembership(): Promise<CachedMembership | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedMembership) : null;
  } catch {
    return null;
  }
}

async function writeCachedMembership(value: CachedMembership | null): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(value));
    else await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // A cache that cannot be written is a slower app, not a broken one.
  }
}

/** Resolves to `null` rather than hanging forever. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/**
 * A per-subscription topic suffix, for the same reason realtime.ts has one:
 * supabase-js dedupes channels by topic and RealtimeChannel.on() THROWS if the
 * channel it is handed has already joined. removeChannel() is async, so the old
 * channel is still registered on the next effect run. A fixed topic therefore
 * threw synchronously inside useEffect, which unwinds the React tree -- on
 * Android that reads as the app closing itself.
 *
 * This file had exactly the bug realtime.ts was rewritten to fix.
 */
let joinWatchSeq = 0;

/** How often to re-check approval when Realtime is not delivering. */
const WAITING_POLL_MS = 10_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<MemberRow | null>(null);
  const [pending, setPending] = useState<JoinRequestRow | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [booting, setBooting] = useState(true);

  /**
   * RLS does the work here: `members` is only readable by someone who already
   * has a member row, so a non-member simply gets nothing back rather than an
   * error. That empty result IS the "needs onboarding" signal.
   *
   * An ERROR is not that signal, and conflating the two is what ejected
   * offline members to onboarding. Both reads below check `error` before
   * drawing any conclusion from `data`.
   */
  const loadMembership = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setMember(null);
      setPending(null);
      setUnreachable(false);
      await writeCachedMembership(null);
      return;
    }

    const { data: memberRow, error: memberError } = await supabase
      .from('members')
      .select('id, household_id, display_name, role, avatar_color')
      .eq('user_id', userId)
      .is('left_on', null)
      .maybeSingle();

    if (memberError) {
      // We did not find out. Fall back to what we last knew rather than
      // declaring an established member homeless.
      const cached = await readCachedMembership();
      if (cached?.userId === userId) {
        setMember(cached.member);
        setPending(null);
      }
      setUnreachable(true);
      return;
    }

    setUnreachable(false);

    if (memberRow) {
      setMember(memberRow as MemberRow);
      setPending(null);
      await writeCachedMembership({ userId, member: memberRow as MemberRow });
      return;
    }

    // A definite answer: no membership. Dropping the cache here is what stops a
    // removed member being shown a household they are no longer in.
    await writeCachedMembership(null);
    setMember(null);

    const { data: request, error: requestError } = await supabase
      .from('join_requests')
      .select('id, household_id, display_name, status, requested_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      // The unique index is per (household, user), so two requests to two
      // households are legal. maybeSingle() ERRORS on two rows -- and with the
      // error ignored, that silently looked like "no request at all".
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (requestError) {
      setUnreachable(true);
      return;
    }

    setPending((request as JoinRequestRow) ?? null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await loadMembership(data.session?.user.id);
  }, [loadMembership]);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      // Bounded. setBooting(false) used to run only after this resolved, and
      // RootNavigator renders null while loading -- so a request that never
      // came back (captive portal, a network that accepts and drops) left the
      // app on its splash screen indefinitely, with no timeout anywhere.
      await withTimeout(loadMembership(data.session?.user.id), 8000);
      if (active) setBooting(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      // Deferred out of the callback on purpose. supabase-js holds its auth
      // lock for the duration of this handler and documents that calling other
      // client methods from inside it can deadlock; loadMembership issues
      // PostgREST requests that need that lock to attach a token.
      setTimeout(() => {
        if (active) void loadMembership(next?.user.id);
      }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMembership]);

  /**
   * While a join request is pending, watch it over Realtime so the waiting
   * screen advances by itself the moment the owner taps approve.
   *
   * Backed by polling, because postgres_changes needs the table to be in the
   * supabase_realtime publication -- migration 0027 puts it there, but that is
   * still a server-side setting that can be off. Without a fallback, an
   * approved joiner waits on that screen forever with no button that helps.
   */
  const pendingId = pending?.id;

  // A latest-ref so the watch below can call refresh() without listing it as a
  // dependency — depending on it directly would tear down and re-create the
  // channel on every render that produced a new callback identity, which is
  // the churn that made the fixed-topic crash reachable in the first place.
  //
  // Written in an effect, not during render: this project has the React
  // Compiler enabled, and a ref mutated during render is a real hazard, not a
  // lint nicety.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!pendingId) return;

    // Unique per run, and depending on the ID rather than the `pending` object:
    // that object is a fresh reference on every load, so the effect re-ran on
    // every TOKEN_REFRESHED and re-subscribed to a channel that had already
    // joined.
    const topic = `join-request-${pendingId}-${++joinWatchSeq}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'join_requests',
            filter: `id=eq.${pendingId}`,
          },
          () => void refreshRef.current()
        )
        .subscribe();
    } catch (e) {
      if (__DEV__) console.warn('[session] could not watch the join request', e);
      channel = null;
    }

    const poll = setInterval(() => void refreshRef.current(), WAITING_POLL_MS);

    return () => {
      clearInterval(poll);
      if (channel) void supabase.removeChannel(channel).catch(() => {});
    };
  }, [pendingId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setMember(null);
    setPending(null);
    setUnreachable(false);

    // Everything that belonged to the person signing out. The persisted query
    // cache has no per-user key and a seven-day maxAge, so without this the
    // next account to sign in on this phone rehydrated the previous
    // household's balances, members and expenses until each query refetched.
    // The outbox goes too: those are the last user's unsent expenses, and
    // draining them under a new session would post them into the wrong
    // household or simply be refused.
    await writeCachedMembership(null);
    await clearOutbox();
    queryClient.clear();
  }, [queryClient]);

  const status: SessionStatus = booting
    ? 'loading'
    : !session
      ? 'signedOut'
      : member
        ? 'ready'
        : pending
          ? 'waiting'
          : 'needsOnboarding';

  const value = useMemo(
    () => ({ session, member, pending, status, unreachable, refresh, signOut }),
    [session, member, pending, status, unreachable, refresh, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
