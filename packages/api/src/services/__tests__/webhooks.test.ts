/**
 * Integration tests for WebhookService
 *
 * Tests the actual service implementation with mocked database and event bus.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CustomEventType, EventBus } from '@omni/core';
import type { Database, NewWebhookSource, WebhookSource } from '@omni/db';
import { WebhookService } from '../webhooks';

// Helper to create a mock webhook source
function createMockSource(overrides: Partial<WebhookSource> = {}): WebhookSource {
  return {
    id: 'test-id-123',
    name: 'test-webhook',
    description: 'Test webhook source',
    expectedHeaders: null,
    enabled: true,
    lastReceivedAt: null,
    totalReceived: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Create mock database with proper Drizzle-like interface
function createMockDatabase(initialSources: WebhookSource[] = []) {
  const sources = new Map<string, WebhookSource>();
  for (const source of initialSources) {
    sources.set(source.id, source);
  }

  // Track method calls for assertions
  const calls = {
    select: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: [] as unknown[],
  };

  // Helper to create chainable query builder
  function createSelectQuery(results: WebhookSource[]) {
    const filteredResults = [...results];

    const query = {
      from: mock(() => ({
        ...query,
        $dynamic: () => query,
      })),
      $dynamic: () => query,
      where: mock((_condition: unknown) => {
        // Simple filter simulation - in real tests we'd parse the condition
        return query;
      }),
      orderBy: mock(() => {
        return Promise.resolve(filteredResults);
      }),
      limit: mock((n: number) => {
        return Promise.resolve(filteredResults.slice(0, n));
      }),
    };

    return query;
  }

  const db = {
    select: mock(() => createSelectQuery(Array.from(sources.values()))),
    insert: mock((_table: unknown) => ({
      values: mock((data: NewWebhookSource) => {
        const newSource: WebhookSource = {
          id: `generated-${Date.now()}`,
          name: data.name,
          description: data.description ?? null,
          expectedHeaders: data.expectedHeaders ?? null,
          enabled: data.enabled ?? true,
          lastReceivedAt: null,
          totalReceived: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        sources.set(newSource.id, newSource);
        calls.insert.push(data);

        return {
          returning: mock(() => Promise.resolve([newSource])),
        };
      }),
    })),
    update: mock((_table: unknown) => ({
      set: mock((data: Partial<WebhookSource>) => ({
        where: mock((_condition: unknown) => {
          calls.update.push(data);
          // Find and update matching sources
          for (const [id, source] of sources) {
            const updated = { ...source, ...data, updatedAt: new Date() };
            sources.set(id, updated);
            return {
              returning: mock(() => Promise.resolve([updated])),
            };
          }
          return {
            returning: mock(() => Promise.resolve([])),
          };
        }),
      })),
    })),
    delete: mock((_table: unknown) => ({
      where: mock((condition: unknown) => {
        calls.delete.push({ condition });
        // For testing, delete the first source
        const firstId = sources.keys().next().value;
        if (firstId) {
          const deleted = sources.get(firstId);
          sources.delete(firstId);
          return {
            returning: mock(() => Promise.resolve(deleted ? [deleted] : [])),
          };
        }
        return {
          returning: mock(() => Promise.resolve([])),
        };
      }),
    })),
    // Expose internal state for testing
    _sources: sources,
    _calls: calls,
  };

  return db as unknown as Database & { _sources: Map<string, WebhookSource>; _calls: typeof calls };
}

// Create mock event bus
function createMockEventBus() {
  const publishedEvents: Array<{
    eventType: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }> = [];

  const eventBus = {
    publishGeneric: mock(
      async (
        eventType: CustomEventType,
        payload: Record<string, unknown>,
        metadata: { correlationId?: string; instanceId?: string; source?: string },
      ) => {
        publishedEvents.push({ eventType, payload, metadata });
        return {
          id: metadata.correlationId ?? 'generated-event-id',
          type: eventType,
          timestamp: Date.now(),
          metadata,
          payload,
        };
      },
    ),
    // Expose for assertions
    _publishedEvents: publishedEvents,
  };

  return eventBus as unknown as EventBus & { _publishedEvents: typeof publishedEvents };
}

describe('WebhookService', () => {
  let service: WebhookService;
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockEventBus = createMockEventBus();
    service = new WebhookService(mockDb, mockEventBus);
  });

  describe('list()', () => {
    test('returns all webhook sources', async () => {
      const sources = [createMockSource({ id: '1', name: 'github' }), createMockSource({ id: '2', name: 'stripe' })];

      mockDb = createMockDatabase(sources);
      service = new WebhookService(mockDb, mockEventBus);

      const result = await service.list();

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    test('can filter by enabled status', async () => {
      const sources = [
        createMockSource({ id: '1', name: 'active', enabled: true }),
        createMockSource({ id: '2', name: 'inactive', enabled: false }),
      ];

      mockDb = createMockDatabase(sources);
      service = new WebhookService(mockDb, mockEventBus);

      await service.list({ enabled: true });

      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('getById()', () => {
    test('returns webhook source when found', async () => {
      const source = createMockSource({ id: 'test-123', name: 'github' });
      mockDb = createMockDatabase([source]);
      service = new WebhookService(mockDb, mockEventBus);

      // Override the select to return the specific source
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      const result = await service.getById('test-123');

      expect(result).toEqual(source);
    });

    test('throws NotFoundError when source does not exist', async () => {
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      await expect(service.getById('non-existent')).rejects.toThrow('WebhookSource');
    });
  });

  describe('getByName()', () => {
    test('returns webhook source when found by name', async () => {
      const source = createMockSource({ id: 'test-123', name: 'github' });

      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      const result = await service.getByName('github');

      expect(result).toEqual(source);
    });

    test('returns null when source not found by name', async () => {
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      const result = await service.getByName('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('create()', () => {
    test('creates a new webhook source with provided data', async () => {
      const input: NewWebhookSource = {
        name: 'new-webhook',
        description: 'A new webhook source',
      };

      const result = await service.create(input);

      expect(result.name).toBe('new-webhook');
      expect(result.description).toBe('A new webhook source');
      expect(result.enabled).toBe(true);
      expect(result.totalReceived).toBe(0);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    test('creates webhook source with custom headers', async () => {
      const input: NewWebhookSource = {
        name: 'github-webhook',
        description: 'GitHub events',
        expectedHeaders: { 'x-github-event': true, 'x-github-delivery': true },
      };

      const result = await service.create(input);

      expect(result.name).toBe('github-webhook');
      expect(result.expectedHeaders).toEqual({ 'x-github-event': true, 'x-github-delivery': true });
    });
  });

  describe('update()', () => {
    test('updates webhook source fields', async () => {
      const source = createMockSource({ id: 'test-123', name: 'old-name' });
      mockDb = createMockDatabase([source]);
      service = new WebhookService(mockDb, mockEventBus);

      const result = await service.update('test-123', { name: 'new-name' });

      expect(result.name).toBe('new-name');
      expect(mockDb.update).toHaveBeenCalled();
    });

    test('throws NotFoundError when updating non-existent source', async () => {
      mockDb.update = mock(() => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.update;

      await expect(service.update('non-existent', { name: 'new-name' })).rejects.toThrow('WebhookSource');
    });
  });

  describe('delete()', () => {
    test('deletes webhook source', async () => {
      const source = createMockSource({ id: 'test-123', name: 'to-delete' });
      mockDb = createMockDatabase([source]);
      service = new WebhookService(mockDb, mockEventBus);

      await expect(service.delete('test-123')).resolves.toBeUndefined();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    test('throws NotFoundError when deleting non-existent source', async () => {
      mockDb.delete = mock(() => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      })) as unknown as typeof mockDb.delete;

      await expect(service.delete('non-existent')).rejects.toThrow('WebhookSource');
    });
  });

  describe('receive()', () => {
    test('receives webhook and publishes event', async () => {
      const source = createMockSource({ id: 'test-123', name: 'agno', enabled: true });

      // Mock getByName to return the source
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      const payload = { response: 'Hello!', userId: 'user-123' };
      const headers = { 'content-type': 'application/json' };

      const result = await service.receive('agno', payload, headers);

      expect(result.received).toBe(true);
      expect(result.source).toBe('agno');
      expect(result.eventType).toBe('custom.webhook.agno');
      expect(result.eventId).toBeTruthy();

      // Verify event was published
      expect(mockEventBus.publishGeneric).toHaveBeenCalledTimes(1);
      expect(mockEventBus._publishedEvents).toHaveLength(1);
      expect(mockEventBus._publishedEvents[0]?.eventType).toBe('custom.webhook.agno');
      expect(mockEventBus._publishedEvents[0]?.payload.source).toBe('agno');
      expect(mockEventBus._publishedEvents[0]?.payload.response).toBe('Hello!');
    });

    test('auto-creates source when it does not exist', async () => {
      // Mock getByName to return null (source doesn't exist)
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      const payload = { data: 'test' };
      const headers = {};

      const result = await service.receive('new-source', payload, headers, { autoCreate: true });

      expect(result.received).toBe(true);
      expect(result.source).toBe('new-source');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    test('throws error when source disabled', async () => {
      const source = createMockSource({ id: 'test-123', name: 'disabled-source', enabled: false });

      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      await expect(service.receive('disabled-source', {}, {})).rejects.toThrow(
        "Webhook source 'disabled-source' is disabled",
      );
    });

    test('throws error when required header is missing', async () => {
      const source = createMockSource({
        id: 'test-123',
        name: 'github',
        enabled: true,
        expectedHeaders: { 'x-github-event': true, 'x-github-delivery': true },
      });

      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      // Only provide one of the two required headers
      const headers = { 'x-github-event': 'push' };

      await expect(service.receive('github', {}, headers)).rejects.toThrow(
        'Missing required header: x-github-delivery',
      );
    });

    test('validates headers case-insensitively', async () => {
      const source = createMockSource({
        id: 'test-123',
        name: 'github',
        enabled: true,
        expectedHeaders: { 'X-GitHub-Event': true },
      });

      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      // Provide header in lowercase (as HTTP headers are case-insensitive)
      const headers = { 'x-github-event': 'push' };

      const result = await service.receive('github', { event: 'push' }, headers);

      expect(result.received).toBe(true);
    });

    test('throws NotFoundError when source not found and autoCreate is false', async () => {
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      await expect(service.receive('non-existent', {}, {}, { autoCreate: false })).rejects.toThrow('WebhookSource');
    });

    test('updates source stats on successful receive', async () => {
      const source = createMockSource({ id: 'test-123', name: 'agno', enabled: true, totalReceived: 5 });

      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      await service.receive('agno', { data: 'test' }, {});

      // Verify update was called to increment stats
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('trigger()', () => {
    test('triggers custom event and returns event ID', async () => {
      const eventType = 'custom.manual.test' as CustomEventType;
      const payload = { action: 'test', data: { foo: 'bar' } };

      const result = await service.trigger(eventType, payload);

      expect(result.published).toBe(true);
      expect(result.eventId).toBeTruthy();
      expect(mockEventBus.publishGeneric).toHaveBeenCalledTimes(1);
      expect(mockEventBus._publishedEvents[0]?.eventType).toBe('custom.manual.test');
      expect(mockEventBus._publishedEvents[0]?.payload).toEqual(payload);
    });

    test('uses provided correlation ID', async () => {
      const eventType = 'custom.test.event' as CustomEventType;
      const correlationId = 'custom-correlation-id';

      const result = await service.trigger(eventType, {}, { correlationId });

      expect(result.eventId).toBe(correlationId);
      expect(mockEventBus._publishedEvents[0]?.metadata.correlationId).toBe(correlationId);
    });

    test('passes instance ID to event metadata', async () => {
      const eventType = 'custom.instance.event' as CustomEventType;
      const instanceId = 'wa-123';

      await service.trigger(eventType, {}, { instanceId });

      expect(mockEventBus._publishedEvents[0]?.metadata.instanceId).toBe(instanceId);
    });

    test('returns published=false when eventBus is null', async () => {
      const serviceWithoutBus = new WebhookService(mockDb, null);
      const eventType = 'custom.test.event' as CustomEventType;

      const result = await serviceWithoutBus.trigger(eventType, {});

      expect(result.published).toBe(false);
      expect(result.eventId).toBeTruthy();
    });

    test('sets source metadata to manual-trigger', async () => {
      const eventType = 'custom.test.event' as CustomEventType;

      await service.trigger(eventType, {});

      expect(mockEventBus._publishedEvents[0]?.metadata.source).toBe('manual-trigger');
    });
  });
});

describe('Webhook Event Flow Integration', () => {
  let service: WebhookService;
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockEventBus = createMockEventBus();
    service = new WebhookService(mockDb, mockEventBus);
  });

  test('full webhook receive flow: source creation → event publish → stats update', async () => {
    // Initial state: no sources
    mockDb.select = mock(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    })) as unknown as typeof mockDb.select;

    // First receive: auto-create source
    const payload = { agentResponse: 'Hello from AI!', userId: 'user-456' };
    const result = await service.receive('ai-agent', payload, {}, { autoCreate: true });

    expect(result.received).toBe(true);
    expect(result.eventType).toBe('custom.webhook.ai-agent');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockEventBus._publishedEvents).toHaveLength(1);

    // Verify event structure
    const publishedEvent = mockEventBus._publishedEvents[0];
    expect(publishedEvent?.eventType).toBe('custom.webhook.ai-agent');
    expect(publishedEvent?.payload.source).toBe('ai-agent');
    expect(publishedEvent?.payload.agentResponse).toBe('Hello from AI!');
    expect(publishedEvent?.metadata.source).toBe('webhook');
  });

  test('agent integration pattern: receive AI response and prepare for automation', async () => {
    const source = createMockSource({ id: 'agno-123', name: 'agno', enabled: true });

    mockDb.select = mock(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([source]),
        }),
      }),
    })) as unknown as typeof mockDb.select;

    // Simulate Agno agent callback payload
    const agnoPayload = {
      response: 'Here is my response to your question.',
      instanceId: 'wa-main',
      replyTo: '+5511999001234@s.whatsapp.net',
      conversationId: 'conv-789',
      metadata: {
        model: 'claude-3-opus',
        tokensUsed: 150,
      },
    };

    const result = await service.receive('agno', agnoPayload, {
      'content-type': 'application/json',
      'x-agno-request-id': 'req-abc123',
    });

    expect(result.received).toBe(true);

    // Verify the event can be consumed by automations
    const event = mockEventBus._publishedEvents[0];
    expect(event?.payload.instanceId).toBe('wa-main');
    expect(event?.payload.replyTo).toBe('+5511999001234@s.whatsapp.net');
    expect(event?.payload.response).toBe('Here is my response to your question.');
  });

  test('multiple sources can receive webhooks independently', async () => {
    const githubSource = createMockSource({ id: '1', name: 'github', enabled: true });
    const stripeSource = createMockSource({ id: '2', name: 'stripe', enabled: true });

    let callCount = 0;
    mockDb.select = mock(() => ({
      from: () => ({
        where: () => ({
          limit: () => {
            callCount++;
            if (callCount === 1) return Promise.resolve([githubSource]);
            return Promise.resolve([stripeSource]);
          },
        }),
      }),
    })) as unknown as typeof mockDb.select;

    // Receive from GitHub
    await service.receive('github', { event: 'push', repo: 'omni-v2' }, { 'x-github-event': 'push' });

    // Receive from Stripe
    await service.receive('stripe', { type: 'payment.succeeded', amount: 1000 }, { 'stripe-signature': 'sig_xxx' });

    expect(mockEventBus._publishedEvents).toHaveLength(2);
    expect(mockEventBus._publishedEvents[0]?.eventType).toBe('custom.webhook.github');
    expect(mockEventBus._publishedEvents[1]?.eventType).toBe('custom.webhook.stripe');
  });
});
