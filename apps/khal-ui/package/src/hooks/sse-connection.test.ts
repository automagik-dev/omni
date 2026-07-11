import { describe, expect, test } from 'bun:test';
import { type EventSourceLike, SseConnection, type TimerHost } from './sse-connection';

/** Controllable EventSource double. */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  listeners = new Map<string, (event: MessageEvent) => void>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  emitOpen(): void {
    this.onopen?.(new Event('open'));
  }
  emitMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  emitNamed(type: string, data: string): void {
    this.listeners.get(type)?.({ data } as MessageEvent);
  }
  emitError(): void {
    this.onerror?.(new Event('error'));
  }
}

/** Manual clock: records scheduled timers and fires them on demand. */
function manualTimers() {
  let seq = 0;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const host: TimerHost = {
    set(fn, ms) {
      const handle = seq++;
      pending.set(handle, { fn, ms });
      return handle;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    host,
    /** Fire the pending timer scheduled for exactly `ms`. */
    fire(ms: number) {
      for (const [handle, entry] of pending) {
        if (entry.ms === ms) {
          pending.delete(handle);
          entry.fn();
          return;
        }
      }
      throw new Error(`no pending timer for ${ms}ms (have ${[...pending.values()].map((p) => p.ms).join(',')})`);
    },
    count() {
      return pending.size;
    },
  };
}

function setup() {
  FakeEventSource.instances = [];
  const timers = manualTimers();
  const degradedLog: boolean[] = [];
  const messages: string[] = [];
  const gaps: Array<[number, number]> = [];
  const conn = new SseConnection({
    url: '/omni/api/v2/logs/stream',
    createEventSource: (url) => new FakeEventSource(url),
    onMessage: (data) => messages.push(data),
    onDegradedChange: (d) => degradedLog.push(d),
    getSequence: (data) => {
      const n = Number(data);
      return Number.isNaN(n) ? undefined : n;
    },
    onGap: (from, to) => gaps.push([from, to]),
    backoffBaseMs: 1000,
    backoffMaxMs: 30_000,
    heartbeatMs: 30_000,
    timers: timers.host,
  });
  return { conn, timers, degradedLog, messages, gaps };
}

describe('SseConnection', () => {
  test('reconnects after an error and flips the degraded flag', () => {
    const { conn, timers, degradedLog } = setup();
    conn.start();
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]?.emitOpen();
    expect(conn.degraded).toBe(false);

    // Upstream drops.
    FakeEventSource.instances[0]?.emitError();
    expect(conn.degraded).toBe(true);
    expect(degradedLog).toContain(true);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);

    // Backoff timer fires → a fresh EventSource is created (reconnect).
    timers.fire(1000);
    expect(FakeEventSource.instances).toHaveLength(2);

    // Healthy reopen clears degraded.
    FakeEventSource.instances[1]?.emitOpen();
    expect(conn.degraded).toBe(false);
    expect(degradedLog).toEqual([true, false]);
  });

  test('uses exponential backoff across successive failures', () => {
    const { conn, timers } = setup();
    conn.start();
    FakeEventSource.instances[0]?.emitError(); // attempt 0 → delay 1000
    timers.fire(1000);
    FakeEventSource.instances[1]?.emitError(); // attempt 1 → delay 2000
    timers.fire(2000);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  test('watchdog forces a reconnect when no frame arrives', () => {
    const { conn, timers } = setup();
    conn.start();
    FakeEventSource.instances[0]?.emitOpen();
    // No frames within the heartbeat window → stall.
    timers.fire(30_000);
    expect(conn.degraded).toBe(true);
    timers.fire(1000); // backoff reconnect
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  test('heartbeatMs=0 disables the stall watchdog (comment-keepalive streams)', () => {
    FakeEventSource.instances = [];
    const timers = manualTimers();
    const degradedLog: boolean[] = [];
    const conn = new SseConnection({
      url: '/omni/api/v2/agent-state/stream?chatId=x',
      createEventSource: (url) => new FakeEventSource(url),
      events: ['connected', 'agent.state.changed'],
      onDegradedChange: (d) => degradedLog.push(d),
      heartbeatMs: 0,
      timers: timers.host,
    });
    conn.start();
    FakeEventSource.instances[0]?.emitOpen();
    // The `connected` frame arrives; then the stream is idle (change-only).
    FakeEventSource.instances[0]?.emitNamed('connected', '{"chatId":"x","agentId":null}');
    // No watchdog was scheduled, so there is nothing to fire and no false stall.
    expect(timers.count()).toBe(0);
    expect(conn.degraded).toBe(false);
    // A real transport error still degrades and reconnects via backoff.
    FakeEventSource.instances[0]?.emitError();
    expect(conn.degraded).toBe(true);
    timers.fire(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  test('delivers messages and detects sequence gaps', () => {
    const { conn, messages, gaps } = setup();
    conn.start();
    FakeEventSource.instances[0]?.emitOpen();
    FakeEventSource.instances[0]?.emitMessage('1');
    FakeEventSource.instances[0]?.emitMessage('2');
    FakeEventSource.instances[0]?.emitMessage('5'); // gap 2 → 5
    expect(messages).toEqual(['1', '2', '5']);
    expect(gaps).toEqual([[2, 5]]);
  });

  test('stop() closes the source and cancels timers', () => {
    const { conn, timers } = setup();
    conn.start();
    FakeEventSource.instances[0]?.emitError();
    expect(timers.count()).toBeGreaterThan(0);
    conn.stop();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(timers.count()).toBe(0);
  });
});
