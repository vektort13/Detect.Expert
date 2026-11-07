// aria-live="polite" region announcing aggregated report changes, throttled to one announcement per 2 s.

import { useEffect, useRef, useState } from 'preact/hooks';
import { ANNOUNCE_MIN_INTERVAL_MS, INITIAL_ANNOUNCER, announce, flushAnnouncer } from '../view-models/announce';
import type { AnnouncerState } from '../view-models/announce';

export function useThrottledAnnouncement(text: string | null, minIntervalMs = ANNOUNCE_MIN_INTERVAL_MS): string {
  const stateRef = useRef<AnnouncerState>({ ...INITIAL_ANNOUNCER });
  const timerRef = useRef<number | null>(null);
  const [live, setLive] = useState('');

  useEffect(() => {
    if (text === null) return;
    const step = announce(stateRef.current, text, Date.now(), minIntervalMs);
    stateRef.current = step.state;
    if (step.emit !== null) setLive(step.emit);
    if (step.retryInMs !== null && timerRef.current === null) {
      const tick = (): void => {
        timerRef.current = null;
        const flushed = flushAnnouncer(stateRef.current, Date.now(), minIntervalMs);
        stateRef.current = flushed.state;
        if (flushed.emit !== null) setLive(flushed.emit);
        if (flushed.retryInMs !== null) timerRef.current = window.setTimeout(tick, flushed.retryInMs);
      };
      timerRef.current = window.setTimeout(tick, step.retryInMs);
    }
  }, [text, minIntervalMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return live;
}

export function LiveRegion(props: { text: string }) {
  return (
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {props.text}
    </div>
  );
}
