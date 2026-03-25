/**
 * Tests for circuit breaker module
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { CircuitBreaker, CircuitOpenError, getCircuitBreaker, resetAllCircuitBreakers } from '../src/circuit-breaker';

describe('CircuitBreaker', () => {
  afterEach(() => {
    resetAllCircuitBreakers();
  });

  describe('initial state', () => {
    it('starts in closed state', () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      expect(breaker.getState()).toBe('closed');
    });

    it('has zero failures and successes initially', () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.state).toBe('closed');
      expect(stats.name).toBe('test');
    });
  });

  describe('closed state', () => {
    it('executes functions normally', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const result = await breaker.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    it('tracks successes', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      await breaker.execute(() => Promise.resolve('ok'));
      await breaker.execute(() => Promise.resolve('ok'));
      expect(breaker.getStats().successes).toBe(2);
    });

    it('tracks failures without opening below threshold', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 5 });

      for (let i = 0; i < 4; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // expected
        }
      }

      expect(breaker.getState()).toBe('closed');
      expect(breaker.getStats().failures).toBe(4);
    });
  });

  describe('opening the circuit', () => {
    it('opens after failureThreshold failures', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3 });

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // expected
        }
      }

      expect(breaker.getState()).toBe('open');
    });

    it('rejects immediately when open', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1 });

      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch {
        // expected
      }

      expect(breaker.getState()).toBe('open');

      try {
        await breaker.execute(() => Promise.resolve('should not run'));
        expect.unreachable('Should have thrown CircuitOpenError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
        expect((error as Error).message).toContain('test');
      }
    });
  });

  describe('half-open state', () => {
    it('transitions to half-open after resetTimeout', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeoutMs: 50, // Very short for testing
      });

      // Trip the breaker
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch {
        // expected
      }
      expect(breaker.getState()).toBe('open');

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 60));

      expect(breaker.getState()).toBe('half-open');
    });

    it('closes on successful probe', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeoutMs: 50,
      });

      // Trip the breaker
      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch {
        // expected
      }

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 60));

      // Successful probe
      const result = await breaker.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
      expect(breaker.getState()).toBe('closed');
    });

    it('re-opens on failed probe', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeoutMs: 50,
      });

      // Trip the breaker
      try {
        await breaker.execute(() => Promise.reject(new Error('fail1')));
      } catch {
        // expected
      }

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 60));

      // Failed probe
      try {
        await breaker.execute(() => Promise.reject(new Error('still failing')));
      } catch {
        // expected
      }

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('rolling window', () => {
    it('forgets old failures outside the window', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 3,
        windowMs: 100, // Very short window for testing
      });

      // Add 2 failures
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // expected
        }
      }

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 150));

      // Add 2 more failures — should still be closed because old ones expired
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch {
          // expected
        }
      }

      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('reset', () => {
    it('resets breaker to closed state', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 1 });

      try {
        await breaker.execute(() => Promise.reject(new Error('fail')));
      } catch {
        // expected
      }
      expect(breaker.getState()).toBe('open');

      breaker.reset();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getStats().failures).toBe(0);
      expect(breaker.getStats().successes).toBe(0);
    });
  });

  describe('getCircuitBreaker registry', () => {
    it('returns the same instance for the same name', () => {
      const breaker1 = getCircuitBreaker('groq');
      const breaker2 = getCircuitBreaker('groq');
      expect(breaker1).toBe(breaker2);
    });

    it('returns different instances for different names', () => {
      const groq = getCircuitBreaker('groq');
      const openai = getCircuitBreaker('openai');
      expect(groq).not.toBe(openai);
    });
  });

  describe('resetAllCircuitBreakers', () => {
    it('clears the registry', () => {
      const breaker1 = getCircuitBreaker('test1');
      resetAllCircuitBreakers();
      const breaker2 = getCircuitBreaker('test1');
      expect(breaker1).not.toBe(breaker2);
    });
  });
});
