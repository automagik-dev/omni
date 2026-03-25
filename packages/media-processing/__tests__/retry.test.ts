/**
 * Tests for retry module
 */

import { describe, expect, it } from 'bun:test';
import { calculateBackoffDelay, isTransientError, withRetry } from '../src/retry';

describe('retry', () => {
  describe('isTransientError', () => {
    it('detects rate limit errors (429)', () => {
      expect(isTransientError(new Error('Request failed with status 429'))).toBe(true);
      expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
      expect(isTransientError(new Error('Too Many Requests'))).toBe(true);
    });

    it('detects resource exhausted errors', () => {
      expect(isTransientError(new Error('RESOURCE_EXHAUSTED: quota exceeded'))).toBe(true);
      expect(isTransientError(new Error('resource exhausted'))).toBe(true);
    });

    it('detects timeout errors', () => {
      expect(isTransientError(new Error('Request timed out'))).toBe(true);
      expect(isTransientError(new Error('Operation timeout'))).toBe(true);
      expect(isTransientError(new Error('Connection aborted'))).toBe(true);

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      expect(isTransientError(abortError)).toBe(true);
    });

    it('detects network errors', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
      expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isTransientError(new Error('ENOTFOUND'))).toBe(true);
      expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isTransientError(new Error('fetch failed'))).toBe(true);
      expect(isTransientError(new Error('socket hang up'))).toBe(true);
    });

    it('detects server errors (5xx)', () => {
      expect(isTransientError(new Error('Request failed with status 500'))).toBe(true);
      expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
      expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isTransientError(new Error('504 Gateway Timeout'))).toBe(true);
      expect(isTransientError(new Error('Internal Server Error'))).toBe(true);
    });

    it('does not detect non-transient errors', () => {
      expect(isTransientError(new Error('Invalid API key'))).toBe(false);
      expect(isTransientError(new Error('Not Found (404)'))).toBe(false);
      expect(isTransientError(new Error('Bad Request'))).toBe(false);
      expect(isTransientError(new Error('Unauthorized'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isTransientError('some string')).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
      expect(isTransientError(42)).toBe(false);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('calculates exponential delay', () => {
      // With jitter, delay is between base and base*1.25
      const delay0 = calculateBackoffDelay(0, 1000, 10000);
      expect(delay0).toBeGreaterThanOrEqual(1000);
      expect(delay0).toBeLessThanOrEqual(1250);

      const delay1 = calculateBackoffDelay(1, 1000, 10000);
      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay1).toBeLessThanOrEqual(2500);

      const delay2 = calculateBackoffDelay(2, 1000, 10000);
      expect(delay2).toBeGreaterThanOrEqual(4000);
      expect(delay2).toBeLessThanOrEqual(5000);
    });

    it('respects maximum delay', () => {
      const delay = calculateBackoffDelay(10, 1000, 5000);
      expect(delay).toBeGreaterThanOrEqual(5000);
      expect(delay).toBeLessThanOrEqual(6250); // 5000 + 25% jitter
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const result = await withRetry(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    it('retries on transient error and succeeds', async () => {
      let calls = 0;
      const result = await withRetry(
        () => {
          calls++;
          if (calls < 3) {
            throw new Error('429 rate limit');
          }
          return Promise.resolve('recovered');
        },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
      );
      expect(result).toBe('recovered');
      expect(calls).toBe(3);
    });

    it('does not retry on non-transient error', async () => {
      let calls = 0;
      try {
        await withRetry(
          () => {
            calls++;
            throw new Error('Invalid API key');
          },
          { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
        );
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toBe('Invalid API key');
        expect(calls).toBe(1); // Only one attempt, no retries
      }
    });

    it('throws after all retries exhausted', async () => {
      let calls = 0;
      try {
        await withRetry(
          () => {
            calls++;
            throw new Error('503 Service Unavailable');
          },
          { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 },
        );
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toBe('503 Service Unavailable');
        expect(calls).toBe(3); // 1 initial + 2 retries
      }
    });

    it('calls onRetry callback', async () => {
      const retryAttempts: number[] = [];
      try {
        await withRetry(
          () => {
            throw new Error('ECONNRESET');
          },
          {
            maxRetries: 2,
            baseDelayMs: 10,
            maxDelayMs: 50,
            onRetry: (attempt) => retryAttempts.push(attempt),
          },
        );
      } catch {
        // expected
      }
      expect(retryAttempts).toEqual([1, 2]);
    });

    it('respects per-attempt timeout', async () => {
      try {
        await withRetry(() => new Promise((resolve) => setTimeout(resolve, 5000)), { maxRetries: 0, timeoutMs: 50 });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('timed out');
      }
    });
  });
});
