import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
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
import { setRecoveryPending } from '@/lib/recovery';
import { onAnonymousRequest, supabase } from '@/lib/supabase';

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
   * Just signed in and membership is still being read. `status` already says
   * needsOnboarding at this point, which is not yet true, so whatever it
   * shows must be covered until this clears.
   */
  resolving: boolean;
  /**
   * True when the last membership read did not come back. The difference
   * between "you are in no household" and "we could not find out" is the whole
   * of the bug this flag exists to prevent: screens must not state the former
   * when only the latter is known.
   */
  unreachable: boolean;
  /**
   * Signed out by the server, not by the person: the sign-in could not be
   * renewed. Sign in says so, rather than appearing out of nowhere.
   */
  expired: boolean;
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

/**
 * Whose sign-in ended without them signing out, so the next sign-in can tell
 * "the same person, back again" (keep their unsent expenses and cached
 * screens) from "someone else on this phone" (drop both, as signOut does).
 */
const EXPIRED_KEY = 'roomly.expiredUser.v1';

async function readExpiredUser(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(EXPIRED_KEY);
  } catch {
    return null;
  }
}

async function writeExpiredUser(userId: string | null): Promise<void> {
  try {
    if (userId) await AsyncStorage.setItem(EXPIRED_KEY, userId);
    else await AsyncStorage.removeItem(EXPIRED_KEY);
  } catch {
    // Not remembered: the worst case is a missing "you were signed out" line.
  }
}

/** At most one dead-session check this often, however many requests trip it. */
const SESSION_CHECK_GAP_MS = 30_000;

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
  const [expired, setExpired] = useState(false);

  // Read by the auth listener and the dead-session check, which are set up
  // once and must see the current session, not the one they were made with.
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  /** Set while the person signs out on purpose, so that is not "expired". */
  const signingOutRef = useRef(false);
  const lastCheckRef = useRef(0);
  /**
   * Whose membership has been looked up, answer or not. Until it matches the
   * signed-in user, "no member row" means "not read yet", not "no household".
   *
   * Signing in sets the session at once but reads membership a tick later
   * (see onAuthStateChange below), and in that gap the status worked out to
   * needsOnboarding -- so every sign-in flashed "Create a household / Join
   * with a code" for a second before Home. A cold start never showed it only
   * because `booting` happened to cover the same wait.
   */
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);

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

  /**
   * loadMembership, bounded, then marked as answered for this user -- whatever
   * the answer was, including none at all after the timeout. Without the bound
   * a request that never came back would hold the brand screen up forever.
   */
  const resolveMembership = useCallback(
    async (userId: string | undefined) => {
      await withTimeout(loadMembership(userId), 8000);
      setResolvedFor(userId ?? null);
    },
    [loadMembership]
  );

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await resolveMembership(data.session?.user.id);
  }, [resolveMembership]);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      // Closed the app on the "you were signed out" screen: still say so.
      if (!data.session && (await readExpiredUser())) setExpired(true);
      // Bounded. setBooting(false) used to run only after this resolved, and
      // RootNavigator renders null while loading -- so a request that never
      // came back (captive portal, a network that accepts and drops) left the
      // app on its splash screen indefinitely, with no timeout anywhere.
      await resolveMembership(data.session?.user.id);
      if (active) setBooting(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      const previous = sessionRef.current;

      // supabase-js signs out by itself when a sign-in can no longer be
      // renewed. Nobody pressed anything, so the sign-in screen explains.
      if (event === 'SIGNED_OUT' && previous && !signingOutRef.current) {
        setExpired(true);
        void writeExpiredUser(previous.user.id);
      }

      if (event === 'SIGNED_IN' && next) {
        const userId = next.user.id;
        setExpired(false);
        // Out of the callback, like resolveMembership below.
        setTimeout(() => {
          void (async () => {
            const expiredUser = await readExpiredUser();
            if (!expiredUser) return;
            await writeExpiredUser(null);
            if (expiredUser !== userId) {
              // Someone else on this phone: what signOut would have dropped.
              await clearOutbox();
              queryClient.clear();
            } else {
              // The same person: keep everything, but re-read whatever came
              // back empty while their requests were going out unsigned.
              await queryClient.invalidateQueries();
            }
          })();
        }, 0);
      }

      setSession(next);
      // Deferred out of the callback on purpose. supabase-js holds its auth
      // lock for the duration of this handler and documents that calling other
      // client methods from inside it can deadlock; loadMembership issues
      // PostgREST requests that need that lock to attach a token.
      setTimeout(() => {
        if (active) void resolveMembership(next?.user.id);
      }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [resolveMembership, queryClient]);

  /**
   * A request went out with no signed-in token while the app believes it is
   * signed in: the session has died underneath it (see onAnonymousRequest).
   *
   * Left alone, the server sees a stranger: reads come back empty, writes say
   * "You don't have permission", and cached screens hide that anything is
   * wrong. So: try once to renew it. If that works, re-read what came back
   * empty. If the server definitely refuses, end the session and send them to
   * sign in. A network failure during the renewal proves nothing, so it does
   * neither -- an offline member is never thrown out.
   */
  useEffect(
    () =>
      onAnonymousRequest(() => {
        const current = sessionRef.current;
        if (!current || signingOutRef.current) return;
        const now = Date.now();
        if (now - lastCheckRef.current < SESSION_CHECK_GAP_MS) return;
        lastCheckRef.current = now;

        void (async () => {
          const { data: live } = await supabase.auth.getSession();
          if (live.session) {
            // Raced a renewal that has since landed.
            await queryClient.invalidateQueries();
            return;
          }

          const { data, error } = await supabase.auth.refreshSession();
          if (data.session) {
            await queryClient.invalidateQueries();
            return;
          }
          if (isAuthRetryableFetchError(error)) return;
          // Signed out by the request that tripped this, or by hand meanwhile.
          if (sessionRef.current?.user.id !== current.user.id || signingOutRef.current) return;

          setExpired(true);
          await writeExpiredUser(current.user.id);
          // Local only: the server already holds no live session for this
          // phone. Unsent expenses and cached screens are kept for when the
          // same person signs back in (see SIGNED_IN above).
          signingOutRef.current = true;
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } finally {
            signingOutRef.current = false;
          }
          setSession(null);
          setMember(null);
          setPending(null);
          setUnreachable(false);
          await writeCachedMembership(null);
        })();
      }),
    [queryClient]
  );

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
    signingOutRef.current = true;
    try {
      await supabase.auth.signOut();
    } finally {
      signingOutRef.current = false;
    }
    setExpired(false);
    await writeExpiredUser(null);
    // A half-finished password reset belonged to that session too.
    await setRecoveryPending(false);
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

  // Signed in, but whether they belong to a household is not known yet. A
  // token refresh re-reads membership for the same user, so resolvedFor
  // already matches and this never flickers on; only a new sign-in waits.
  //
  // A flag beside status rather than status 'loading': RootNavigator swaps the
  // whole Stack out while loading, and a password-reset link signs the user in
  // from inside that Stack -- unmounting it would lose the reset screen.
  const resolving = !booting && !!session && resolvedFor !== session.user.id;

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
    () => ({ session, member, pending, status, resolving, unreachable, expired, refresh, signOut }),
    [session, member, pending, status, resolving, unreachable, expired, refresh, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
