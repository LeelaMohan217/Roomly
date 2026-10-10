import { useQueryClient } from '@tanstack/react-query';
import { useNetworkState } from 'expo-network';
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

import {
  enqueue,
  loadOutbox,
  newClientId,
  recordFailure,
  remove,
  retry as retryItem,
  type PendingExpense,
} from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type SyncValue = {
  online: boolean;
  pending: PendingExpense[];
  syncing: boolean;
  /** Queue an expense. Returns true if it went straight to the server. */
  submitExpense: (
    e: Omit<PendingExpense, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'blocked'>
  ) => Promise<boolean>;
  syncNow: () => Promise<void>;
  retryOne: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
};

const SyncContext = createContext<SyncValue | null>(null);

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside <SyncProvider>');
  return value;
}

/** A network error, as opposed to the server rejecting the request outright. */
function looksOffline(message: string): boolean {
  return /network|fetch|timeout|abort|connection/i.test(message);
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const net = useNetworkState();
  const [pending, setPending] = useState<PendingExpense[]>([]);
  const [syncing, setSyncing] = useState(false);

  // isInternetReachable is undefined until the first probe, so treat unknown
  // as online: wrongly queueing a write is worse than wrongly attempting one,
  // because the attempt fails safely into the queue anyway.
  const online = net.isInternetReachable !== false && net.isConnected !== false;

  const wasOnline = useRef(online);
  const drainedOnLaunch = useRef(false);

  // Re-read on every change of signed-in account, not only on mount. signOut()
  // wipes the outbox — those are the previous user's unsent expenses, and
  // draining them under a new session would post them into the wrong household
  // — so this provider has to notice, or the banner keeps counting items that
  // no longer exist.
  const userId = session?.user.id;
  useEffect(() => {
    // The launch drain is a one-shot, so signing in as somebody else has to
    // re-arm it or their queue would sit until connectivity happened to flip.
    drainedOnLaunch.current = false;
    void loadOutbox().then(setPending);
  }, [userId]);

  // A real mutex, not the `syncing` state flag. drain() is reachable from the
  // connectivity effect and from retryOne() at the same time, and two
  // overlapping drains both loadOutbox() the same items -- sending each twice,
  // and racing remove() against recordFailure() in a read-modify-write that
  // can resurrect an item that was already sent. A ref is checked
  // synchronously; a state flag would not have settled in time.
  const draining = useRef(false);

  const drain = useCallback(async () => {
    if (draining.current) return;

    const items = await loadOutbox();
    const sendable = items.filter((i) => !i.blocked);
    if (sendable.length === 0) {
      setPending(items);
      return;
    }

    draining.current = true;
    setSyncing(true);
    let latest = items;

    // Sequential, not parallel: these are money writes, and a burst of
    // parallel RPCs on a flaky connection is how you get partial failures
    // that are hard to reason about.
    for (const item of sendable) {
      const { error } = await supabase.rpc('create_expense', {
        p_total_paise: item.totalPaise,
        p_category: item.categoryId,
        p_expense_date: item.expenseDate,
        p_paid_by: item.paidBy,
        p_splits: item.splits,
        p_description: item.description,
        p_payment_method: null,
        // The whole point of the queue id. If the previous attempt actually
        // committed and only its response was lost, the server recognises this
        // and returns the original expense instead of writing a twin.
        p_client_id: item.id,
      });

      if (error) {
        latest = await recordFailure(item.id, error.message);
        // Still offline — stop and try the rest later rather than burning
        // attempts on every queued item.
        if (looksOffline(error.message)) break;
      } else {
        latest = await remove(item.id);
      }
    }

    setPending(latest);
    setSyncing(false);
    draining.current = false;
    await queryClient.invalidateQueries();
  }, [queryClient]);

  // Drain when connectivity returns, and once the queue is known.
  //
  // This used to claim it also drained "once on mount" and did not: on the
  // first run wasOnline.current is initialised to the current `online`, so
  // cameBack is false; `pending` is still [] because loadOutbox() is async;
  // and the dependency list was [online] alone, so the effect never re-ran
  // when pending populated a tick later. Expenses queued in a PREVIOUS session
  // therefore sat untouched until connectivity happened to flip -- on a phone
  // that stays on wifi, indefinitely.
  //
  // The launch drain is a one-shot rather than a plain `pending.length > 0`
  // dependency: drain() itself calls setPending, so keying on the length would
  // re-enter on every partial drain and retry a rejected item through its five
  // attempts back to back instead of leaving it for the next real trigger.
  useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;

    const firstLook = !drainedOnLaunch.current && pending.length > 0;
    if (firstLook) drainedOnLaunch.current = true;

    if (online && (cameBack || firstLook)) {
      void drain();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, pending.length]);

  const submitExpense = useCallback<SyncValue['submitExpense']>(
    async (e) => {
      // Minted BEFORE the first attempt, so if that attempt commits and its
      // response is lost, the queued retry below carries the same key and the
      // server dedupes it. Generating the id only at enqueue() time -- as this
      // used to -- meant the retry looked like a brand new expense.
      const clientId = newClientId();

      if (online) {
        const { error } = await supabase.rpc('create_expense', {
          p_total_paise: e.totalPaise,
          p_category: e.categoryId,
          p_expense_date: e.expenseDate,
          p_paid_by: e.paidBy,
          p_splits: e.splits,
          p_description: e.description,
          p_payment_method: null,
          p_client_id: clientId,
        });

        if (!error) {
          await queryClient.invalidateQueries();
          return true;
        }

        // A real rejection (closed month, bad split) must surface now, while
        // the user is looking at the form. Only connection failures queue.
        // The code is preserved so humanError() can still match BY_CODE -- a
        // bare new Error(message) dropped it and turned every RLS refusal into
        // the generic fallback.
        if (!looksOffline(error.message)) {
          const rejection = new Error(error.message) as Error & { code?: string };
          rejection.code = error.code;
          throw rejection;
        }
      }

      const item = await enqueue(e, clientId);
      setPending((p) => [...p, item]);
      return false;
    },
    [online, queryClient]
  );

  const value = useMemo<SyncValue>(
    () => ({
      online,
      pending,
      syncing,
      submitExpense,
      syncNow: drain,
      retryOne: async (id) => {
        setPending(await retryItem(id));
        await drain();
      },
      discard: async (id) => setPending(await remove(id)),
    }),
    [online, pending, syncing, submitExpense, drain]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
