/**
 * SSE push for durable event consumers (`GET /events/consumers/:name/stream`).
 *
 * An opt-in alternative to long-polling `POST /events/consumers/:name/pull`:
 * same journal, same scan, same filters, same order, pushed as Server-Sent
 * Events. Nothing about pull/ack changes, and the stream is READ-ONLY with
 * respect to the consumer: it keeps its position in memory, never writes the
 * stored cursor and never takes or acks a lease. Clients keep committing
 * progress with `POST /events/consumers/:name/ack`.
 *
 * The journal is the single authority. Every page comes from
 * `EventConsumerService.scanForStream` (the pull scan with the readiness gate
 * always on), so any replica can serve a stream and a hollow
 * claimed-but-unfilled row is held, never pushed.
 *
 * Wake-up: one per-process core NATS subscription on the JetStream subjects
 * (a plain subscription on the shared turn-events connection: no JetStream
 * consumer, no server state, no acks, no effect on any existing consumer)
 * fans out to the open streams whose type filter could match the subject.
 * A wake only triggers a re-scan of the journal; it carries no data. The wake
 * can beat the persistence fill, so a woken stream re-scans a few times in
 * quick succession, re-scans fast while a held row is pending, and falls back
 * to a fixed interval otherwise (or always, when NATS is unavailable).
 *
 * Authority is derived once, at connect. So no stream outlives the RELEASE_SLOS
 * termination ceiling (STREAM_TERMINATION_CEILING_SECONDS): it ends with a
 * `reconnect` event carrying an SSE `retry:` hint, and the client reconnects
 * with Last-Event-ID, which re-runs auth, scopes and tenancy. That bounds a
 * revoked key or a suspended tenant for legacy and tenant credentials alike.
 * The `reconnect` event's `id:` is the SCANNED position (every row up to it
 * was sent or filtered out), not the last row sent, so a sparse consumer on a
 * busy journal resumes past the non-matching rows instead of re-scanning them.
 */

import { NotFoundError, STREAM_CONFIGS, ValidationError } from '@omni/core';
import type { OmniEvent } from '@omni/db';
import { STREAM_TERMINATION_CEILING_SECONDS } from '../tenancy/tenant-stream-subscriptions';
import type { StreamScanResult } from './event-consumers';
import { getTurnEventsConnection } from './turn-events';

/** Default SSE heartbeat (EVENT_STREAM_HEARTBEAT_MS). Bun.serve idleTimeout is 60 s. */
export const DEFAULT_STREAM_HEARTBEAT_MS = 15_000;
/** Default re-scan interval with no wake (STREAM_POLL_FALLBACK_MS). */
export const DEFAULT_STREAM_POLL_FALLBACK_MS = 1_000;
/** Re-scan delay while a not-ready row is held at the head of the page. */
const STREAM_HELD_RESCAN_MS = 100;
/** Quick re-scans after a wake, for a fill that lands just after the NATS message. */
const STREAM_WAKE_FOLLOW_UP_MS: readonly number[] = [50, 200, 500];
/** Minimum gap between wake-driven scans of one stream: a burst of events costs one scan. */
const STREAM_MIN_WAKE_GAP_MS = 25;
/** The `retry:` hint sent with the final `reconnect` event (ms). */
export const STREAM_RECONNECT_RETRY_MS = 1_000;
/** Longest a stream may live on one authentication (EVENT_STREAM_MAX_LIFETIME_MS default and ceiling). */
export const STREAM_MAX_LIFETIME_CEILING_MS = STREAM_TERMINATION_CEILING_SECONDS * 1000;
/** Default per-process cap on open streams (EVENT_STREAM_MAX_PER_PROCESS). */
const DEFAULT_STREAM_MAX_PER_PROCESS = 100;
/** Default per-API-key cap on open streams (EVENT_STREAM_MAX_PER_KEY). */
const DEFAULT_STREAM_MAX_PER_KEY = 5;

/** A positive interval from the environment, or the default. Read per stream. */
export function resolveStreamIntervalMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** EVENT_STREAM_MAX_LIFETIME_MS, clamped to the termination ceiling (which is also the default). */
export function resolveStreamMaxLifetimeMs(raw: string | undefined = process.env.EVENT_STREAM_MAX_LIFETIME_MS): number {
  return Math.min(resolveStreamIntervalMs(raw, STREAM_MAX_LIFETIME_CEILING_MS), STREAM_MAX_LIFETIME_CEILING_MS);
}

/** A positive integer from the environment, or the default. */
function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = resolveStreamIntervalMs(raw, fallback);
  return Number.isInteger(parsed) ? parsed : fallback;
}

/** EVENT_STREAM_MAX_PER_PROCESS: a positive integer, or the default (100). */
export function resolveStreamMaxPerProcess(raw: string | undefined = process.env.EVENT_STREAM_MAX_PER_PROCESS): number {
  return resolvePositiveInt(raw, DEFAULT_STREAM_MAX_PER_PROCESS);
}

/** EVENT_STREAM_MAX_PER_KEY: a positive integer, or the default (5). */
export function resolveStreamMaxPerKey(raw: string | undefined = process.env.EVENT_STREAM_MAX_PER_KEY): number {
  return resolvePositiveInt(raw, DEFAULT_STREAM_MAX_PER_KEY);
}

let openStreamSlots = 0;
const openStreamsByKey = new Map<string, number>();

export interface StreamSlotLimits {
  /** Cap for the whole process. */
  perProcess: number;
  /** Cap per API key (legacy and tenant keys alike, keyed by key id). */
  perKey: number;
}

/**
 * Reserve a stream slot for `keyId`, synchronously (so concurrent requests
 * cannot overshoot either cap). Returns the release function, or the cap that
 * refused it. A request with no key id counts toward the process cap only.
 * Release is idempotent.
 */
export function acquireConsumerStreamSlot(
  keyId: string | null,
  limits: StreamSlotLimits,
): { release: () => void } | { refused: 'process' | 'key'; limit: number } {
  if (openStreamSlots >= limits.perProcess) return { refused: 'process', limit: limits.perProcess };
  const held = keyId === null ? 0 : (openStreamsByKey.get(keyId) ?? 0);
  if (keyId !== null && held >= limits.perKey) return { refused: 'key', limit: limits.perKey };
  openStreamSlots++;
  if (keyId !== null) openStreamsByKey.set(keyId, held + 1);
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      openStreamSlots--;
      if (keyId === null) return;
      const left = (openStreamsByKey.get(keyId) ?? 1) - 1;
      if (left > 0) openStreamsByKey.set(keyId, left);
      else openStreamsByKey.delete(keyId);
    },
  };
}

/** Why a stream ended on the server's initiative (sent in the `reconnect` event). */
export type StreamEndReason = 'lifetime' | 'shutdown';

const liveStreams = new Set<(reason: StreamEndReason) => Promise<void>>();

/** Open streams in this process (for tests and diagnostics). */
export function liveConsumerStreamCount(): number {
  return liveStreams.size;
}

/**
 * End every open stream (graceful shutdown, before the DB pool closes): each
 * sends its `reconnect` event and releases its timers. Resolves when all
 * have ended.
 */
export async function closeAllConsumerStreams(): Promise<void> {
  await Promise.all([...liveStreams].map((end) => end('shutdown')));
}

/**
 * Where a stream starts: the `Last-Event-ID` header (an EventSource
 * reconnect), else `?after=`, else the consumer's stored cursor. Delivery is
 * strictly after this position. Inputs arrive Zod-validated by the route.
 */
export function resolveStreamStart(input: { lastEventId?: number; after?: number; cursor: number }): number {
  return input.lastEventId ?? input.after ?? input.cursor;
}

/**
 * Subject prefixes that can carry an event the type filter matches: exact
 * `a.b` → `a.b.` (subjects are `<type>.<channel>.<instance>`), trailing-*
 * glob `a.*` → `a.`. A superset by design: a false wake costs one re-scan.
 */
export function wakePrefixesFor(eventType: string): string[] {
  return [eventType.endsWith('*') ? eventType.slice(0, -1) : `${eventType}.`];
}

interface CoreSubscription {
  unsubscribe(): void;
}

/** The slice of a NATS connection the hub uses (structural, for tests). */
export interface WakeConnection {
  subscribe(subject: string, opts: { callback: (err: unknown, msg: { subject: string }) => void }): CoreSubscription;
}

interface WakeListener {
  prefixes: readonly string[];
  wake: () => void;
}

/**
 * One shared core-NATS listener per process, fanned out to open streams.
 * Subscribes when the first stream registers (retrying on later
 * registrations while NATS is unavailable) and unsubscribes when the last
 * stream leaves, so an idle process holds no subscription at all.
 */
export class ConsumerStreamWakeHub {
  private readonly listeners = new Set<WakeListener>();
  private subscriptions: CoreSubscription[] = [];

  constructor(
    private readonly getConnection: () => WakeConnection | null,
    private readonly subjects: readonly string[],
  ) {}

  /** Wake `wake` on any subject starting with one of `prefixes`. Returns the unregister function. */
  register(prefixes: readonly string[], wake: () => void): () => void {
    const listener: WakeListener = { prefixes, wake };
    this.listeners.add(listener);
    this.attach();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.detach();
    };
  }

  /** Open core subscriptions (0 = polling only). Exposed for tests. */
  get subscriptionCount(): number {
    return this.subscriptions.length;
  }

  private attach(): void {
    if (this.subscriptions.length > 0) return;
    const connection = this.getConnection();
    if (!connection) return;
    try {
      this.subscriptions = this.subjects.map((subject) =>
        connection.subscribe(subject, { callback: (err, msg) => (err ? undefined : this.dispatch(msg.subject)) }),
      );
    } catch {
      this.detach(); // connection closing: streams keep their fallback interval
    }
  }

  private detach(): void {
    for (const subscription of this.subscriptions) {
      try {
        subscription.unsubscribe();
      } catch {
        // already closed with its connection
      }
    }
    this.subscriptions = [];
  }

  private dispatch(subject: string): void {
    for (const listener of this.listeners) {
      if (listener.prefixes.some((prefix) => subject.startsWith(prefix))) listener.wake();
    }
  }
}

/** Every subject the JetStream event streams capture. */
const EVENT_SUBJECTS = Object.values(STREAM_CONFIGS).flatMap((config) => config.subjects ?? []);

/** The process-wide hub, on the shared plain NATS connection (null → polling only). */
export const consumerStreamWakeHub = new ConsumerStreamWakeHub(
  () => getTurnEventsConnection() as WakeConnection | null,
  EVENT_SUBJECTS,
);

export interface ConsumerStreamOptions {
  /** Position to deliver strictly after. */
  start: number;
  /** One journal page strictly after a position (EventConsumerService.scanForStream). */
  scan: (after: number) => Promise<StreamScanResult>;
  /** Write one matching row as an SSE event. Awaited: scanning is driven by successful writes. */
  send: (row: OmniEvent) => Promise<void>;
  /** Write an SSE comment line. */
  heartbeat: () => Promise<void>;
  /** End the stream with a final error event (consumer deleted or no longer streamable). */
  close: (error: Error) => Promise<void>;
  /**
   * End the stream with a final `reconnect` event (lifetime reached or server
   * shutdown). `position` is the resume point for its SSE `id:`: every row at
   * or below it was sent or filtered out, and none was dropped.
   */
  expire: (reason: StreamEndReason, position: number) => Promise<void>;
  /** Server-side lifetime cap (resolveStreamMaxLifetimeMs). */
  maxLifetimeMs: number;
  /** Register for wake-ups; returns the unregister function. */
  subscribeWake: (wake: () => void) => () => void;
  /** Aborted when the client disconnects. */
  signal: AbortSignal;
  heartbeatMs: number;
  fallbackMs: number;
  heldRescanMs?: number;
  wakeFollowUpMs?: readonly number[];
  minWakeGapMs?: number;
  /** A transient scan failure; the stream retries on the fallback interval. */
  onError?: (error: unknown) => void;
}

/** Errors that end the stream instead of being retried. */
function isTerminal(error: unknown): error is Error {
  return error instanceof NotFoundError || error instanceof ValidationError;
}

/**
 * Catch up from `start`, then follow live, until the client disconnects.
 * Scans never overlap: a wake during a scan marks the stream dirty and the
 * scan loop goes round once more. Resolves after every timer, the heartbeat
 * and the wake registration are released.
 */
export async function runConsumerStream(options: ConsumerStreamOptions): Promise<void> {
  const { signal, heartbeatMs, fallbackMs } = options;
  const heldRescanMs = options.heldRescanMs ?? STREAM_HELD_RESCAN_MS;
  const wakeFollowUpMs = options.wakeFollowUpMs ?? STREAM_WAKE_FOLLOW_UP_MS;
  const minWakeGapMs = options.minWakeGapMs ?? STREAM_MIN_WAKE_GAP_MS;

  let position = options.start;
  let stopped = false;
  let running = false;
  let dirty = false;
  let lastScanAt = Number.NEGATIVE_INFINITY;
  let followUps: number[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> = Promise.resolve();
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = () => {
    stopped = true;
    finish();
  };
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });

  /**
   * Server-initiated end. Row delivery stops at once: `stopped` is checked
   * before every row, so an in-flight scan's remaining rows are dropped (the
   * client resumes them via Last-Event-ID). `reconnect` goes out without
   * waiting for that scan; the cleanup below still awaits it. It carries the
   * position as of now, which never includes a dropped row: at worst a row
   * whose write was still in flight is delivered again on resume.
   */
  const end = async (reason: StreamEndReason): Promise<void> => {
    if (stopped) return finished;
    stopped = true;
    clearTimeout(timer);
    if (!signal.aborted) await options.expire(reason, position).catch(() => undefined);
    finish();
  };

  /**
   * Send a page's rows in order; false once the stream ended (no row after
   * the end). `position` advances row by row: before a send, to just below
   * the row (every earlier row of the page was sent or filtered out); after
   * it, to the row. A row dropped at the end is therefore never covered.
   */
  const deliver = async (items: readonly OmniEvent[]): Promise<boolean> => {
    for (const row of items) {
      if (stopped) return false;
      const seq = Number(row.journalSeq);
      position = Math.max(position, seq - 1);
      await options.send(row);
      position = Math.max(position, seq);
    }
    return !stopped;
  };

  /** Scan and send until the journal is drained or a row is held. */
  const drain = async (): Promise<'held' | 'idle'> => {
    for (;;) {
      const page = await options.scan(position);
      if (!(await deliver(page.items))) return 'idle';
      if (page.through !== null) position = Math.max(position, page.through);
      if (page.held) return 'held';
      if (!page.full || stopped) return 'idle';
    }
  };

  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(request, delay);
  };

  const cycle = async (): Promise<void> => {
    let next = fallbackMs;
    try {
      const status = await drain();
      // A wake during the scan re-scans after the minimum gap, not per event.
      next = dirty ? minWakeGapMs : status === 'held' ? heldRescanMs : (followUps.shift() ?? fallbackMs);
    } catch (error) {
      if (stopped) return;
      if (isTerminal(error)) {
        await options.close(error).catch(() => undefined);
        stop();
        return;
      }
      options.onError?.(error);
    } finally {
      running = false;
      dirty = false;
    }
    schedule(next);
  };

  function request(): void {
    if (stopped) return;
    if (running) {
      dirty = true;
      return;
    }
    clearTimeout(timer);
    running = true;
    lastScanAt = Date.now();
    inflight = cycle();
  }

  const onWake = () => {
    followUps = [...wakeFollowUpMs];
    if (running) {
      dirty = true;
      return;
    }
    const wait = lastScanAt + minWakeGapMs - Date.now();
    if (wait <= 0) request();
    else schedule(wait);
  };

  liveStreams.add(end);
  const unsubscribe = options.subscribeWake(onWake);
  const heartbeat = setInterval(() => {
    if (!stopped) options.heartbeat().catch(stop);
  }, heartbeatMs);
  const lifetime = setTimeout(() => void end('lifetime'), options.maxLifetimeMs);

  try {
    request();
    await finished;
  } finally {
    stopped = true;
    liveStreams.delete(end);
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    clearTimeout(timer);
    unsubscribe();
    await inflight.catch(() => undefined);
  }
}
