/**
 * Reconnecting Server-Sent-Events client — the state machine behind
 * {@link useSse}, extracted so the reconnect/backoff/watchdog logic is unit
 * testable with an injected `EventSource` and injected timers (no real DOM, no
 * real clock).
 *
 * Behaviour:
 * - Opens an `EventSource` and streams parsed messages to `onMessage`.
 * - On error, closes and reconnects with exponential backoff (+ jitter), and
 *   raises the `degraded` flag so the UI can fall back to polling.
 * - An optional stall watchdog forces a reconnect if no frame arrives within
 *   `heartbeatMs`. This only guards streams that emit periodic *data* frames.
 *   `EventSource` silently swallows SSE comment lines (`: heartbeat`), so a
 *   change-only stream whose sole keepalive is a comment would false-trip the
 *   watchdog even while healthy — pass `heartbeatMs: 0` to disable it and let
 *   `EventSource`'s own error detection drive `degraded` instead. (The upstream
 *   comment keepalive still holds the TCP connection open; only our app-level
 *   frame watchdog is blind to it.)
 * - On a healthy (re)open, backoff resets and `degraded` clears.
 * - Optional gap detection: if `getSequence` is supplied, non-consecutive
 *   sequence numbers invoke `onGap` (a hook point for later groups to backfill).
 */

/** Minimal EventSource surface — the browser `EventSource`, or a test double. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
}

/** Constructs an EventSource for `url`. Injected so tests can supply a double. */
export type EventSourceFactory = (url: string) => EventSourceLike;

/** Timer seam so tests can drive the clock deterministically. */
export interface TimerHost {
  set(handler: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: TimerHost = {
  set: (handler, ms) => setTimeout(handler, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SseConnectionOptions {
  url: string;
  createEventSource: EventSourceFactory;
  /** Named SSE event types to listen for besides the default `message`. */
  events?: string[];
  onMessage?: (data: string, eventType: string) => void;
  onOpen?: () => void;
  onError?: (event: Event) => void;
  /** Raised true when disconnected/stalled, cleared on a healthy reopen. */
  onDegradedChange?: (degraded: boolean) => void;
  /** Extract a monotonic sequence number from a frame to enable gap detection. */
  getSequence?: (data: string, eventType: string) => number | undefined;
  onGap?: (from: number, to: number) => void;
  /** First reconnect delay in ms (default 1000). */
  backoffBaseMs?: number;
  /** Backoff multiplier per attempt (default 2). */
  backoffFactor?: number;
  /** Reconnect delay ceiling in ms (default 30000). */
  backoffMaxMs?: number;
  /**
   * No-frame timeout before a forced reconnect (default 30000). Set to `0` (or
   * any non-positive value) to disable the watchdog entirely — required for
   * change-only streams whose only keepalive is an SSE comment line that
   * `EventSource` never surfaces (e.g. the agent-state stream).
   */
  heartbeatMs?: number;
  timers?: TimerHost;
  /** Jitter in [0,1) for reconnect delay — default deterministic 0 for tests. */
  random?: () => number;
}

export class SseConnection {
  private readonly opts: Required<
    Omit<
      SseConnectionOptions,
      'onMessage' | 'onOpen' | 'onError' | 'onDegradedChange' | 'getSequence' | 'onGap' | 'events'
    >
  > &
    Pick<
      SseConnectionOptions,
      'onMessage' | 'onOpen' | 'onError' | 'onDegradedChange' | 'getSequence' | 'onGap' | 'events'
    >;
  private source: EventSourceLike | null = null;
  private reconnectTimer: unknown = null;
  private watchdogTimer: unknown = null;
  private attempt = 0;
  private stopped = false;
  private _degraded = false;
  private lastSequence: number | null = null;

  constructor(options: SseConnectionOptions) {
    this.opts = {
      backoffBaseMs: 1000,
      backoffFactor: 2,
      backoffMaxMs: 30_000,
      heartbeatMs: 30_000,
      timers: REAL_TIMERS,
      random: () => 0,
      ...options,
    };
  }

  get degraded(): boolean {
    return this._degraded;
  }

  /** Open the stream. Idempotent while already connected. */
  start(): void {
    this.stopped = false;
    this.open();
  }

  /** Close the stream and cancel all timers. Safe to call repeatedly. */
  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.clearWatchdog();
    this.closeSource();
  }

  private open(): void {
    if (this.stopped) return;
    this.closeSource();
    const source = this.opts.createEventSource(this.opts.url);
    this.source = source;

    source.onopen = () => this.handleOpen();
    source.onerror = (event) => this.handleError(event);
    source.onmessage = (event) => this.handleFrame(event.data, 'message');
    for (const type of this.opts.events ?? []) {
      source.addEventListener(type, (event) => this.handleFrame(event.data, type));
    }
    this.armWatchdog();
  }

  private handleOpen(): void {
    this.attempt = 0;
    this.setDegraded(false);
    this.armWatchdog();
    this.opts.onOpen?.();
  }

  private handleFrame(data: string, eventType: string): void {
    this.armWatchdog();
    // A healthy frame after an error means we've recovered.
    if (this._degraded) this.setDegraded(false);

    const seq = this.opts.getSequence?.(data, eventType);
    if (seq !== undefined) {
      if (this.lastSequence !== null && seq > this.lastSequence + 1) {
        this.opts.onGap?.(this.lastSequence, seq);
      }
      this.lastSequence = seq;
    }
    // A frame with empty data (e.g. a bare keepalive event) is liveness only —
    // it re-arms the watchdog above but is not delivered to the consumer.
    if (data !== '') this.opts.onMessage?.(data, eventType);
  }

  private handleError(event: Event): void {
    this.opts.onError?.(event);
    this.setDegraded(true);
    this.closeSource();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearReconnect();
    const { backoffBaseMs, backoffFactor, backoffMaxMs, random } = this.opts;
    const raw = backoffBaseMs * backoffFactor ** this.attempt;
    const capped = Math.min(raw, backoffMaxMs);
    const delay = Math.round(capped * (1 + random() * 0.25));
    this.attempt += 1;
    this.reconnectTimer = this.opts.timers.set(() => this.open(), delay);
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    // heartbeatMs <= 0 disables the stall watchdog: the stream is change-only
    // and kept alive by a comment keepalive EventSource never surfaces, so
    // degraded is driven purely by EventSource's onerror.
    if (this.opts.heartbeatMs <= 0) return;
    this.watchdogTimer = this.opts.timers.set(() => this.handleStall(), this.opts.heartbeatMs);
  }

  private handleStall(): void {
    // No frame within the heartbeat window: treat as degraded and reconnect.
    this.setDegraded(true);
    this.closeSource();
    this.scheduleReconnect();
  }

  private setDegraded(next: boolean): void {
    if (this._degraded === next) return;
    this._degraded = next;
    this.opts.onDegradedChange?.(next);
  }

  private closeSource(): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.opts.timers.clear(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      this.opts.timers.clear(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
