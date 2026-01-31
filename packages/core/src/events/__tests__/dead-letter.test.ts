import { describe, expect, test } from 'bun:test';
import {
  AUTO_RETRY_DELAYS_MS,
  MAX_AUTO_RETRIES,
  calculateNextAutoRetryAt,
  createDeadLetterSystemPayload,
  prepareDeadLetterInsert,
} from '../dead-letter';
import type { OmniEvent } from '../types';

describe('dead-letter', () => {
  describe('AUTO_RETRY_DELAYS_MS', () => {
    test('has correct delays', () => {
      expect(AUTO_RETRY_DELAYS_MS[0]).toBe(1 * 60 * 60 * 1000); // 1 hour
      expect(AUTO_RETRY_DELAYS_MS[1]).toBe(6 * 60 * 60 * 1000); // 6 hours
      expect(AUTO_RETRY_DELAYS_MS[2]).toBe(24 * 60 * 60 * 1000); // 24 hours
    });
  });

  describe('MAX_AUTO_RETRIES', () => {
    test('is 3', () => {
      expect(MAX_AUTO_RETRIES).toBe(3);
    });
  });

  describe('calculateNextAutoRetryAt', () => {
    test('returns 1 hour later for first retry', () => {
      const now = new Date('2026-01-30T12:00:00Z');
      const next = calculateNextAutoRetryAt(0, now);

      expect(next).not.toBeNull();
      expect(next?.getTime()).toBe(now.getTime() + 1 * 60 * 60 * 1000);
    });

    test('returns 6 hours later for second retry', () => {
      const now = new Date('2026-01-30T12:00:00Z');
      const next = calculateNextAutoRetryAt(1, now);

      expect(next).not.toBeNull();
      expect(next?.getTime()).toBe(now.getTime() + 6 * 60 * 60 * 1000);
    });

    test('returns 24 hours later for third retry', () => {
      const now = new Date('2026-01-30T12:00:00Z');
      const next = calculateNextAutoRetryAt(2, now);

      expect(next).not.toBeNull();
      expect(next?.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000);
    });

    test('returns null after max retries', () => {
      const now = new Date('2026-01-30T12:00:00Z');
      const next = calculateNextAutoRetryAt(3, now);

      expect(next).toBeNull();
    });

    test('returns null for high retry counts', () => {
      const now = new Date('2026-01-30T12:00:00Z');
      const next = calculateNextAutoRetryAt(10, now);

      expect(next).toBeNull();
    });

    test('uses current time as default', () => {
      const before = Date.now();
      const next = calculateNextAutoRetryAt(0);
      const after = Date.now();

      expect(next).not.toBeNull();
      // Should be 1 hour from now (plus/minus execution time)
      expect(next?.getTime()).toBeGreaterThanOrEqual(before + 1 * 60 * 60 * 1000);
      expect(next?.getTime()).toBeLessThanOrEqual(after + 1 * 60 * 60 * 1000 + 1000);
    });
  });

  describe('prepareDeadLetterInsert', () => {
    const mockEvent: OmniEvent = {
      id: 'event-123',
      type: 'message.received',
      payload: { text: 'Hello' },
      timestamp: Date.now(),
      metadata: {
        correlationId: 'corr-123',
        instanceId: 'instance-1',
      },
    };

    test('prepares insert data correctly', () => {
      const error = new Error('Processing failed');
      error.stack = 'Error: Processing failed\n    at test.ts:1:1';

      const result = prepareDeadLetterInsert({
        event: mockEvent,
        subject: 'message.received.whatsapp.wa-001',
        error,
        retryCount: 3,
      });

      expect(result.eventId).toBe('event-123');
      expect(result.eventType).toBe('message.received');
      expect(result.subject).toBe('message.received.whatsapp.wa-001');
      expect(result.payload).toBe(mockEvent as unknown as Record<string, unknown>);
      expect(result.error).toBe('Processing failed');
      expect(result.stack).toBe('Error: Processing failed\n    at test.ts:1:1');
      expect(result.autoRetryCount).toBe(0);
      expect(result.status).toBe('pending');
    });

    test('sets initial nextAutoRetryAt', () => {
      const error = new Error('Test error');
      const before = Date.now();

      const result = prepareDeadLetterInsert({
        event: mockEvent,
        subject: 'message.received',
        error,
        retryCount: 3,
      });

      expect(result.nextAutoRetryAt).not.toBeNull();
      // Should be 1 hour from now
      expect(result.nextAutoRetryAt?.getTime()).toBeGreaterThanOrEqual(before + 1 * 60 * 60 * 1000);
    });

    test('handles error without stack', () => {
      const error = new Error('Test error');
      (error as { stack?: string }).stack = undefined;

      const result = prepareDeadLetterInsert({
        event: mockEvent,
        subject: 'message.received',
        error,
        retryCount: 3,
      });

      expect(result.stack).toBeNull();
    });
  });

  describe('createDeadLetterSystemPayload', () => {
    test('creates system payload with all fields', () => {
      const entry = {
        eventId: 'event-123',
        eventType: 'message.received',
        error: 'Processing failed',
        autoRetryCount: 1,
        nextAutoRetryAt: new Date('2026-01-30T18:00:00Z'),
      };

      const before = Date.now();
      const payload = createDeadLetterSystemPayload('dead-letter-456', entry);
      const after = Date.now();

      expect(payload.deadLetterId).toBe('dead-letter-456');
      expect(payload.originalEventId).toBe('event-123');
      expect(payload.originalEventType).toBe('message.received');
      expect(payload.error).toBe('Processing failed');
      expect(payload.retryCount).toBe(1);
      expect(payload.nextAutoRetryAt).toBe(new Date('2026-01-30T18:00:00Z').getTime());
      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });

    test('handles null nextAutoRetryAt', () => {
      const entry = {
        eventId: 'event-123',
        eventType: 'message.received',
        error: 'Processing failed',
        autoRetryCount: 3,
        nextAutoRetryAt: null,
      };

      const payload = createDeadLetterSystemPayload('dead-letter-456', entry);

      expect(payload.nextAutoRetryAt).toBeNull();
    });
  });
});
