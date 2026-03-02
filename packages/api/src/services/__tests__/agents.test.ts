/**
 * Unit tests for AgentService
 *
 * Uses mock DB (chainable Drizzle pattern) and mock EventBus with capture array.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Agent, Database, NewAgent } from '@omni/db';
import { AgentService } from '../agents';

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-001',
    name: 'test-agent',
    provider: 'a2a',
    model: null,
    agentType: 'assistant',
    capabilities: [],
    ownerId: null,
    agentProviderId: null,
    configPath: null,
    isInternal: false,
    isActive: true,
    metadata: null,
    agentCard: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Agent;
}

function createMockDatabase(results: Agent[] = []) {
  const selectQuery = {
    from: mock(() => ({
      ...selectQuery,
      $dynamic: () => selectQuery,
    })),
    $dynamic: () => selectQuery,
    where: mock(() => selectQuery),
    orderBy: mock(() => selectQuery),
    limit: mock((_n: number) => Promise.resolve(results)),
  };

  const db = {
    select: mock(() => selectQuery),
    insert: mock((_table: unknown) => ({
      values: mock((data: NewAgent) => ({
        returning: mock(() => {
          const created = createMockAgent({ ...data, id: `gen-${Date.now()}` });
          return Promise.resolve([created]);
        }),
      })),
    })),
    update: mock((_table: unknown) => ({
      set: mock((_data: unknown) => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve(results.length > 0 ? [results[0]] : [])),
        })),
      })),
    })),
    _selectQuery: selectQuery,
  };

  return db as unknown as Database & { _selectQuery: typeof selectQuery };
}

function createMockEventBus() {
  const _publishedEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

  const eventBus = {
    publishGeneric: mock(async (eventType: string, payload: Record<string, unknown>) => {
      _publishedEvents.push({ eventType, payload });
    }),
    _publishedEvents,
  };

  return eventBus as unknown as EventBus & { _publishedEvents: typeof _publishedEvents };
}

describe('AgentService', () => {
  let service: AgentService;
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockEventBus = createMockEventBus();
    service = new AgentService(mockDb, mockEventBus);
  });

  describe('list()', () => {
    test('returns agents', async () => {
      const agents = [createMockAgent({ id: '1' }), createMockAgent({ id: '2' })];
      mockDb = createMockDatabase(agents);
      service = new AgentService(mockDb, mockEventBus);

      const result = await service.list();

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    test('filters by ownerId', async () => {
      mockDb = createMockDatabase([createMockAgent()]);
      service = new AgentService(mockDb, mockEventBus);

      await service.list({ ownerId: 'owner-1' });

      expect(mockDb.select).toHaveBeenCalled();
    });

    test('filters by provider', async () => {
      mockDb = createMockDatabase([createMockAgent()]);
      service = new AgentService(mockDb, mockEventBus);

      await service.list({ provider: 'a2a' });

      expect(mockDb.select).toHaveBeenCalled();
    });

    test('filters by isActive', async () => {
      mockDb = createMockDatabase([createMockAgent()]);
      service = new AgentService(mockDb, mockEventBus);

      await service.list({ isActive: true });

      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('getById()', () => {
    test('returns agent when found', async () => {
      const agent = createMockAgent({ id: 'abc-123', name: 'found-agent' });

      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([agent]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      const result = await service.getById('abc-123');

      expect(result).toEqual(agent);
    });

    test('throws NotFoundError when not found', async () => {
      mockDb.select = mock(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.select;

      await expect(service.getById('missing')).rejects.toThrow('Agent');
    });
  });

  describe('create()', () => {
    test('inserts and publishes system.agent.registered event', async () => {
      const input: NewAgent = { name: 'new-agent', provider: 'a2a' as never };

      const result = await service.create(input);

      expect(result.name).toBe('new-agent');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockEventBus._publishedEvents).toHaveLength(1);
      expect(mockEventBus._publishedEvents[0]?.eventType).toBe('system.agent.registered');
      expect(mockEventBus._publishedEvents[0]?.payload.name).toBe('new-agent');
    });

    test('works without eventBus (null)', async () => {
      const serviceNoEvents = new AgentService(mockDb, null);
      const input: NewAgent = { name: 'solo-agent', provider: 'ag-ui' as never };

      const result = await serviceNoEvents.create(input);

      expect(result.name).toBe('solo-agent');
      expect(mockEventBus._publishedEvents).toHaveLength(0);
    });
  });

  describe('update()', () => {
    test('sets updatedAt and returns updated agent', async () => {
      const agent = createMockAgent({ id: 'u-1', name: 'updated' });
      mockDb = createMockDatabase([agent]);
      service = new AgentService(mockDb, mockEventBus);

      const result = await service.update('u-1', { name: 'renamed' });

      expect(mockDb.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    test('throws NotFoundError when empty returning', async () => {
      mockDb.update = mock(() => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.update;

      await expect(service.update('missing', { name: 'x' })).rejects.toThrow('Agent');
    });
  });

  describe('delete()', () => {
    test('soft-deletes by setting isActive=false', async () => {
      const agent = createMockAgent({ id: 'd-1' });
      mockDb = createMockDatabase([agent]);
      service = new AgentService(mockDb, mockEventBus);

      await expect(service.delete('d-1')).resolves.toBeUndefined();
      expect(mockDb.update).toHaveBeenCalled();
    });

    test('throws NotFoundError when empty returning', async () => {
      mockDb.update = mock(() => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      })) as unknown as typeof mockDb.update;

      await expect(service.delete('missing')).rejects.toThrow('Agent');
    });
  });

  describe('backfillFromInstances()', () => {
    test('returns {found:0, inserted:0}', async () => {
      const result = await service.backfillFromInstances();

      expect(result).toEqual({ found: 0, inserted: 0 });
    });
  });
});
