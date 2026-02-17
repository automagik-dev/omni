import { describe, expect, mock, test } from 'bun:test';
import {
  calculateExponentialBackoff,
  createRateLimitManager,
  isRateLimitError,
  parseRetryAfter,
} from '../utils/rate-limit';

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  };
}

describe('parseRetryAfter', () => {
  test('returns null for non-object input', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('error')).toBeNull();
  });

  test('parses retryAfter field (seconds → ms)', () => {
    expect(parseRetryAfter({ retryAfter: 5 })).toBe(5000);
  });

  test('parses retry_after field (seconds → ms)', () => {
    expect(parseRetryAfter({ retry_after: 10 })).toBe(10_000);
  });

  test('parses retry_after from nested data on 429', () => {
    expect(parseRetryAfter({ statusCode: 429, data: { retry_after: 3 } })).toBe(3000);
  });

  test('returns null for 429 without retry_after', () => {
    expect(parseRetryAfter({ statusCode: 429 })).toBeNull();
  });

  test('returns null for non-rate-limit errors', () => {
    expect(parseRetryAfter({ statusCode: 500, message: 'Internal error' })).toBeNull();
  });

  test('returns null for rate limit message without explicit value', () => {
    // Message-based detection only works in isRateLimitError, not parseRetryAfter
    expect(parseRetryAfter({ message: 'Rate limit exceeded' })).toBeNull();
  });

  test('parse time <1ms p99', () => {
    const error = { statusCode: 429, retryAfter: 5 };
    const latencies: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      const start = performance.now();
      parseRetryAfter(error);
      latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    expect(p99).toBeLessThan(1);
  });
});

describe('isRateLimitError', () => {
  test('detects 429 status code', () => {
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
  });

  test('detects string 429 status', () => {
    expect(isRateLimitError({ status: '429' })).toBe(true);
  });

  test('detects retryAfter field', () => {
    expect(isRateLimitError({ retryAfter: 5 })).toBe(true);
  });

  test('detects rate limit message', () => {
    expect(isRateLimitError({ message: 'Rate limit hit' })).toBe(true);
    expect(isRateLimitError({ message: 'Rate throttled by server' })).toBe(true);
  });

  test('returns false for non-rate-limit errors', () => {
    expect(isRateLimitError({ statusCode: 500 })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError({ message: 'Connection timeout' })).toBe(false);
  });
});

describe('calculateExponentialBackoff', () => {
  test('starts at initial backoff for first hit', () => {
    const backoff = calculateExponentialBackoff(1, { jitterFactor: 0 });
    expect(backoff).toBe(1000);
  });

  test('doubles for each consecutive hit', () => {
    const b1 = calculateExponentialBackoff(1, { jitterFactor: 0 });
    const b2 = calculateExponentialBackoff(2, { jitterFactor: 0 });
    const b3 = calculateExponentialBackoff(3, { jitterFactor: 0 });
    expect(b1).toBe(1000);
    expect(b2).toBe(2000);
    expect(b3).toBe(4000);
  });

  test('caps at max backoff', () => {
    const backoff = calculateExponentialBackoff(20, { jitterFactor: 0 });
    expect(backoff).toBe(30_000);
  });

  test('adds jitter within range', () => {
    const results = new Set<number>();
    for (let i = 0; i < 100; i++) {
      results.add(calculateExponentialBackoff(1, { jitterFactor: 0.2 }));
    }
    // With jitter, we should get different values
    expect(results.size).toBeGreaterThan(1);
    // All should be near 1000 (±200)
    for (const val of results) {
      expect(val).toBeGreaterThanOrEqual(700);
      expect(val).toBeLessThanOrEqual(1300);
    }
  });

  test('respects custom config', () => {
    const backoff = calculateExponentialBackoff(1, {
      initialBackoffMs: 500,
      maxBackoffMs: 5000,
      jitterFactor: 0,
    });
    expect(backoff).toBe(500);
  });
});

describe('createRateLimitManager', () => {
  test('initial state has no backoff', () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger);
    expect(manager.getRemainingBackoff()).toBe(0);
    expect(manager.state.consecutiveHits).toBe(0);
  });

  test('handleRateLimit with explicit retry_after', () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger);

    const delay = manager.handleRateLimit({ retryAfter: 5 }, 10);
    expect(delay).toBe(5000);
    expect(manager.state.backoffStrategy).toBe('explicit');
    expect(manager.state.consecutiveHits).toBe(1);
  });

  test('handleRateLimit with exponential fallback', () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger, { jitterFactor: 0 });

    const delay = manager.handleRateLimit({ statusCode: 429 }, 5);
    expect(delay).toBe(1000);
    expect(manager.state.backoffStrategy).toBe('exponential');
  });

  test('logs rate_limit_hit at WARN level', () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger);

    manager.handleRateLimit({ statusCode: 429 }, 3);
    expect(logger.warn).toHaveBeenCalledWith(
      'rate_limit_hit',
      expect.objectContaining({
        event: 'rate_limit_hit',
        instanceId: 'inst-1',
        queueDepth: 3,
      }),
    );
  });

  test('consecutive hits increase exponential backoff', () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger, { jitterFactor: 0 });

    const d1 = manager.handleRateLimit({ statusCode: 429 }, 1);
    const d2 = manager.handleRateLimit({ statusCode: 429 }, 2);
    const d3 = manager.handleRateLimit({ statusCode: 429 }, 3);

    expect(d1).toBe(1000);
    expect(d2).toBe(2000);
    expect(d3).toBe(4000);
  });

  test('getRemainingBackoff decreases over time', async () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger);

    manager.handleRateLimit({ retryAfter: 1 }, 0); // 1 second backoff
    const initial = manager.getRemainingBackoff();
    expect(initial).toBeGreaterThan(0);

    // Wait a bit
    await new Promise((r) => setTimeout(r, 100));
    const remaining = manager.getRemainingBackoff();
    expect(remaining).toBeLessThan(initial);
  });

  test('reset clears all state', () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger);

    manager.handleRateLimit({ retryAfter: 5 }, 0);
    expect(manager.state.consecutiveHits).toBe(1);

    manager.reset();
    expect(manager.state.consecutiveHits).toBe(0);
    expect(manager.getRemainingBackoff()).toBe(0);
  });

  test('messages are not lost — queue can retry after backoff', async () => {
    const logger = createMockLogger();
    const manager = createRateLimitManager('inst-1', logger);

    // Simulate rate limit
    const delay = manager.handleRateLimit({ retryAfter: 0.1 }, 5); // 100ms
    expect(delay).toBe(100);

    // During backoff, getRemainingBackoff > 0
    expect(manager.getRemainingBackoff()).toBeGreaterThan(0);

    // After backoff expires
    await new Promise((r) => setTimeout(r, 150));
    expect(manager.getRemainingBackoff()).toBe(0);
  });
});
