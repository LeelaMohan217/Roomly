import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * A number that runs up to its target instead of jumping there: from 0 the
 * first time, then from the old figure whenever it changes. Whole paise at
 * every frame, easing out so it settles rather than stops.
 *
 * With Reduce motion on, the target straight away. Undefined stays undefined,
 * so a skeleton still shows while the figure loads.
 */
export function useCountUp(target: number | undefined, durationMs = 700): number | undefined {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | undefined>(undefined);
  const from = useRef(0);
  const current = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (target === undefined || reduced) return;
    from.current = current.current ?? 0;
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const p = Math.min((Date.now() - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(from.current + (target - from.current) * eased);
      current.current = value;
      setShown(value);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, durationMs]);

  if (target === undefined) return undefined;
  return reduced ? target : (shown ?? 0);
}
