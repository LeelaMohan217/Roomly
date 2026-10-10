import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Live household updates over Realtime.
 *
 * This is what makes the bell light up while the app is open, and it needs no
 * setup at all -- unlike push, which is gated behind an EAS project and FCM.
 * When someone adds an expense, everyone else's balances and feed refresh
 * without anyone pulling to refresh.
 */

/**
 * A per-subscription topic suffix.
 *
 * The reason this exists is a crash. supabase-js dedupes channels by topic:
 * client.channel(t) returns an EXISTING channel when one with that topic is
 * already registered, rather than making a new one. RealtimeChannel.on() then
 * THROWS if the channel it is called on has already joined or is joining. And
 * removeChannel() is async -- it awaits a server round-trip before tearing the
 * channel down, so the old channel is still registered and still joined when
 * the next effect run asks for the same topic.
 *
 * So a fixed topic like `household-<id>` meant: any second run of the effect
 * got handed back the live channel, called .on() on it, and threw
 * synchronously inside useEffect. An uncaught throw there unwinds the React
 * tree, which on Android reads as the app closing itself.
 *
 * A unique topic per run makes that impossible by construction. Topics are
 * per-client, and the postgres_changes filter does the real work, so nothing
 * depends on the name being shared or stable.
 */
let subscriptionSeq = 0;

export function useHouseholdRealtime() {
  const { member } = useSession();
  const queryClient = useQueryClient();

  // The household id, NOT the member object. Depending on the object meant a
  // session refresh that produced an identical-but-new member re-subscribed
  // for no reason -- which is exactly what used to trigger the throw above.
  const householdId = member?.household_id;

  useEffect(() => {
    if (!householdId) return;

    const topic = `household-${householdId}-${++subscriptionSeq}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Realtime is a convenience: without it the app still works, it just needs
    // a pull to refresh. So nothing in here is allowed to take the app down.
    try {
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `household_id=eq.${householdId}`,
          },
          () => {
            // Notifications are written by triggers on every meaningful change,
            // so one subscription covers expenses, settlements and members --
            // rather than a channel per table.
            // Everything, rather than a hand-kept list. The list silently went
            // stale the moment a new query was added -- spend-summary, which
            // backs the two home cards, was missing and so never refreshed
            // live. A household's whole dataset is a few hundred rows.
            void queryClient.invalidateQueries();
          }
        )
        .subscribe();
    } catch (e) {
      if (__DEV__) console.warn('[realtime] could not subscribe', e);
      channel = null;
    }

    return () => {
      if (!channel) return;
      // Swallowed for the same reason: teardown races app teardown, and a
      // rejected unsubscribe must not surface as an unhandled rejection.
      void supabase.removeChannel(channel).catch(() => {});
    };
  }, [householdId, queryClient]);
}
