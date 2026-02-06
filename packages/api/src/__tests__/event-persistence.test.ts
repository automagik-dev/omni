/**
 * Event Persistence Handler Tests
 *
 * Tests that the event persistence handler correctly writes events
 * from the event bus to the omni_events table.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { omniEvents } from '@omni/db';
import { eq, sql } from 'drizzle-orm';
import { setupEventPersistence } from '../plugins/event-persistence';
import { describeWithDb, getTestDb } from './db-helper';

// Use null for instanceId to avoid FK constraint issues in tests
// In production, events have real instance IDs

describeWithDb('Event Persistence Handler', () => {
  let db: Database;
  let mockEventBus: EventBus;
  let subscriptions: Map<string, ((event: unknown) => Promise<void>)[]>;
  let insertedEventIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();
    subscriptions = new Map();

    // Create a mock event bus that tracks subscriptions
    mockEventBus = {
      subscribe: mock(async (eventType: string, handler: (event: unknown) => Promise<void>) => {
        const handlers = subscriptions.get(eventType) || [];
        handlers.push(handler);
        subscriptions.set(eventType, handlers);
      }),
      publish: mock(async () => {}),
      publishGeneric: mock(async () => {}),
      close: mock(async () => {}),
    } as unknown as EventBus;
  });

  afterAll(async () => {
    // Clean up test events by externalId prefix
    await db.delete(omniEvents).where(sql`${omniEvents.externalId} LIKE 'ext-%'`);
  });

  beforeEach(async () => {
    // Clear subscriptions before each test
    subscriptions.clear();

    // Clean up any events from previous tests by externalId prefix
    await db.delete(omniEvents).where(sql`${omniEvents.externalId} LIKE 'ext-%'`);
    insertedEventIds = [];
  });

  // Helper to emit an event to all subscribed handlers
  async function emitEvent(eventType: string, event: unknown): Promise<void> {
    const handlers = subscriptions.get(eventType) || [];
    for (const handler of handlers) {
      await handler(event);
    }
  }

  describe('setupEventPersistence', () => {
    test('subscribes to all required event types', async () => {
      await setupEventPersistence(mockEventBus, db);

      expect(subscriptions.has('message.received')).toBe(true);
      expect(subscriptions.has('message.sent')).toBe(true);
      expect(subscriptions.has('message.delivered')).toBe(true);
      expect(subscriptions.has('message.read')).toBe(true);
      expect(subscriptions.has('message.failed')).toBe(true);
    });
  });

  describe('message.received handler', () => {
    test('persists message.received event to database', async () => {
      await setupEventPersistence(mockEventBus, db);

      const testEvent = {
        id: 'test-event-1',
        type: 'message.received',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-recv-001',
          chatId: 'chat-123',
          from: 'user-456',
          content: {
            type: 'text',
            text: 'Hello from test',
          },
          replyToId: null,
          rawPayload: { foo: 'bar' },
        },
        metadata: {
          correlationId: 'corr-001',
          instanceId: null,
          channelType: 'discord',
          personId: null,
          platformIdentityId: null,
        },
      };

      await emitEvent('message.received', testEvent);

      // Query the database to verify the event was persisted
      const [persisted] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-recv-001')).limit(1);

      expect(persisted).toBeDefined();
      expect(persisted?.channel).toBe('discord');
      expect(persisted?.instanceId).toBeNull();
      expect(persisted?.eventType).toBe('message.received');
      expect(persisted?.direction).toBe('inbound');
      expect(persisted?.contentType).toBe('text');
      expect(persisted?.textContent).toBe('Hello from test');
      expect(persisted?.chatId).toBe('chat-123');
      expect(persisted?.status).toBe('received');
      expect(persisted?.rawPayload).toEqual({ foo: 'bar' });
    });

    test('handles image content type', async () => {
      await setupEventPersistence(mockEventBus, db);

      const testEvent = {
        id: 'test-event-2',
        type: 'message.received',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-recv-002',
          chatId: 'chat-123',
          from: 'user-456',
          content: {
            type: 'image',
            mediaUrl: 'https://example.com/image.jpg',
            mimeType: 'image/jpeg',
          },
        },
        metadata: {
          correlationId: 'corr-002',
          instanceId: null,
          channelType: 'discord',
        },
      };

      await emitEvent('message.received', testEvent);

      const [persisted] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-recv-002')).limit(1);

      expect(persisted).toBeDefined();
      expect(persisted?.contentType).toBe('image');
      expect(persisted?.mediaUrl).toBe('https://example.com/image.jpg');
      expect(persisted?.mediaMimeType).toBe('image/jpeg');
    });

    test('maps unknown channel type to fallback', async () => {
      await setupEventPersistence(mockEventBus, db);

      const testEvent = {
        id: 'test-event-3',
        type: 'message.received',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-recv-003',
          chatId: 'chat-123',
          from: 'user-456',
          content: { type: 'text', text: 'test' },
        },
        metadata: {
          correlationId: 'corr-003',
          instanceId: null,
          channelType: undefined, // Missing channel type
        },
      };

      await emitEvent('message.received', testEvent);

      const [persisted] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-recv-003')).limit(1);

      expect(persisted).toBeDefined();
      // Should fallback to 'discord' as default
      expect(persisted?.channel).toBe('discord');
    });
  });

  describe('message.sent handler', () => {
    test('persists message.sent event with outbound direction', async () => {
      await setupEventPersistence(mockEventBus, db);

      const testEvent = {
        id: 'test-event-4',
        type: 'message.sent',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-sent-001',
          chatId: 'chat-123',
          to: 'user-789',
          content: {
            type: 'text',
            text: 'Outbound message',
          },
        },
        metadata: {
          correlationId: 'corr-004',
          instanceId: null,
          channelType: 'whatsapp-baileys',
        },
      };

      await emitEvent('message.sent', testEvent);

      const [persisted] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-sent-001')).limit(1);

      expect(persisted).toBeDefined();
      expect(persisted?.eventType).toBe('message.sent');
      expect(persisted?.direction).toBe('outbound');
      expect(persisted?.status).toBe('completed');
      expect(persisted?.textContent).toBe('Outbound message');
      expect(persisted?.channel).toBe('whatsapp-baileys');
    });
  });

  describe('message.delivered handler', () => {
    test('updates existing event with deliveredAt', async () => {
      await setupEventPersistence(mockEventBus, db);

      // First, create a sent event
      const [existing] = await db
        .insert(omniEvents)
        .values({
          externalId: 'ext-del-001',
          channel: 'discord',
          instanceId: null,
          eventType: 'message.sent',
          direction: 'outbound',
          chatId: 'chat-123',
          status: 'received',
          receivedAt: new Date(),
        })
        .returning();

      insertedEventIds.push(existing?.id ?? '');

      // Now emit delivered event
      const deliveredAt = Date.now();
      const testEvent = {
        id: 'test-event-5',
        type: 'message.delivered',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-del-001',
          chatId: 'chat-123',
          deliveredAt,
        },
        metadata: {
          correlationId: 'corr-005',
          instanceId: null,
          channelType: 'discord',
        },
      };

      await emitEvent('message.delivered', testEvent);

      const [updated] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-del-001')).limit(1);

      expect(updated).toBeDefined();
      expect(updated?.deliveredAt).toBeDefined();
      expect(updated?.status).toBe('completed');
    });

    test('creates new event if original not found', async () => {
      await setupEventPersistence(mockEventBus, db);

      const testEvent = {
        id: 'test-event-6',
        type: 'message.delivered',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-del-new-001',
          chatId: 'chat-123',
          deliveredAt: Date.now(),
        },
        metadata: {
          correlationId: 'corr-006',
          instanceId: null,
          channelType: 'discord',
        },
      };

      await emitEvent('message.delivered', testEvent);

      const [created] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-del-new-001')).limit(1);

      expect(created).toBeDefined();
      expect(created?.eventType).toBe('message.delivered');
    });
  });

  describe('message.read handler', () => {
    test('updates existing event with readAt', async () => {
      await setupEventPersistence(mockEventBus, db);

      // First, create an event
      const [existing] = await db
        .insert(omniEvents)
        .values({
          externalId: 'ext-read-001',
          channel: 'discord',
          instanceId: null,
          eventType: 'message.sent',
          direction: 'outbound',
          chatId: 'chat-123',
          status: 'completed',
          receivedAt: new Date(),
        })
        .returning();

      insertedEventIds.push(existing?.id ?? '');

      const readAt = Date.now();
      const testEvent = {
        id: 'test-event-7',
        type: 'message.read',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-read-001',
          chatId: 'chat-123',
          readAt,
        },
        metadata: {
          correlationId: 'corr-007',
          instanceId: null,
          channelType: 'discord',
        },
      };

      await emitEvent('message.read', testEvent);

      const [updated] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-read-001')).limit(1);

      expect(updated).toBeDefined();
      expect(updated?.readAt).toBeDefined();
    });
  });

  describe('message.failed handler', () => {
    test('persists failed event with error details', async () => {
      await setupEventPersistence(mockEventBus, db);

      const testEvent = {
        id: 'test-event-8',
        type: 'message.failed',
        timestamp: Date.now(),
        payload: {
          externalId: 'ext-fail-001',
          chatId: 'chat-123',
          error: 'Connection timeout',
          errorCode: 'TIMEOUT',
          retryable: true,
        },
        metadata: {
          correlationId: 'corr-008',
          instanceId: null,
          channelType: 'discord',
        },
      };

      await emitEvent('message.failed', testEvent);

      const [persisted] = await db.select().from(omniEvents).where(eq(omniEvents.externalId, 'ext-fail-001')).limit(1);

      expect(persisted).toBeDefined();
      expect(persisted?.eventType).toBe('message.failed');
      expect(persisted?.status).toBe('failed');
      expect(persisted?.errorMessage).toBe('Connection timeout');
      expect(persisted?.errorStage).toBe('TIMEOUT');
      expect(persisted?.metadata).toMatchObject({ retryable: true });
    });

    test('handles failed event without externalId', async () => {
      await setupEventPersistence(mockEventBus, db);

      const testEvent = {
        id: 'test-event-9',
        type: 'message.failed',
        timestamp: Date.now(),
        payload: {
          chatId: 'chat-123',
          error: 'Failed to send',
          retryable: false,
        },
        metadata: {
          correlationId: 'corr-009',
          instanceId: null,
          channelType: 'discord',
        },
      };

      await emitEvent('message.failed', testEvent);

      // Should still be persisted
      const [persisted] = await db.select().from(omniEvents).where(eq(omniEvents.chatId, 'chat-123')).limit(1);

      expect(persisted).toBeDefined();
      expect(persisted?.eventType).toBe('message.failed');
      expect(persisted?.externalId).toBeNull();
    });
  });
});
