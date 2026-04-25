/**
 * Tests for runWithTransientDispatchRetry — issue #540.
 *
 * Verifies:
 * - Transient errors retry up to N times with the configured backoff.
 * - Terminal errors fail-fast on attempt 1, no retries.
 * - A retried call that succeeds on attempt 2 returns normally.
 * - Each retry attempt logs `agent_dispatch_transient_retry` at WARN.
 * - Final failure re-throws so the caller can `sendErrorFeedback`.
 */

import { describe, expect, it, mock } from 'bun:test';

// Mock the plugin loader to avoid real FS/channel-sdk imports — same pattern
// as agent-dispatcher.test.ts. Without this the module init crashes loading
// the parent agent-dispatcher.ts.
mock.module('../loader', () => ({
  getPlugin: mock(() => Promise.resolve(undefined)),
}));

mock.module('@omni/core', () => {
  return {
    createLogger: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
    generateCorrelationId: (prefix: string) => `${prefix}-test`,
    OmniError: class OmniError extends Error {},
    ERROR_CODES: {},
  };
});

import {
  TRANSIENT_DISPATCH_ERROR_PATTERNS,
  TRANSIENT_DISPATCH_RETRY_DELAYS_MS,
  isTransientDispatchError,
  runWithTransientDispatchRetry,
} from '../agent-dispatcher';

const CTX = { instanceId: 'inst-1', chatId: 'chat-1', traceId: 'trace-1' };

describe('isTransientDispatchError', () => {
  it.each([
    'connect ECONNREFUSED 127.0.0.1:8886',
    'read ECONNRESET',
    'request to https://x ETIMEDOUT',
    'getaddrinfo EAI_AGAIN agno-api',
    'fetch failed',
    'socket hang up',
    'network request failed',
    'Upstream returned 502 Bad Gateway',
    'HTTP 503 Service Unavailable',
    'HTTP 504 Gateway Timeout',
  ])('classifies "%s" as transient', (msg) => {
    expect(isTransientDispatchError(new Error(msg))).toBe(true);
  });

  it.each([
    'HTTP 400 Bad Request',
    'HTTP 401 Unauthorized',
    'HTTP 404 Not Found',
    'HTTP 422 Unprocessable Entity',
    'agent not found',
    'invalid input: missing chatId',
    'JSON parse error',
  ])('classifies "%s" as terminal', (msg) => {
    expect(isTransientDispatchError(new Error(msg))).toBe(false);
  });

  it('handles non-Error values via String()', () => {
    expect(isTransientDispatchError('ECONNREFUSED')).toBe(true);
    expect(isTransientDispatchError({ code: 'ECONNREFUSED', toString: () => 'ECONNREFUSED' })).toBe(true);
    expect(isTransientDispatchError(undefined)).toBe(false);
  });

  it('matches error.code when message does not contain the pattern', () => {
    // Some HTTP clients set the system error code on `.code` only, with a
    // generic `message`. Should still classify as transient.
    const err = Object.assign(new Error('upstream connection problem'), { code: 'ECONNREFUSED' });
    expect(isTransientDispatchError(err)).toBe(true);
  });

  it('matches numeric error.status in the 5xx range', () => {
    expect(isTransientDispatchError(Object.assign(new Error('boom'), { status: 502 }))).toBe(true);
    expect(isTransientDispatchError(Object.assign(new Error('boom'), { status: 599 }))).toBe(true);
    // 4xx must NOT classify as transient.
    expect(isTransientDispatchError(Object.assign(new Error('boom'), { status: 400 }))).toBe(false);
    expect(isTransientDispatchError(Object.assign(new Error('boom'), { status: 499 }))).toBe(false);
  });

  it('also reads statusCode (axios-style) for the 5xx check', () => {
    expect(isTransientDispatchError(Object.assign(new Error('boom'), { statusCode: 503 }))).toBe(true);
  });
});

describe('runWithTransientDispatchRetry', () => {
  const noopSleeper = mock(async (_ms: number) => {});

  function makeLogger() {
    const warns: Array<{ msg: string; fields: Record<string, unknown> }> = [];
    return {
      logger: { warn: (msg: string, fields: Record<string, unknown>) => warns.push({ msg, fields }) },
      warns,
    };
  }

  it('returns the result of the first successful attempt', async () => {
    const fn = mock(async () => 'ok');
    const result = await runWithTransientDispatchRetry(fn, CTX, { sleeper: noopSleeper });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and returns when it eventually succeeds', async () => {
    let n = 0;
    const fn = mock(async () => {
      n += 1;
      if (n < 3) throw new Error('connect ECONNREFUSED 127.0.0.1:8886');
      return 'ok';
    });
    const { logger, warns } = makeLogger();

    const result = await runWithTransientDispatchRetry(fn, CTX, {
      sleeper: noopSleeper,
      logger,
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(warns).toHaveLength(2);
    expect(warns[0]?.msg).toBe('agent_dispatch_transient_retry');
    expect(warns[0]?.fields.attempt).toBe(1);
    expect(warns[1]?.fields.attempt).toBe(2);
  });

  it('rethrows after exhausting all retries on persistently transient error', async () => {
    const fn = mock(async () => {
      throw new Error('fetch failed');
    });
    const { logger, warns } = makeLogger();

    await expect(
      runWithTransientDispatchRetry(fn, CTX, {
        delaysMs: [10, 20, 30],
        sleeper: noopSleeper,
        logger,
      }),
    ).rejects.toThrow('fetch failed');

    // 4 attempts total = 1 initial + 3 retries
    expect(fn).toHaveBeenCalledTimes(4);
    expect(warns).toHaveLength(3);
  });

  it('fails fast on terminal error, no retries', async () => {
    const fn = mock(async () => {
      throw new Error('HTTP 400 Bad Request');
    });
    const { logger, warns } = makeLogger();

    await expect(
      runWithTransientDispatchRetry(fn, CTX, {
        sleeper: noopSleeper,
        logger,
      }),
    ).rejects.toThrow('HTTP 400');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(warns).toHaveLength(0);
  });

  it('uses default delay schedule of [500, 2000, 5000]ms', async () => {
    expect(TRANSIENT_DISPATCH_RETRY_DELAYS_MS).toEqual([500, 2000, 5000]);

    const sleeper = mock(async (_ms: number) => {});
    const fn = mock(async () => {
      throw new Error('ETIMEDOUT');
    });

    await expect(runWithTransientDispatchRetry(fn, CTX, { sleeper })).rejects.toThrow();
    // 4 attempts, sleep called between attempts: 3 sleeps with the default delays.
    const calls = (sleeper as unknown as { mock: { calls: number[][] } }).mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[0]?.[0]).toBe(500);
    expect(calls[1]?.[0]).toBe(2000);
    expect(calls[2]?.[0]).toBe(5000);
  });

  it('exposes the canonical transient pattern set', () => {
    // Sanity check the patterns are wired and at least cover the known cases.
    expect(TRANSIENT_DISPATCH_ERROR_PATTERNS.length).toBeGreaterThanOrEqual(6);
  });

  it('logs error.code and error.status fields on retry when present', async () => {
    let n = 0;
    const fn = mock(async () => {
      n += 1;
      if (n === 1) {
        throw Object.assign(new Error('upstream blip'), { code: 'ECONNRESET', status: 502 });
      }
      return 'ok';
    });
    const { logger, warns } = makeLogger();

    const result = await runWithTransientDispatchRetry(fn, CTX, {
      sleeper: noopSleeper,
      logger,
    });

    expect(result).toBe('ok');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.fields.code).toBe('ECONNRESET');
    expect(warns[0]?.fields.status).toBe(502);
    expect(warns[0]?.fields.error).toBe('upstream blip');
  });
});
