'use client';

/**
 * React wrapper over {@link SseConnection}. Opens a Server-Sent-Events stream
 * through the BFF `/omni` mount, exposes the latest messages and a `degraded`
 * flag, and auto-reconnects with backoff. When the stream degrades, the optional
 * `onDegraded` callback lets a page fall back to polling.
 *
 * The reconnect/backoff/watchdog logic is the tested {@link SseConnection}; this
 * hook is only the React lifecycle glue.
 */
import { useEffect, useRef, useState } from 'react';
import { useOmniClient } from '../app/providers/OmniClientProvider';
import { type EventSourceFactory, SseConnection } from './sse-connection';

export interface UseSseOptions {
  /** Named SSE event types to subscribe to beyond the default `message`. */
  events?: string[];
  /** Keep at most this many recent messages in state (default 100). */
  max?: number;
  onMessage?: (data: string, eventType: string) => void;
  getSequence?: (data: string, eventType: string) => number | undefined;
  onGap?: (from: number, to: number) => void;
  /** Called whenever the degraded flag flips — wire a polling fallback here. */
  onDegraded?: (degraded: boolean) => void;
  /** Disable the stream (e.g. before a target is selected). */
  enabled?: boolean;
  /** Injectable EventSource constructor for tests; defaults to the browser's. */
  createEventSource?: EventSourceFactory;
}

export interface SseMessage {
  data: string;
  eventType: string;
  receivedAt: number;
}

export interface UseSseResult {
  messages: SseMessage[];
  degraded: boolean;
  connected: boolean;
}

const defaultFactory: EventSourceFactory = (url) => new EventSource(url) as unknown as ReturnType<EventSourceFactory>;

export function useSse(path: string, options: UseSseOptions = {}): UseSseResult {
  const { bffBase } = useOmniClient();
  const { enabled = true, max = 100 } = options;
  const [messages, setMessages] = useState<SseMessage[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [connected, setConnected] = useState(false);

  // Keep callbacks in a ref so changing them doesn't tear down the stream.
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!enabled) return;
    const url = `${bffBase}/api/v2${path}`;
    const factory = optsRef.current.createEventSource ?? defaultFactory;

    const conn = new SseConnection({
      url,
      createEventSource: factory,
      events: optsRef.current.events,
      onOpen: () => setConnected(true),
      onMessage: (data, eventType) => {
        optsRef.current.onMessage?.(data, eventType);
        setMessages((prev) => {
          const next = [{ data, eventType, receivedAt: Date.now() }, ...prev];
          if (next.length > max) next.length = max;
          return next;
        });
      },
      getSequence: optsRef.current.getSequence,
      onGap: optsRef.current.onGap,
      onDegradedChange: (d) => {
        setDegraded(d);
        if (d) setConnected(false);
        optsRef.current.onDegraded?.(d);
      },
    });

    conn.start();
    return () => conn.stop();
  }, [bffBase, path, enabled, max]);

  return { messages, degraded, connected };
}
