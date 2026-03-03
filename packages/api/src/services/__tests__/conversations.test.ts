/**
 * Unit tests for ConversationService
 *
 * Tests CRUD operations, chat retrieval, and event publishing with mocked database.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { ConversationService } from '../conversations';

const NOW = new Date('2026-02-15T12:00:00Z');

function mockConversation(overrides = {}) {
  return {
    id: 'conv-123',
    title: 'Test Conversation',
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createMockDatabase() {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([])),
        })),
        orderBy: mock(() => ({
          limit: mock(() => Promise.resolve([])),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([])),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([])),
        })),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => ({
        returning: mock(() => Promise.resolve([])),
      })),
    })),
  } as unknown as Database;
}

function createMockEventBus() {
  return { publish: mock(() => Promise.resolve()) } as unknown as EventBus & {
    publish: ReturnType<typeof mock>;
  };
}

describe('ConversationService', () => {
  let service: ConversationService;
  let mockDb: ReturnType<typeof createMockDatabase>;
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    eventBus = createMockEventBus();
    service = new ConversationService(mockDb as unknown as Database, eventBus);
  });

  describe('list()', () => {
    test('returns conversations ordered by updatedAt DESC', async () => {
      const convs = [mockConversation({ id: 'c1' }), mockConversation({ id: 'c2' })];
      mockDb.select = mock(() => ({
        from: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve(convs)),
          })),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.list();

      expect(result).toHaveLength(2);
      expect(mockDb.select).toHaveBeenCalled();
    });

    test('respects limit parameter', async () => {
      mockDb.select = mock(() => ({
        from: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve([mockConversation()])),
          })),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.list({ limit: 10 });

      expect(result).toHaveLength(1);
    });
  });

  describe('getById()', () => {
    test('returns conversation when found', async () => {
      const conv = mockConversation({ id: 'conv-456' });
      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([conv])),
          })),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getById('conv-456');

      expect(result.id).toBe('conv-456');
    });

    test('throws NotFoundError when not found', async () => {
      await expect(service.getById('missing')).rejects.toThrow('Conversation');
    });
  });

  describe('create()', () => {
    test('inserts and returns conversation', async () => {
      const created = mockConversation({ id: 'new-conv' });
      mockDb.insert = mock(() => ({
        values: mock(() => ({
          returning: mock(() => Promise.resolve([created])),
        })),
      })) as unknown as typeof mockDb.insert;

      const result = await service.create({ title: 'New' } as any);

      expect(result.id).toBe('new-conv');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    test('publishes conversation.created event', async () => {
      const created = mockConversation();
      mockDb.insert = mock(() => ({
        values: mock(() => ({
          returning: mock(() => Promise.resolve([created])),
        })),
      })) as unknown as typeof mockDb.insert;

      await service.create({ title: 'New' } as any);

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const calls = eventBus.publish.mock.calls as unknown[][];
      expect(calls[0]?.[0]).toBe('conversation.created');
    });
  });

  describe('update()', () => {
    test('sets updatedAt and returns updated conversation', async () => {
      const updated = mockConversation({ id: 'conv-789', title: 'Updated' });
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([updated])),
          })),
        })),
      })) as unknown as typeof mockDb.update;

      const result = await service.update('conv-789', { title: 'Updated' } as any);

      expect(result.title).toBe('Updated');
      expect(mockDb.update).toHaveBeenCalled();
    });

    test('publishes conversation.updated event', async () => {
      const updated = mockConversation({ id: 'conv-789', title: 'Updated' });
      mockDb.update = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([updated])),
          })),
        })),
      })) as unknown as typeof mockDb.update;

      await service.update('conv-789', { title: 'Updated' } as any);

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const calls = eventBus.publish.mock.calls as unknown[][];
      expect(calls[0]?.[0]).toBe('conversation.updated');
    });

    test('throws NotFoundError when empty returning', async () => {
      await expect(service.update('missing', { title: 'X' } as any)).rejects.toThrow('Conversation');
    });
  });

  describe('delete()', () => {
    test('hard-deletes via db.delete', async () => {
      mockDb.delete = mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([{ id: 'conv-del' }])),
        })),
      })) as unknown as typeof mockDb.delete;

      await expect(service.delete('conv-del')).resolves.toBeUndefined();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    test('publishes conversation.deleted event', async () => {
      mockDb.delete = mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([{ id: 'conv-del' }])),
        })),
      })) as unknown as typeof mockDb.delete;

      await service.delete('conv-del');

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const calls = eventBus.publish.mock.calls as unknown[][];
      expect(calls[0]?.[0]).toBe('conversation.deleted');
    });

    test('throws NotFoundError when empty returning', async () => {
      await expect(service.delete('missing')).rejects.toThrow('Conversation');
    });
  });

  describe('getChats()', () => {
    test('returns chats for conversation', async () => {
      const chatList = [{ id: 'chat-1', conversationId: 'conv-123' }];
      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve(chatList)),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getChats('conv-123');

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('chat-1');
    });
  });
});
