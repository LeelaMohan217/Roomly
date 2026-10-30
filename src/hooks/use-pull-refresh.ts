import { useState } from 'react';

/**
 * Pull-to-refresh state that belongs to the pull, not to the data.
 *
 * Screens used to pass `refreshing={query.isFetching}`, which put Android's
 * white refresh disc over the top of the list for every background refetch --
 * opening the app, a realtime change, reconnecting -- so a screen that already
 * had its data looked like it was loading. The disc now shows only while a
 * refresh the user asked for is running, and background refetches stay silent.
 */
export function usePullRefresh(refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return { refreshing, onRefresh: () => void onRefresh() };
}
