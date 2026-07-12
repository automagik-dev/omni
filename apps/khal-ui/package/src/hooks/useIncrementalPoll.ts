'use client';

/**
 * Incremental polling with dedupe-by-id accumulation. Each tick fetches a page,
 * merges it into the accumulated list (newest-first, deduped via
 * {@link mergeById}), and caps the length. Polling backs off while the document
 * is hidden so a backgrounded window stops hammering the backend.
 *
 * Used by the Activity feed and any page that wants a cheap live-ish view
 * without an SSE stream.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeById } from './merge-by-id';

export interface UseIncrementalPollOptions<T> {
  /** Fetch the newest page of items. */
  fetchPage: () => Promise<T[]>;
  getId: (item: T) => string;
  /** Base poll interval in ms (default 10000). */
  intervalMs?: number;
  /** Multiplier applied to the interval while the document is hidden (default 6). */
  hiddenBackoff?: number;
  /** Max accumulated items (default 200). */
  max?: number;
  enabled?: boolean;
}

export interface UseIncrementalPollResult<T> {
  items: T[];
  isLoading: boolean;
  error: Error | null;
  /** Epoch ms of the last completed (successful) poll, for a freshness chip. */
  lastPolledAt: number | undefined;
  /** Manually trigger a fetch now. */
  poll: () => void;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useIncrementalPoll<T>(options: UseIncrementalPollOptions<T>): UseIncrementalPollResult<T> {
  // `max` is read through optsRef inside poll() (kept fresh without re-subscribing).
  const { intervalMs = 10_000, hiddenBackoff = 6, enabled = true } = options;
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | undefined>(undefined);

  const optsRef = useRef(options);
  optsRef.current = options;
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    try {
      const page = await optsRef.current.fetchPage();
      setItems((prev) => mergeById(prev, page, optsRef.current.getId, { max: optsRef.current.max ?? 200 }));
      setError(null);
      setLastPolledAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const loop = async () => {
      if (stopped) return;
      await poll();
      if (stopped) return;
      const delay = isHidden() ? intervalMs * hiddenBackoff : intervalMs;
      timer = setTimeout(loop, delay);
    };

    void loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs, hiddenBackoff, poll]);

  return { items, isLoading, error, lastPolledAt, poll: () => void poll() };
}
