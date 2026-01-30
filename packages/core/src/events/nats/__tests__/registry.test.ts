import { beforeEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { EventRegistry, SystemEventSchemas, createEventSchema } from '../registry';

describe('EventRegistry', () => {
  let registry: EventRegistry;

  beforeEach(() => {
    registry = new EventRegistry();
  });

  describe('register', () => {
    test('registers custom events', () => {
      registry.register({
        eventType: 'custom.webhook.github',
        schema: z.object({ action: z.string() }),
        description: 'GitHub webhook',
      });

      expect(registry.has('custom.webhook.github')).toBe(true);
    });

    test('registers system events', () => {
      registry.register({
        eventType: 'system.health.check',
        schema: z.object({ status: z.string() }),
      });

      expect(registry.has('system.health.check')).toBe(true);
    });

    test('throws when registering core events', () => {
      expect(() =>
        registry.register({
          eventType: 'message.received' as `custom.${string}`,
          schema: z.object({}),
        }),
      ).toThrow('Cannot register core event type');
    });

    test('throws when registering invalid namespace', () => {
      expect(() =>
        registry.register({
          eventType: 'invalid.event' as `custom.${string}`,
          schema: z.object({}),
        }),
      ).toThrow("must start with 'custom.' or 'system.'");
    });
  });

  describe('validate', () => {
    beforeEach(() => {
      registry.register({
        eventType: 'custom.test.event',
        schema: z.object({
          name: z.string(),
          count: z.number(),
        }),
      });
    });

    test('validates payload against registered schema', () => {
      const result = registry.validate('custom.test.event', { name: 'test', count: 1 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', count: 1 });
    });

    test('fails validation for invalid payload', () => {
      const result = registry.validate('custom.test.event', { name: 123, count: 'invalid' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('allows core events without schema (compile-time types)', () => {
      const result = registry.validate('message.received', { any: 'payload' });
      expect(result.success).toBe(true);
    });

    test('allows unregistered custom events with warning', () => {
      const result = registry.validate('custom.unknown.event', { any: 'payload' });
      expect(result.success).toBe(true);
    });

    test('allows unregistered system events', () => {
      const result = registry.validate('system.internal.event', { any: 'payload' });
      expect(result.success).toBe(true);
    });

    test('fails for completely unknown event types', () => {
      const result = registry.validate('unknown.event.type', { any: 'payload' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown event type');
    });
  });

  describe('getStream', () => {
    test('returns override stream if set', () => {
      registry.register({
        eventType: 'custom.special.event',
        schema: z.object({}),
        stream: 'MESSAGE',
      });

      expect(registry.getStream('custom.special.event')).toBe('MESSAGE');
    });

    test('returns undefined for events without override', () => {
      registry.register({
        eventType: 'custom.normal.event',
        schema: z.object({}),
      });

      expect(registry.getStream('custom.normal.event')).toBeUndefined();
    });
  });

  describe('list', () => {
    test('lists all registered schemas', () => {
      registry.register({
        eventType: 'custom.event1',
        schema: z.object({}),
      });
      registry.register({
        eventType: 'system.event2',
        schema: z.object({}),
      });

      const list = registry.list();
      expect(list).toHaveLength(2);
    });

    test('listByNamespace filters by prefix', () => {
      registry.register({
        eventType: 'custom.event1',
        schema: z.object({}),
      });
      registry.register({
        eventType: 'system.event2',
        schema: z.object({}),
      });

      expect(registry.listByNamespace('custom')).toHaveLength(1);
      expect(registry.listByNamespace('system')).toHaveLength(1);
    });
  });

  describe('unregister', () => {
    test('removes registered schema', () => {
      registry.register({
        eventType: 'custom.temp.event',
        schema: z.object({}),
      });

      expect(registry.has('custom.temp.event')).toBe(true);
      registry.unregister('custom.temp.event');
      expect(registry.has('custom.temp.event')).toBe(false);
    });
  });
});

describe('createEventSchema', () => {
  test('creates schema entry with required fields', () => {
    const entry = createEventSchema('custom.test.schema', z.object({ value: z.string() }));

    expect(entry.eventType).toBe('custom.test.schema');
    expect(entry.schema).toBeDefined();
  });

  test('creates schema entry with optional fields', () => {
    const entry = createEventSchema('custom.test.schema', z.object({ value: z.string() }), {
      stream: 'MESSAGE',
      description: 'Test schema',
    });

    expect(entry.stream).toBe('MESSAGE');
    expect(entry.description).toBe('Test schema');
  });
});

describe('SystemEventSchemas', () => {
  test('deadLetter schema validates correctly', () => {
    const validPayload = {
      originalEventId: 'event-123',
      originalEventType: 'message.received',
      error: 'Processing failed',
      retryCount: 3,
      timestamp: Date.now(),
    };

    const result = SystemEventSchemas.deadLetter.schema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  test('replayStarted schema validates correctly', () => {
    const validPayload = {
      streamName: 'MESSAGE',
      startTime: Date.now() - 3600000,
      endTime: Date.now(),
    };

    const result = SystemEventSchemas.replayStarted.schema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  test('healthDegraded schema validates correctly', () => {
    const validPayload = {
      component: 'database',
      reason: 'Connection pool exhausted',
      severity: 'warning' as const,
    };

    const result = SystemEventSchemas.healthDegraded.schema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });
});
