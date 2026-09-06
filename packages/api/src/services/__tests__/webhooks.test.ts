/**
 * Integration tests for WebhookService
 *
 * Tests the actual service implementation with mocked database and event bus.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { CustomEventType, EventBus } from '@omni/core';
import type { Database, NewWebhookSource, WebhookSource } from '@omni/db';
import { WebhookService } from '../webhooks';

// Helper to create a mock webhook source
function createMockSource(overrides: Partial<WebhookSource> = {}): WebhookSource {
  return {
    id: 'test-id-123',
    tenantId: null,
    name: 'test-webhook',
    description: 'Test webhook source',
    expectedHeaders: null,
    signatureConfig: null,
    signatureSecret: null,
    idempotencyKeyTemplate: '{source}:{sha256(body)}',
    eventTypeMapping: null,
    enabled: true,
    lastReceivedAt: null,
    totalReceived: 0,
    totalDuplicates: 0,
    expectedIntervalSeconds: null,
    lastHeartbeatAt: null,
    heartbeatCount: 0,
    livenessStatus: null,
    livenessArmedAt: null,
    stalledAt: null,
    windowSemantics: null,
    mutationPolicy: null,
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

  // Journal claims by idempotency key (#958) — mirrors the unique-index
  // semantics: a second insert with the same key "conflicts" and returns [].
  const journaledKeys = new Map<string, { id: string }>();

  const db = {
    select: mock(() => createSelectQuery(Array.from(sources.values()))),
    insert: mock((_table: unknown) => ({
      values: mock((data: NewWebhookSource | { id: string; idempotencyKey: string }) => {
        // Journal claim insert (#958): mirrors the unique-index semantics —
        // a second insert with the same idempotency key conflicts → [].
        if ('idempotencyKey' in data) {
          const row = { id: data.id };
          const conflict = journaledKeys.has(data.idempotencyKey);
          if (!conflict) journaledKeys.set(data.idempotencyKey, row);
          calls.insert.push(data);
          return {
            onConflictDoNothing: mock(() => ({
              returning: mock(() => Promise.resolve(conflict ? [] : [row])),
            })),
            returning: mock(() => Promise.resolve([row])),
          };
        }

        const newSource: WebhookSource = {
          id: `generated-${Date.now()}`,
          tenantId: null,
          name: data.name,
          description: data.description ?? null,
          expectedHeaders: data.expectedHeaders ?? null,
          signatureConfig: data.signatureConfig ?? null,
          signatureSecret: data.signatureSecret ?? null,
          idempotencyKeyTemplate: data.idempotencyKeyTemplate ?? '{source}:{sha256(body)}',
          eventTypeMapping: data.eventTypeMapping ?? null,
          enabled: data.enabled ?? true,
          lastReceivedAt: null,
          totalReceived: 0,
          totalDuplicates: 0,
          expectedIntervalSeconds: data.expectedIntervalSeconds ?? null,
          lastHeartbeatAt: null,
          heartbeatCount: 0,
          livenessStatus: data.livenessStatus ?? null,
          livenessArmedAt: data.livenessArmedAt ?? null,
          stalledAt: null,
          windowSemantics: data.windowSemantics ?? null,
          mutationPolicy: data.mutationPolicy ?? null,
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
        let result: WebhookSource[] = [];
        if (firstId) {
          const deleted = sources.get(firstId);
          sources.delete(firstId);
          result = deleted ? [deleted] : [];
        }
        // Thenable AND returning()-capable: the service's delete() chains
        // .returning(), while the publish-failure claim release awaits the
        // builder directly.
        const promiseLike = Promise.resolve(result) as Promise<WebhookSource[]> & {
          returning: () => Promise<WebhookSource[]>;
        };
        promiseLike.returning = () => Promise.resolve(result);
        return promiseLike;
      }),
    })),
    // Expose internal state for testing
    _sources: sources,
    _calls: calls,
    _journaledKeys: journaledKeys,
  };

  return db as unknown as Database & {
    _sources: Map<string, WebhookSource>;
    _calls: typeof calls;
    _journaledKeys: Map<string, { id: string }>;
  };
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
        // Mirror the real bus (#956): the event id is minted per publish and
        // is NOT the correlation — a caller-supplied correlationId only rides
        // in the metadata.
        return {
          id: crypto.randomUUID(),
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

    test('does not auto-create sources by default (issue #928)', async () => {
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      await expect(service.receive('never-seen', {}, {})).rejects.toThrow('WebhookSource');
      expect(mockDb.insert).not.toHaveBeenCalled();
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

  describe('receive() ingress idempotency (#958)', () => {
    function mockSourceLookup(source: WebhookSource) {
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;
    }

    test('a redelivery (same derived key) is acked as duplicate and publishes nothing', async () => {
      const source = createMockSource({ id: 'src-1', name: 'github', enabled: true });
      mockSourceLookup(source);

      const rawBody = JSON.stringify({ action: 'push', id: 42 });
      const payload = JSON.parse(rawBody) as Record<string, unknown>;

      const first = await service.receive('github', payload, {}, { rawBody });
      const second = await service.receive('github', payload, {}, { rawBody });

      expect(first.duplicate).toBeUndefined();
      expect(second.received).toBe(true);
      expect(second.duplicate).toBe(true);
      // Exactly one event was published and one key journaled.
      expect(mockEventBus.publishGeneric).toHaveBeenCalledTimes(1);
      expect(mockDb._journaledKeys.size).toBe(1);
    });

    test('different bodies derive different keys and both publish', async () => {
      const source = createMockSource({ id: 'src-1', name: 'github', enabled: true });
      mockSourceLookup(source);

      const a = await service.receive('github', { id: 1 }, {}, { rawBody: '{"id":1}' });
      const b = await service.receive('github', { id: 2 }, {}, { rawBody: '{"id":2}' });

      expect(a.duplicate).toBeUndefined();
      expect(b.duplicate).toBeUndefined();
      expect(mockEventBus.publishGeneric).toHaveBeenCalledTimes(2);
      expect(mockDb._journaledKeys.size).toBe(2);
    });

    test('a provider-identity template dedupes on the id even when body noise differs', async () => {
      const source = createMockSource({
        id: 'src-1',
        name: 'github',
        enabled: true,
        idempotencyKeyTemplate: 'github:{headers.x-github-delivery}',
      });
      mockSourceLookup(source);

      const headers = { 'x-github-delivery': 'delivery-1' };
      const first = await service.receive('github', { try: 1 }, headers, { rawBody: '{"try":1}' });
      const second = await service.receive('github', { try: 2 }, headers, { rawBody: '{"try":2}' });

      expect(first.duplicate).toBeUndefined();
      expect(second.duplicate).toBe(true);
      expect(mockEventBus.publishGeneric).toHaveBeenCalledTimes(1);
    });

    test('a failed publish releases the claim so the retry is a first delivery', async () => {
      const source = createMockSource({ id: 'src-1', name: 'github', enabled: true });
      mockSourceLookup(source);
      mockEventBus.publishGeneric = mock(() => Promise.reject(new Error('NATS down'))) as never;

      await expect(service.receive('github', { id: 1 }, {}, { rawBody: '{"id":1}' })).rejects.toThrow('NATS down');
      // The claim was released (delete was issued) — the provider's retry
      // must not be swallowed as a duplicate of an event that never existed.
      expect(mockDb._calls.delete.length).toBe(1);
    });
  });

  describe('receive() signature verification', () => {
    const secret = 'super-secret-value';

    function mockSourceLookup(source: WebhookSource) {
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([source]),
          }),
        }),
      })) as unknown as typeof mockDb.select;
    }

    function hmacSource(overrides: Partial<WebhookSource> = {}): WebhookSource {
      return createMockSource({
        name: 'github',
        signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256', prefix: 'sha256=' },
        signatureSecret: secret,
        ...overrides,
      });
    }

    test('accepts a valid hmac-sha256 signature over the raw body', async () => {
      mockSourceLookup(hmacSource());
      const rawBody = JSON.stringify({ action: 'push' });
      const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

      const result = await service.receive(
        'github',
        { action: 'push' },
        { 'x-hub-signature-256': signature },
        { rawBody },
      );

      expect(result.received).toBe(true);
      expect(mockEventBus._publishedEvents).toHaveLength(1);
    });

    test('rejects an invalid hmac signature and publishes nothing', async () => {
      mockSourceLookup(hmacSource());
      const rawBody = JSON.stringify({ action: 'push' });

      await expect(
        service.receive('github', { action: 'push' }, { 'x-hub-signature-256': 'sha256=deadbeef' }, { rawBody }),
      ).rejects.toThrow('Invalid webhook signature');
      expect(mockEventBus._publishedEvents).toHaveLength(0);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    test('rejects when the signature header is absent, whatever other headers say', async () => {
      mockSourceLookup(hmacSource());

      await expect(service.receive('github', {}, { 'x-anything': 'value' }, { rawBody: '{}' })).rejects.toThrow(
        'Missing signature header: X-Hub-Signature-256',
      );
    });

    test('rejects hmac verification without the raw body', async () => {
      mockSourceLookup(hmacSource());
      const signature = `sha256=${createHmac('sha256', secret).update('{}').digest('hex')}`;

      await expect(service.receive('github', {}, { 'x-hub-signature-256': signature })).rejects.toThrow(
        'raw request body',
      );
    });

    test('token-match compares the header value against the secret', async () => {
      const source = createMockSource({
        name: 'telegram-like',
        signatureConfig: { algorithm: 'token-match', header: 'X-Secret-Token' },
        signatureSecret: secret,
      });
      mockSourceLookup(source);

      const ok = await service.receive('telegram-like', {}, { 'x-secret-token': secret });
      expect(ok.received).toBe(true);

      await expect(service.receive('telegram-like', {}, { 'x-secret-token': 'wrong' })).rejects.toThrow(
        'Invalid webhook signature',
      );
    });

    test('requireSignature rejects sources without a signature config', async () => {
      mockSourceLookup(createMockSource({ name: 'plain' }));

      await expect(service.receive('plain', {}, {}, { requireSignature: true })).rejects.toThrow(
        'no signature configuration',
      );
    });

    test('rejects when config exists but no secret is stored', async () => {
      mockSourceLookup(hmacSource({ signatureSecret: null }));

      await expect(
        service.receive('github', {}, { 'x-hub-signature-256': 'sha256=abc' }, { rawBody: '{}' }),
      ).rejects.toThrow('verification unavailable');
    });
  });

  describe('signature secret invariants', () => {
    test('create() rejects a signatureConfig without a secret', async () => {
      await expect(
        service.create({
          name: 'github',
          signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256' },
        }),
      ).rejects.toThrow('signatureSecret is required');
    });

    test('create() rejects a secret without a signatureConfig', async () => {
      await expect(service.create({ name: 'github', signatureSecret: 'orphan-secret' })).rejects.toThrow(
        'signatureSecret cannot be set without a signatureConfig',
      );
    });

    test('update() clearing the config also clears the stored secret', async () => {
      const source = createMockSource({ id: 'test-123', signatureSecret: 'stored' });
      mockDb = createMockDatabase([source]);
      service = new WebhookService(mockDb, mockEventBus);

      await service.update('test-123', { signatureConfig: null });

      expect(mockDb._calls.update[0]).toMatchObject({ signatureConfig: null, signatureSecret: null });
    });

    test('update() rejects nulling the secret while the config stays set', async () => {
      const source = createMockSource({
        id: 'test-123',
        signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256' },
        signatureSecret: 'stored',
      });
      mockDb = createMockDatabase([source]);
      service = new WebhookService(mockDb, mockEventBus);

      await expect(service.update('test-123', { signatureSecret: null })).rejects.toThrow(
        'signatureSecret is required when signatureConfig is set',
      );
      expect(mockDb._calls.update).toHaveLength(0);
    });

    test('update() rejects a new secret alongside clearing the config', async () => {
      const source = createMockSource({
        id: 'test-123',
        signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256' },
        signatureSecret: 'stored',
      });
      mockDb = createMockDatabase([source]);
      service = new WebhookService(mockDb, mockEventBus);

      await expect(service.update('test-123', { signatureConfig: null, signatureSecret: 'fresh-one' })).rejects.toThrow(
        'signatureSecret cannot be set without a signatureConfig',
      );
      expect(mockDb._calls.update).toHaveLength(0);
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

      // #956: the returned id is the PUBLISHED event's id; the supplied
      // correlation rides in the metadata instead of doubling as the id.
      expect(result.eventId).toBeTruthy();
      expect(result.eventId).not.toBe(correlationId);
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

describe('Connector lifecycle contract (#961)', () => {
  describe('heartbeat()', () => {
    test('records the heartbeat without publishing any event', async () => {
      const source = createMockSource({
        id: 'hb-1',
        name: 'gmail-purchases',
        expectedIntervalSeconds: 900,
        livenessStatus: 'healthy',
      });
      const mockDb = createMockDatabase([source]);
      const mockEventBus = createMockEventBus();
      const service = new WebhookService(mockDb, mockEventBus);

      const result = await service.heartbeat('gmail-purchases');

      expect(result.ok).toBe(true);
      expect(result.source).toBe('gmail-purchases');
      expect(result.livenessStatus).toBe('healthy');
      expect(result.expectedIntervalSeconds).toBe(900);
      // Compacted representation: a timestamped counter update, zero journal events.
      expect(mockEventBus._publishedEvents).toHaveLength(0);
      const update = mockDb._calls.update[0] as { lastHeartbeatAt?: Date } | undefined;
      expect(update?.lastHeartbeatAt).toBeInstanceOf(Date);
    });

    test('throws NotFoundError for an unknown source', async () => {
      const service = new WebhookService(createMockDatabase(), createMockEventBus());
      await expect(service.heartbeat('nope')).rejects.toThrow('WebhookSource');
    });

    test('rejects a disabled source', async () => {
      const source = createMockSource({ id: 'hb-2', name: 'off', enabled: false });
      const service = new WebhookService(createMockDatabase([source]), createMockEventBus());
      await expect(service.heartbeat('off')).rejects.toThrow('disabled');
    });
  });

  describe('liveness arming on create()/update()', () => {
    test('create with a declared cadence arms supervision', async () => {
      const service = new WebhookService(createMockDatabase(), createMockEventBus());

      const created = await service.create({ name: 'calendar', expectedIntervalSeconds: 300 });

      expect(created.livenessStatus).toBe('healthy');
      expect(created.livenessArmedAt).toBeInstanceOf(Date);
    });

    test('create without a cadence stays unsupervised', async () => {
      const service = new WebhookService(createMockDatabase(), createMockEventBus());
      const created = await service.create({ name: 'plain' });
      expect(created.livenessStatus).toBeNull();
      expect(created.livenessArmedAt).toBeNull();
    });

    test('update declaring a cadence re-anchors the window and sets healthy when unsupervised', async () => {
      const source = createMockSource({ id: 'arm-1', name: 'src' });
      const mockDb = createMockDatabase([source]);
      const service = new WebhookService(mockDb, createMockEventBus());

      const updated = await service.update('arm-1', { expectedIntervalSeconds: 120 });

      expect(updated.expectedIntervalSeconds).toBe(120);
      expect(updated.livenessStatus).toBe('healthy');
      expect(updated.livenessArmedAt).toBeInstanceOf(Date);
    });

    test('re-arming a stalled source keeps stalled — recovery stays sweeper-owned', async () => {
      const source = createMockSource({
        id: 'arm-2',
        name: 'src',
        expectedIntervalSeconds: 60,
        livenessStatus: 'stalled',
        stalledAt: new Date(),
      });
      const service = new WebhookService(createMockDatabase([source]), createMockEventBus());

      const updated = await service.update('arm-2', { expectedIntervalSeconds: 600 });

      expect(updated.livenessStatus).toBe('stalled');
      expect(updated.livenessArmedAt).toBeInstanceOf(Date);
    });

    test('update with null disarms supervision entirely', async () => {
      const source = createMockSource({
        id: 'arm-3',
        name: 'src',
        expectedIntervalSeconds: 60,
        livenessStatus: 'stalled',
        livenessArmedAt: new Date(),
        stalledAt: new Date(),
      });
      const service = new WebhookService(createMockDatabase([source]), createMockEventBus());

      const updated = await service.update('arm-3', { expectedIntervalSeconds: null });

      expect(updated.expectedIntervalSeconds).toBeNull();
      expect(updated.livenessStatus).toBeNull();
      expect(updated.livenessArmedAt).toBeNull();
      expect(updated.stalledAt).toBeNull();
    });
  });
});
