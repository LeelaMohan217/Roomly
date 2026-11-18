import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/**
 * Home's insight rotation, kept on this phone: which insights you have hidden
 * (by their month-stamped key, so a new month starts clean), and how many
 * times Home has opened (so each open shows the next one).
 *
 * Per account, so a second account on the phone keeps its own.
 */
const HIDDEN = (userId: string) => `roomly.insights.hidden.${userId}`;
const TURN = (userId: string) => `roomly.insights.turn.${userId}`;
/** Old months' keys are dropped once the list grows past this. */
const KEEP = 60;

export function useInsightRotation(userId: string | undefined) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [turn, setTurn] = useState(0);

  // Read once per account, then count this open for the next one.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      try {
        const [h, t] = await Promise.all([
          AsyncStorage.getItem(HIDDEN(userId)),
          AsyncStorage.getItem(TURN(userId)),
        ]);
        const opens = Number(t ?? '0') || 0;
        if (!alive) return;
        setHidden(new Set(h ? (JSON.parse(h) as string[]) : []));
        setTurn(opens);
        await AsyncStorage.setItem(TURN(userId), String(opens + 1));
      } catch {
        // Storage unreadable: show the first insight, hide nothing.
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  function hide(key: string) {
    setHidden((prev) => {
      const next = new Set(prev).add(key);
      if (userId) {
        void AsyncStorage.setItem(HIDDEN(userId), JSON.stringify([...next].slice(-KEEP))).catch(
          () => undefined
        );
      }
      return next;
    });
  }

  return { hidden, turn, hide };
}
