import { useEffect, useRef } from 'react';
import { nextPollDelay } from './logic/updateLogic';
import { useUpdateStore } from './useUpdateStore';

/**
 * Polls the update status: every 5 min normally, every 2 s while an update is in progress or a
 * post-apply reconnect is pending. Mount once (the header pill does); it resets on unmount, which
 * happens on logout.
 */
export function useUpdatePoller() {
  const delay = useUpdateStore((state) => nextPollDelay(state.status, state.tracking));
  const refresh = useUpdateStore((state) => state.refresh);
  const reset = useUpdateStore((state) => state.reset);

  const previousDelay = useRef<number | null>(null);

  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const run = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(run, delay);
    };
    // Fetch right away on mount or when polling speeds up; when it slows down (an update just
    // finished) the status is already fresh, so wait a full interval.
    const slowedDown = previousDelay.current !== null && delay > previousDelay.current;
    previousDelay.current = delay;
    if (slowedDown) timer = setTimeout(run, delay);
    else void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [delay, refresh]);
}
