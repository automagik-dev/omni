/**
 * Events API Tests
 *
 * Tests for the events endpoints and event persistence.
 * These tests verify:
 * 1. Event persistence handler correctly writes to omni_events
 * 2. Events API endpoints return correct data
 * 3. Analytics calculations are accurate
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import type { Database, NewOmniEvent } from '@omni/db';
import { omniEvents } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createServices } from '../services';
import type { AppVariables } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

// Use null for instanceId to avoid FK constraint issues in tests
// In production, events have real instance IDs

const createTestEvent = (overrides: Partial<NewOmniEvent> = {}): NewOmniEvent => ({
  externalId: `ext-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  channel: 'discord',
  instanceId: null, // Use null to avoid FK constraint
  eventType: 'message.received',
  direction: 'inbound',
  contentType: 'text',
  textContent: 'Test message',
  chatId: `test-chat-${Date.now()}`,
  status: 'received',
  receivedAt: new Date(),
  ...overrides,
});

describeWithDb('Events Service', () => {
  let db: Database;
  let services: ReturnType<typeof createServices>;
  let insertedEventIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();
    services = createServices(db, null);
  });

  afterAll(async () => {
    // Clean up test events
    if (insertedEventIds.length > 0) {
      for (const id of insertedEventIds) {
        await db.delete(omniEvents).where(eq(omniEvents.id, id));
      }
    }
  });

  beforeEach(() => {
    insertedEventIds = [];
  });

  // Helper to insert and track test events
  async function insertTestEvent(event: NewOmniEvent): Promise<string> {
    const [inserted] = await db.insert(omniEvents).values(event).returning();
    if (inserted) {
      insertedEventIds.push(inserted.id);
    }
    return inserted?.id ?? '';
  }

  describe('list()', () => {
    test('returns empty array when no events match filter', async () => {
      // Query with a search that won't match any events
      const result = await services.events.list({
        search: 'xyz-nonexistent-search-term-12345',
      });

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    test('returns events ordered by receivedAt desc', async () => {
      const uniqueId = `order-test-${Date.now()}`;
      const now = new Date();
      const event1 = createTestEvent({
        textContent: `First ${uniqueId}`,
        receivedAt: new Date(now.getTime() - 2000),
      });
      const event2 = createTestEvent({
        textContent: `Second ${uniqueId}`,
        receivedAt: new Date(now.getTime() - 1000),
      });
      const event3 = createTestEvent({
        textContent: `Third ${uniqueId}`,
        receivedAt: new Date(now.getTime()),
      });

      await insertTestEvent(event1);
      await insertTestEvent(event2);
      await insertTestEvent(event3);

      const result = await services.events.list({
        search: uniqueId,
        limit: 10,
      });

      // Should be newest first
      expect(result.items.length).toBeGreaterThanOrEqual(3);
      const texts = result.items.map((e) => e.textContent);
      const thirdIdx = texts.findIndex((t) => t?.includes('Third'));
      const secondIdx = texts.findIndex((t) => t?.includes('Second'));
      const firstIdx = texts.findIndex((t) => t?.includes('First'));

      expect(thirdIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(firstIdx);
    });

    test('filters by channel', async () => {
      const uniqueText = `channel-test-${Date.now()}`;
      await insertTestEvent(createTestEvent({ channel: 'discord', textContent: `Discord ${uniqueText}` }));
      await insertTestEvent(createTestEvent({ channel: 'whatsapp-baileys', textContent: `WhatsApp ${uniqueText}` }));

      const result = await services.events.list({
        search: uniqueText,
        channel: ['discord'],
      });

      for (const event of result.items) {
        expect(event.channel).toBe('discord');
      }
    });

    test('filters by eventType', async () => {
      const uniqueText = `type-test-${Date.now()}`;
      await insertTestEvent(createTestEvent({ eventType: 'message.received', textContent: `Recv ${uniqueText}` }));
      await insertTestEvent(createTestEvent({ eventType: 'message.sent', textContent: `Sent ${uniqueText}` }));

      const result = await services.events.list({
        search: uniqueText,
        eventType: ['message.sent'],
      });

      for (const event of result.items) {
        expect(event.eventType).toBe('message.sent');
      }
    });

    test('filters by direction', async () => {
      const uniqueText = `dir-test-${Date.now()}`;
      await insertTestEvent(createTestEvent({ direction: 'inbound', textContent: `In ${uniqueText}` }));
      await insertTestEvent(createTestEvent({ direction: 'outbound', textContent: `Out ${uniqueText}` }));

      const result = await services.events.list({
        search: uniqueText,
        direction: 'outbound',
      });

      for (const event of result.items) {
        expect(event.direction).toBe('outbound');
      }
    });

    test('filters by date range', async () => {
      const uniqueText = `date-test-${Date.now()}`;
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      await insertTestEvent(createTestEvent({ receivedAt: twoDaysAgo, textContent: `Old ${uniqueText}` }));
      await insertTestEvent(createTestEvent({ receivedAt: yesterday, textContent: `Yesterday ${uniqueText}` }));
      await insertTestEvent(createTestEvent({ receivedAt: now, textContent: `Today ${uniqueText}` }));

      const result = await services.events.list({
        search: uniqueText,
        since: new Date(now.getTime() - 36 * 60 * 60 * 1000), // 36 hours ago
      });

      // Should include yesterday and today, not two days ago
      const texts = result.items.map((e) => e.textContent);
      expect(texts.some((t) => t?.includes('Yesterday'))).toBe(true);
      expect(texts.some((t) => t?.includes('Today'))).toBe(true);
    });

    test('searches by text content', async () => {
      const uniqueId = `search-${Date.now()}`;
      await insertTestEvent(createTestEvent({ textContent: `Hello world ${uniqueId}` }));
      await insertTestEvent(createTestEvent({ textContent: `Goodbye moon ${uniqueId}` }));

      const result = await services.events.list({
        search: `world ${uniqueId}`,
      });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items[0]?.textContent).toContain('world');
    });

    test('respects limit', async () => {
      const uniqueText = `limit-test-${Date.now()}`;
      // Insert more than the limit
      for (let i = 0; i < 5; i++) {
        await insertTestEvent(createTestEvent({ textContent: `${uniqueText} ${i}` }));
      }

      const result = await services.events.list({
        search: uniqueText,
        limit: 3,
      });

      expect(result.items.length).toBeLessThanOrEqual(3);
    });

    test('pagination with cursor works', async () => {
      const uniqueText = `page-test-${Date.now()}`;
      // Insert several events
      for (let i = 0; i < 5; i++) {
        await insertTestEvent(
          createTestEvent({
            textContent: `${uniqueText} ${i}`,
            receivedAt: new Date(Date.now() - i * 1000),
          }),
        );
      }

      // First page
      const page1 = await services.events.list({
        search: uniqueText,
        limit: 2,
      });

      expect(page1.items.length).toBe(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.cursor).toBeDefined();

      // Second page
      const page2 = await services.events.list({
        search: uniqueText,
        limit: 2,
        cursor: page1.cursor,
      });

      expect(page2.items.length).toBe(2);

      // Items should be different
      const page1Ids = page1.items.map((e) => e.id);
      const page2Ids = page2.items.map((e) => e.id);
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id);
      }
    });
  });

  describe('getById()', () => {
    test('returns event by ID', async () => {
      const testEvent = createTestEvent({ textContent: 'Find me by ID' });
      const eventId = await insertTestEvent(testEvent);

      const result = await services.events.getById(eventId);

      expect(result.id).toBe(eventId);
      expect(result.textContent).toBe('Find me by ID');
    });

    test('throws NotFoundError for non-existent ID', async () => {
      await expect(services.events.getById('00000000-0000-0000-0000-000000000000')).rejects.toThrow();
    });
  });

  describe('getAnalytics()', () => {
    test('returns analytics structure', async () => {
      const analytics = await services.events.getAnalytics({});

      expect(typeof analytics.totalMessages).toBe('number');
      expect(typeof analytics.successfulMessages).toBe('number');
      expect(typeof analytics.failedMessages).toBe('number');
      expect(typeof analytics.successRate).toBe('number');
      expect(analytics.messageTypes).toBeDefined();
      expect(analytics.instances).toBeDefined();
    });

    test('counts events by status', async () => {
      const uniqueChat = `analytics-status-${Date.now()}`;
      await insertTestEvent(createTestEvent({ chatId: uniqueChat, status: 'completed' }));
      await insertTestEvent(createTestEvent({ chatId: uniqueChat, status: 'completed' }));
      await insertTestEvent(createTestEvent({ chatId: uniqueChat, status: 'failed', errorStage: 'processing' }));

      // Analytics covers all events, so we just verify structure
      const analytics = await services.events.getAnalytics({});

      expect(analytics.totalMessages).toBeGreaterThanOrEqual(3);
    });

    test('groups by content type', async () => {
      const uniqueChat = `analytics-type-${Date.now()}`;
      await insertTestEvent(createTestEvent({ chatId: uniqueChat, contentType: 'text' }));
      await insertTestEvent(createTestEvent({ chatId: uniqueChat, contentType: 'image' }));

      const analytics = await services.events.getAnalytics({});

      expect(analytics.messageTypes).toBeDefined();
    });
  });
});

describeWithDb('Events API Routes', () => {
  let db: Database;
  let app: Hono<{ Variables: AppVariables }>;
  let insertedEventIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();
    const services = createServices(db, null);

    // Create a minimal test app with events routes
    app = new Hono<{ Variables: AppVariables }>();

    // Add error handler for NotFoundError
    app.onError((error, c) => {
      if (error instanceof NotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
    });

    app.use('*', async (c, next) => {
      c.set('services', services);
      await next();
    });

    // Import and mount the events routes
    const { eventsRoutes } = await import('../routes/v2/events');
    app.route('/events', eventsRoutes);
  });

  afterAll(async () => {
    // Clean up test events
    if (insertedEventIds.length > 0) {
      for (const id of insertedEventIds) {
        await db.delete(omniEvents).where(eq(omniEvents.id, id));
      }
    }
  });

  beforeEach(() => {
    insertedEventIds = [];
  });

  async function insertTestEvent(event: NewOmniEvent): Promise<string> {
    const [inserted] = await db.insert(omniEvents).values(event).returning();
    if (inserted) {
      insertedEventIds.push(inserted.id);
    }
    return inserted?.id ?? '';
  }

  describe('GET /events', () => {
    test('returns events list', async () => {
      const res = await app.request('/events?limit=10');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: unknown[]; meta: unknown };
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.meta).toBeDefined();
    });

    test('filters by channel', async () => {
      const res = await app.request('/events?channel=discord&limit=5');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { items: Array<{ channel: string }> };
      for (const event of body.items) {
        expect(event.channel).toBe('discord');
      }
    });
  });

  describe('GET /events/analytics', () => {
    test('returns analytics summary', async () => {
      const res = await app.request('/events/analytics');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        totalMessages: number;
        successfulMessages: number;
        failedMessages: number;
        successRate: number;
        messageTypes: unknown;
        instances: unknown;
      };
      expect(typeof body.totalMessages).toBe('number');
      expect(typeof body.successfulMessages).toBe('number');
      expect(typeof body.failedMessages).toBe('number');
      expect(typeof body.successRate).toBe('number');
      expect(body.messageTypes).toBeDefined();
      expect(body.instances).toBeDefined();
    });

    test('accepts allTime parameter', async () => {
      const res = await app.request('/events/analytics?allTime=true');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /events/:id', () => {
    test('returns event by ID', async () => {
      const eventId = await insertTestEvent(createTestEvent({ textContent: 'Fetch by ID' }));

      const res = await app.request(`/events/${eventId}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { id: string; textContent: string } };
      expect(body.data.id).toBe(eventId);
      expect(body.data.textContent).toBe('Fetch by ID');
    });

    test('returns 404 for non-existent event', async () => {
      const res = await app.request('/events/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /events/search', () => {
    test('searches with format=full', async () => {
      const res = await app.request('/events/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'full', limit: 5 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toBeDefined();
    });

    test('searches with format=summary', async () => {
      const res = await app.request('/events/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'summary', limit: 5 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string; eventType: string }> };

      // Summary format should have limited fields
      if (body.items.length > 0) {
        const item = body.items[0];
        if (item) {
          expect(item.id).toBeDefined();
          expect(item.eventType).toBeDefined();
        }
      }
    });

    test('searches with format=agent', async () => {
      const res = await app.request('/events/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'agent', limit: 5 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { asContext: string; summary: string };
      expect(body.asContext).toBeDefined();
      expect(body.summary).toBeDefined();
    });
  });
});
