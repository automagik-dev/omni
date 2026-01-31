import { describe, expect, test } from 'bun:test';
import {
  createReplayCompletedPayload,
  createReplayStartedPayload,
  estimateCompletion,
  validateReplayOptions,
} from '../replay';
import type { ReplayOptions, ReplayProgress, ReplayResult } from '../replay';

describe('replay', () => {
  describe('validateReplayOptions', () => {
    test('requires since', () => {
      const result = validateReplayOptions({} as ReplayOptions);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('since is required');
    });

    test('accepts valid options with only since', () => {
      const result = validateReplayOptions({
        since: new Date(),
      });
      expect(result.valid).toBe(true);
    });

    test('rejects until before since', () => {
      const since = new Date('2026-01-30T12:00:00Z');
      const until = new Date('2026-01-30T11:00:00Z');

      const result = validateReplayOptions({ since, until });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('until must be after since');
    });

    test('rejects until equal to since', () => {
      const time = new Date('2026-01-30T12:00:00Z');

      const result = validateReplayOptions({ since: time, until: time });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('until must be after since');
    });

    test('accepts valid date range', () => {
      const since = new Date('2026-01-30T12:00:00Z');
      const until = new Date('2026-01-30T13:00:00Z');

      const result = validateReplayOptions({ since, until });
      expect(result.valid).toBe(true);
    });

    test('rejects zero limit', () => {
      const result = validateReplayOptions({
        since: new Date(),
        limit: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('limit must be positive');
    });

    test('rejects negative limit', () => {
      const result = validateReplayOptions({
        since: new Date(),
        limit: -5,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('limit must be positive');
    });

    test('accepts positive limit', () => {
      const result = validateReplayOptions({
        since: new Date(),
        limit: 100,
      });
      expect(result.valid).toBe(true);
    });

    test('rejects negative speedMultiplier', () => {
      const result = validateReplayOptions({
        since: new Date(),
        speedMultiplier: -1,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('speedMultiplier cannot be negative');
    });

    test('accepts zero speedMultiplier (instant)', () => {
      const result = validateReplayOptions({
        since: new Date(),
        speedMultiplier: 0,
      });
      expect(result.valid).toBe(true);
    });

    test('accepts positive speedMultiplier', () => {
      const result = validateReplayOptions({
        since: new Date(),
        speedMultiplier: 2.5,
      });
      expect(result.valid).toBe(true);
    });

    test('accepts full valid options', () => {
      const result = validateReplayOptions({
        since: new Date('2026-01-30T12:00:00Z'),
        until: new Date('2026-01-30T13:00:00Z'),
        eventTypes: ['message.received'],
        instanceId: 'instance-1',
        limit: 1000,
        speedMultiplier: 1,
        skipProcessed: true,
        dryRun: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('createReplayStartedPayload', () => {
    test('creates payload with all fields', () => {
      const options: ReplayOptions = {
        since: new Date('2026-01-30T12:00:00Z'),
        until: new Date('2026-01-30T13:00:00Z'),
        eventTypes: ['message.received', 'message.sent'],
        instanceId: 'instance-123',
        limit: 500,
      };

      const before = Date.now();
      const payload = createReplayStartedPayload('session-456', options);
      const after = Date.now();

      expect(payload.sessionId).toBe('session-456');
      expect(payload.since).toBe(new Date('2026-01-30T12:00:00Z').getTime());
      expect(payload.until).toBe(new Date('2026-01-30T13:00:00Z').getTime());
      expect(payload.eventTypes).toEqual(['message.received', 'message.sent']);
      expect(payload.instanceId).toBe('instance-123');
      expect(payload.limit).toBe(500);
      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });

    test('handles optional fields', () => {
      const options: ReplayOptions = {
        since: new Date('2026-01-30T12:00:00Z'),
      };

      const payload = createReplayStartedPayload('session-789', options);

      expect(payload.sessionId).toBe('session-789');
      expect(payload.since).toBe(new Date('2026-01-30T12:00:00Z').getTime());
      expect(payload.until).toBeUndefined();
      expect(payload.eventTypes).toBeUndefined();
      expect(payload.instanceId).toBeUndefined();
      expect(payload.limit).toBeUndefined();
    });
  });

  describe('createReplayCompletedPayload', () => {
    test('creates payload with all fields', () => {
      const result: ReplayResult = {
        success: true,
        eventsProcessed: 1000,
        eventsSkipped: 50,
        errors: 5,
        durationMs: 30000,
      };

      const before = Date.now();
      const payload = createReplayCompletedPayload('session-456', result);
      const after = Date.now();

      expect(payload.sessionId).toBe('session-456');
      expect(payload.eventsProcessed).toBe(1000);
      expect(payload.eventsSkipped).toBe(50);
      expect(payload.errors).toBe(5);
      expect(payload.durationMs).toBe(30000);
      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('estimateCompletion', () => {
    test('returns undefined when no events processed', () => {
      const progress: ReplayProgress = {
        total: 1000,
        processed: 0,
        skipped: 0,
        errors: 0,
        startedAt: new Date(),
      };

      const result = estimateCompletion(progress);
      expect(result).toBeUndefined();
    });

    test('estimates completion based on progress rate', () => {
      // Simulate 100 events processed in 1 second
      const startedAt = new Date(Date.now() - 1000);
      const progress: ReplayProgress = {
        total: 1000,
        processed: 100,
        skipped: 0,
        errors: 0,
        startedAt,
      };

      const result = estimateCompletion(progress);
      expect(result).toBeDefined();

      // With 100 events/second and 900 remaining, should complete in ~9 seconds
      const remainingMs = (result?.getTime() ?? 0) - Date.now();
      expect(remainingMs).toBeGreaterThan(8000);
      expect(remainingMs).toBeLessThan(10000);
    });

    test('accounts for already elapsed time', () => {
      // Already ran for 5 seconds, processed half
      const startedAt = new Date(Date.now() - 5000);
      const progress: ReplayProgress = {
        total: 1000,
        processed: 500,
        skipped: 0,
        errors: 0,
        startedAt,
      };

      const result = estimateCompletion(progress);
      expect(result).toBeDefined();

      // Should estimate ~5 more seconds
      const remainingMs = (result?.getTime() ?? 0) - Date.now();
      expect(remainingMs).toBeGreaterThan(4000);
      expect(remainingMs).toBeLessThan(6000);
    });
  });
});
