/**
 * #1163: a dead letter must never be filed silently. With a bus the
 * system.dead_letter announcement is published; without one the service warns
 * exactly once so an operator can see the announcement channel is inert.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { configureLogging, getLogConfig } from '@omni/core';
import type { Database } from '@omni/db';
import { DeadLetterService } from '../dead-letters';

function fakeDb(): Database {
  return {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({ returning: async () => [{ id: 'dl-1', ...values }] }),
    }),
  } as unknown as Database;
}

const input = { eventType: 'custom.test', subject: 'custom.test', payload: {}, errors: ['bad'] };

describe('DeadLetterService system.dead_letter announcement', () => {
  const previousLevel = getLogConfig().level;
  beforeEach(() => configureLogging({ level: 'warn' }));
  afterEach(() => configureLogging({ level: previousLevel }));

  test('publishes system.dead_letter when the bus is present', async () => {
    const publishGeneric = mock(async () => ({ id: 'announced', sequence: 0, stream: 'memory' }));
    const service = new DeadLetterService(fakeDb(), {
      connect: async () => {},
      close: async () => {},
      isConnected: () => true,
      publish: async () => {
        throw new Error('unexpected core publish');
      },
      publishConnector: async () => {
        throw new Error('unexpected connector publish');
      },
      subscribe: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
      subscribePattern: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
      subscribeMany: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
      subscribeAll: async () => ({ id: 'sub', pattern: '', unsubscribe: async () => {} }),
      publishGeneric,
    });

    const row = await service.createSchemaValidationFailure(input);

    expect(publishGeneric).toHaveBeenCalledTimes(1);
    const call = publishGeneric.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[0]).toBe('system.dead_letter');
    expect(call[1].deadLetterId).toBe('dl-1');
    expect(call[1].originalEventId).toBe(row.eventId);
  });

  test('generates unique refusal IDs and ignores a runtime-supplied eventId', async () => {
    const service = new DeadLetterService(fakeDb(), null);
    const supplied = { ...input, eventId: crypto.randomUUID() };
    const first = await service.createSchemaValidationFailure(supplied);
    const second = await service.createSchemaValidationFailure(supplied);

    for (const row of [first, second]) {
      expect(row.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(row.eventId).not.toBe(supplied.eventId);
      expect(row.nextAutoRetryAt).toBeNull();
      expect(row.error).toBe('schema_validation_failed: bad');
    }
    expect(first.eventId).not.toBe(second.eventId);
  });

  test('warns once, not per call, when the bus is absent', async () => {
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const service = new DeadLetterService(fakeDb(), null);
      await service.createSchemaValidationFailure(input);
      await service.createSchemaValidationFailure(input);
      await service.createSchemaValidationFailure(input);

      const warnings = write.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('announcements disabled'));
      expect(warnings).toHaveLength(1);
    } finally {
      write.mockRestore();
    }
  });
});
