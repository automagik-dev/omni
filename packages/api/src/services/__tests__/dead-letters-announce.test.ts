/**
 * #1163: a dead letter must never be filed silently. With a bus the
 * system.dead_letter announcement is published; without one the service warns
 * exactly once so an operator can see the announcement channel is inert.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { type EventBus, configureLogging, getLogConfig } from '@omni/core';
import type { Database } from '@omni/db';
import { DeadLetterService } from '../dead-letters';

function fakeDb(): Database {
  const row = {
    id: 'dl-1',
    eventId: 'ev-1',
    eventType: 'custom.test',
    error: 'boom',
    autoRetryCount: 0,
    nextAutoRetryAt: null,
    status: 'pending',
  };
  return {
    insert: () => ({ values: () => ({ returning: async () => [row] }) }),
  } as unknown as Database;
}

const input = { eventId: 'ev-1', eventType: 'custom.test', subject: 'custom.test', payload: {}, errors: ['bad'] };

describe('DeadLetterService system.dead_letter announcement', () => {
  const previousLevel = getLogConfig().level;
  beforeEach(() => configureLogging({ level: 'warn' }));
  afterEach(() => configureLogging({ level: previousLevel }));

  test('publishes system.dead_letter when the bus is present', async () => {
    const publishGeneric = mock(async () => undefined);
    const service = new DeadLetterService(fakeDb(), { publishGeneric } as unknown as EventBus);

    await service.createSchemaValidationFailure(input);

    expect(publishGeneric).toHaveBeenCalledTimes(1);
    const call = publishGeneric.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[0]).toBe('system.dead_letter');
    expect(call[1].deadLetterId).toBe('dl-1');
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
