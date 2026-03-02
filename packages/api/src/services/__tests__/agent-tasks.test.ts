/**
 * Unit tests for AgentTaskService
 *
 * Tests CRUD operations, lifecycle transitions, event publishing,
 * cursor-based pagination, and error paths using mocked DB + EventBus.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { AgentTaskService } from '../agent-tasks';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function createMockTask(overrides = {}) {
  return {
    id: 'task-1',
    agentId: 'agent-1',
    chatId: 'chat-1',
    conversationId: null,
    messageId: null,
    type: 'default',
    title: 'Test task',
    description: null,
    status: 'pending' as const,
    progress: 0,
    priority: 0,
    metadata: {},
    result: null,
    error: null,
    parentTaskId: null,
    subtaskCount: 0,
    completedSubtaskCount: 0,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createMockEventBus() {
  const calls: Array<{ type: string; payload: Record<string, unknown>; meta: Record<string, unknown> }> = [];

  const eventBus = {
    publish: mock(async (type: string, payload: Record<string, unknown>, meta: Record<string, unknown>) => {
      calls.push({ type, payload, meta });
    }),
    _calls: calls,
  };

  return eventBus as unknown as EventBus & { _calls: typeof calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentTaskService', () => {
  let service: AgentTaskService;
  let mockDb: Record<string, ReturnType<typeof mock>>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = {};
    mockEventBus = createMockEventBus();
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe('create()', () => {
    test('inserts and returns the created task', async () => {
      const task = createMockTask();
      mockDb.insert = mock(() => ({
        values: mock(() => ({
          returning: mock(() => Promise.resolve([task])),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.create({
        agentId: 'agent-1',
        chatId: 'chat-1',
        title: 'Test task',
        type: 'default',
      } as any);

      expect(result).toEqual(task);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    test('publishes agent.task.created event', async () => {
      const task = createMockTask();
      mockDb.insert = mock(() => ({
        values: mock(() => ({
          returning: mock(() => Promise.resolve([task])),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      await service.create({ agentId: 'agent-1', chatId: 'chat-1', title: 'Test task', type: 'default' } as any);

      expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
      expect(mockEventBus._calls[0]?.type).toBe('agent.task.created');
      expect(mockEventBus._calls[0]?.payload.taskId).toBe('task-1');
      expect(mockEventBus._calls[0]?.payload.agentId).toBe('agent-1');
      expect(mockEventBus._calls[0]?.payload.status).toBe('pending');
    });

    test('works without eventBus (null)', async () => {
      const task = createMockTask();
      mockDb.insert = mock(() => ({
        values: mock(() => ({
          returning: mock(() => Promise.resolve([task])),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, null);
      const result = await service.create({
        agentId: 'agent-1',
        chatId: 'chat-1',
        title: 'Test task',
        type: 'default',
      } as any);

      expect(result).toEqual(task);
      // No publish call since eventBus is null
    });
  });

  // -----------------------------------------------------------------------
  // getById
  // -----------------------------------------------------------------------

  describe('getById()', () => {
    test('returns the task when found', async () => {
      const task = createMockTask();
      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([task])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.getById('task-1');

      expect(result).toEqual(task);
    });

    test('throws NotFoundError when task does not exist', async () => {
      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);

      await expect(service.getById('missing')).rejects.toThrow('AgentTask');
    });
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------

  describe('list()', () => {
    function setupListMock(items: ReturnType<typeof createMockTask>[]) {
      mockDb.select = mock(() => ({
        from: mock(() => ({
          $dynamic: mock(() => ({
            where: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(() => Promise.resolve(items)),
              })),
            })),
            orderBy: mock(() => ({
              limit: mock(() => Promise.resolve(items)),
            })),
          })),
        })),
      }));
    }

    test('returns items with no filters', async () => {
      const tasks = [createMockTask({ id: 'task-1' }), createMockTask({ id: 'task-2' })];
      setupListMock(tasks);

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.list();

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    test('filters by agentId', async () => {
      const tasks = [createMockTask({ id: 'task-1', agentId: 'agent-1' })];
      setupListMock(tasks);

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.list({ agentId: 'agent-1' });

      expect(result.items).toHaveLength(1);
      expect(mockDb.select).toHaveBeenCalled();
    });

    test('sets hasMore=true when limit+1 rows returned', async () => {
      // Simulate 3 items returned when limit=2 (limit+1 = 3)
      const tasks = [
        createMockTask({ id: 'task-1' }),
        createMockTask({ id: 'task-2' }),
        createMockTask({ id: 'task-3' }),
      ];
      setupListMock(tasks);

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.list({ limit: 2 });

      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(2);
    });

    test('sets hasMore=false when fewer rows than limit+1', async () => {
      const tasks = [createMockTask({ id: 'task-1' })];
      setupListMock(tasks);

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.list({ limit: 10 });

      expect(result.hasMore).toBe(false);
    });

    test('returns cursor as last item id', async () => {
      const tasks = [createMockTask({ id: 'task-A' }), createMockTask({ id: 'task-B' })];
      setupListMock(tasks);

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.list();

      expect(result.cursor).toBe('task-B');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe('update()', () => {
    test('sets fields and publishes agent.task.updated', async () => {
      const updated = createMockTask({ id: 'task-1', status: 'running', progress: 50 });
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([updated])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.update('task-1', { status: 'running', progress: 50 });

      expect(result.status).toBe('running');
      expect(result.progress).toBe(50);
      expect(mockEventBus._calls[0]?.type).toBe('agent.task.updated');
      expect(mockEventBus._calls[0]?.payload.taskId).toBe('task-1');
      expect(mockEventBus._calls[0]?.payload.status).toBe('running');
    });

    test('throws NotFoundError when task does not exist', async () => {
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);

      await expect(service.update('missing', { status: 'running' })).rejects.toThrow('AgentTask');
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  describe('delete()', () => {
    test('hard-deletes the task', async () => {
      mockDb.delete = mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([{ id: 'task-1' }])),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);

      await expect(service.delete('task-1')).resolves.toBeUndefined();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    test('throws NotFoundError when task does not exist', async () => {
      mockDb.delete = mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([])),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);

      await expect(service.delete('missing')).rejects.toThrow('AgentTask');
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle transitions
  // -----------------------------------------------------------------------

  describe('startTask()', () => {
    test('delegates to update with status=running', async () => {
      const started = createMockTask({ id: 'task-1', status: 'running', startedAt: new Date() });
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([started])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.startTask('task-1');

      expect(result.status).toBe('running');
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('completeTask()', () => {
    test('sets status=completed, progress=100, publishes agent.task.completed', async () => {
      const completed = createMockTask({
        id: 'task-1',
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        result: { output: 'done' },
      });
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([completed])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.completeTask('task-1', { output: 'done' });

      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(mockEventBus._calls[0]?.type).toBe('agent.task.completed');
      expect(mockEventBus._calls[0]?.payload.taskId).toBe('task-1');
      expect(mockEventBus._calls[0]?.payload.result).toEqual({ output: 'done' });
    });
  });

  describe('failTask()', () => {
    test('sets status=failed with error, publishes agent.task.failed', async () => {
      const failed = createMockTask({
        id: 'task-1',
        status: 'failed',
        error: 'Something went wrong',
        completedAt: new Date(),
      });
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([failed])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.failTask('task-1', 'Something went wrong');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Something went wrong');
      expect(mockEventBus._calls[0]?.type).toBe('agent.task.failed');
      expect(mockEventBus._calls[0]?.payload.error).toBe('Something went wrong');
    });
  });

  describe('cancelTask()', () => {
    test('sets status=cancelled, publishes agent.task.cancelled', async () => {
      const cancelled = createMockTask({
        id: 'task-1',
        status: 'cancelled',
        completedAt: new Date(),
      });
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([cancelled])),
          })),
        })),
      }));

      service = new AgentTaskService(mockDb as unknown as Database, mockEventBus);
      const result = await service.cancelTask('task-1');

      expect(result.status).toBe('cancelled');
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(mockEventBus._calls[0]?.type).toBe('agent.task.cancelled');
      expect(mockEventBus._calls[0]?.payload.taskId).toBe('task-1');
      expect(mockEventBus._calls[0]?.payload.chatId).toBe('chat-1');
    });
  });
});
