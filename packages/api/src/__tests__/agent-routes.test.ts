/**
 * Tests for agent routing endpoints:
 * - POST /instances/:instanceId/routes - Create route
 * - GET /instances/:instanceId/routes - List routes
 * - GET /instances/:instanceId/routes/:id - Get route
 * - PATCH /instances/:instanceId/routes/:id - Update route
 * - DELETE /instances/:instanceId/routes/:id - Delete route
 * - GET /routes/metrics - Cache metrics
 *
 * @see agent-routing wish
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import type { AgentProvider, AgentRoute, Database, Instance } from '@omni/db';
import { agentProviders, agentRoutes, chats, instances, persons } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { routesRoutes } from '../routes/v2/agent-routes';
import { type Services, createServices } from '../services';
import type { AppVariables } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Agent Routes Endpoints', () => {
  let db: Database;
  let testInstance: Instance;
  let testProvider: AgentProvider;
  let testChat: { id: string };
  let testChat2: { id: string };
  let testChat3: { id: string };
  let testPerson: { id: string };
  const insertedIds: {
    instances: string[];
    providers: string[];
    routes: string[];
    chats: string[];
    persons: string[];
  } = {
    instances: [],
    providers: [],
    routes: [],
    chats: [],
    persons: [],
  };

  beforeAll(async () => {
    db = getTestDb();

    // Create test instance
    const [instance] = await db
      .insert(instances)
      .values({
        name: `test-routes-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!instance) throw new Error('Failed to create test instance');
    testInstance = instance;
    insertedIds.instances.push(instance.id);

    // Create test provider
    const [provider] = await db
      .insert(agentProviders)
      .values({
        name: `test-provider-${Date.now()}`,
        schema: 'agno' as const,
        baseUrl: 'http://localhost:8080',
      })
      .returning();
    if (!provider) throw new Error('Failed to create test provider');
    testProvider = provider;
    insertedIds.providers.push(provider.id);

    // Create test chat 1
    const [chat] = await db
      .insert(chats)
      .values({
        instanceId: testInstance.id,
        externalId: `test-chat-${Date.now()}`,
        chatType: 'group',
        channel: 'whatsapp-baileys',
        name: 'Test Chat',
      })
      .returning();
    if (!chat) throw new Error('Failed to create test chat');
    testChat = chat;
    insertedIds.chats.push(chat.id);

    // Create test chat 2 (for cache test)
    const [chat2] = await db
      .insert(chats)
      .values({
        instanceId: testInstance.id,
        externalId: `test-chat-2-${Date.now()}`,
        chatType: 'group',
        channel: 'whatsapp-baileys',
        name: 'Test Chat 2',
      })
      .returning();
    if (!chat2) throw new Error('Failed to create test chat 2');
    testChat2 = chat2;
    insertedIds.chats.push(chat2.id);

    // Create test chat 3 (for unique constraint test)
    const [chat3] = await db
      .insert(chats)
      .values({
        instanceId: testInstance.id,
        externalId: `test-chat-3-${Date.now()}`,
        chatType: 'group',
        channel: 'whatsapp-baileys',
        name: 'Test Chat 3',
      })
      .returning();
    if (!chat3) throw new Error('Failed to create test chat 3');
    testChat3 = chat3;
    insertedIds.chats.push(chat3.id);

    // Create test person
    const [person] = await db
      .insert(persons)
      .values({
        displayName: 'Test Person',
      })
      .returning();
    if (!person) throw new Error('Failed to create test person');
    testPerson = person;
    insertedIds.persons.push(person.id);
  });

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Cleanup logic requires sequential steps
  afterAll(async () => {
    // Cleanup in reverse order (routes -> chats/persons -> providers -> instances)
    if (insertedIds.routes.length > 0) {
      await db.delete(agentRoutes).where(eq(agentRoutes.instanceId, testInstance.id));
    }
    if (insertedIds.chats.length > 0) {
      await db.delete(chats).where(eq(chats.instanceId, testInstance.id));
    }
    if (insertedIds.persons.length > 0) {
      for (const id of insertedIds.persons) {
        await db.delete(persons).where(eq(persons.id, id));
      }
    }
    if (insertedIds.providers.length > 0) {
      for (const id of insertedIds.providers) {
        await db.delete(agentProviders).where(eq(agentProviders.id, id));
      }
    }
    if (insertedIds.instances.length > 0) {
      for (const id of insertedIds.instances) {
        await db.delete(instances).where(eq(instances.id, id));
      }
    }
  });

  function createApp(existingServices?: Services) {
    const app = new Hono<{ Variables: AppVariables }>();
    const services = existingServices ?? createServices(db, null);

    app.use('*', async (c, next) => {
      c.set('services', services);
      // Mock API key for authentication
      c.set('apiKey', { id: 'test-key', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null });
      return next();
    });

    app.onError((err, c) => {
      if (err instanceof NotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: err.message }, 500);
    });

    app.route('/', routesRoutes);
    return app;
  }

  describe('POST /instances/:instanceId/routes', () => {
    test('should create a chat route', async () => {
      const app = createApp();
      const res = await app.request(`/instances/${testInstance.id}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'chat',
          chatId: testChat.id,
          agentProviderId: testProvider.id,
          agentId: 'test-agent',
          label: 'Test Chat Route',
          priority: 10,
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as { data: AgentRoute };
      expect(data.data).toMatchObject({
        scope: 'chat',
        chatId: testChat.id,
        agentProviderId: testProvider.id,
        agentId: 'test-agent',
        label: 'Test Chat Route',
        priority: 10,
        isActive: true,
      });
      insertedIds.routes.push(data.data.id);
    });

    test('should create a user route', async () => {
      const app = createApp();
      const res = await app.request(`/instances/${testInstance.id}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'user',
          personId: testPerson.id,
          agentProviderId: testProvider.id,
          agentId: 'vip-agent',
          label: 'VIP User Route',
          priority: 20,
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as { data: AgentRoute };
      expect(data.data).toMatchObject({
        scope: 'user',
        personId: testPerson.id,
        agentProviderId: testProvider.id,
        agentId: 'vip-agent',
        label: 'VIP User Route',
        priority: 20,
      });
      insertedIds.routes.push(data.data.id);
    });

    test('should reject chat route without chatId', async () => {
      const app = createApp();
      const res = await app.request(`/instances/${testInstance.id}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'chat',
          agentProviderId: testProvider.id,
          agentId: 'test-agent',
        }),
      });

      expect(res.status).toBe(400);
    });

    test('should reject user route without personId', async () => {
      const app = createApp();
      const res = await app.request(`/instances/${testInstance.id}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'user',
          agentProviderId: testProvider.id,
          agentId: 'test-agent',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /instances/:instanceId/routes', () => {
    test('should list all routes for instance', async () => {
      const app = createApp();
      const res = await app.request(`/instances/${testInstance.id}/routes`);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { items: AgentRoute[] };
      expect(data.items).toBeArray();
      expect(data.items.length).toBeGreaterThanOrEqual(2); // At least chat + user routes
    });

    test('should filter routes by scope', async () => {
      const app = createApp();
      const res = await app.request(`/instances/${testInstance.id}/routes?scope=chat`);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { items: AgentRoute[] };
      expect(data.items).toBeArray();
      expect(data.items.every((r: AgentRoute) => r.scope === 'chat')).toBe(true);
    });

    test('should filter routes by active status', async () => {
      const app = createApp();
      const res = await app.request(`/instances/${testInstance.id}/routes?isActive=true`);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { items: AgentRoute[] };
      expect(data.items).toBeArray();
      expect(data.items.every((r: AgentRoute) => r.isActive === true)).toBe(true);
    });
  });

  describe('GET /instances/:instanceId/routes/:id', () => {
    test('should get route by id', async () => {
      const app = createApp();
      const routeId = insertedIds.routes[0];
      if (!routeId) throw new Error('No route created');

      const res = await app.request(`/instances/${testInstance.id}/routes/${routeId}`);

      expect(res.status).toBe(200);
      const data = (await res.json()) as { data: AgentRoute };
      expect(data.data.id).toBe(routeId);
    });

    test('should return 404 for non-existent route', async () => {
      const app = createApp();
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.request(`/instances/${testInstance.id}/routes/${fakeId}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /instances/:instanceId/routes/:id', () => {
    test('should update route fields', async () => {
      const app = createApp();
      const routeId = insertedIds.routes[0];
      if (!routeId) throw new Error('No route created');

      const res = await app.request(`/instances/${testInstance.id}/routes/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Updated Label',
          priority: 15,
          agentTimeout: 120,
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { data: AgentRoute };
      expect(data.data.label).toBe('Updated Label');
      expect(data.data.priority).toBe(15);
      expect(data.data.agentTimeout).toBe(120);
    });

    test('should deactivate route', async () => {
      const app = createApp();
      const routeId = insertedIds.routes[0];
      if (!routeId) throw new Error('No route created');

      const res = await app.request(`/instances/${testInstance.id}/routes/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: false,
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { data: AgentRoute };
      expect(data.data.isActive).toBe(false);

      // Reactivate for cleanup
      await app.request(`/instances/${testInstance.id}/routes/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });
    });
  });

  describe('DELETE /instances/:instanceId/routes/:id', () => {
    test('should delete route', async () => {
      const app = createApp();
      const routeId = insertedIds.routes[0];
      if (!routeId) throw new Error('No route created');

      // Delete the existing route
      const deleteRes = await app.request(`/instances/${testInstance.id}/routes/${routeId}`, {
        method: 'DELETE',
      });

      expect(deleteRes.status).toBe(200);
      const data = (await deleteRes.json()) as { success: boolean };
      expect(data.success).toBe(true);

      // Verify it's gone
      const getRes = await app.request(`/instances/${testInstance.id}/routes/${routeId}`);
      expect(getRes.status).toBe(404);

      // Remove from insertedIds so cleanup doesn't try to delete it again
      insertedIds.routes = insertedIds.routes.filter((id) => id !== routeId);
    });
  });

  describe('GET /routes/metrics', () => {
    test('should return cache metrics', async () => {
      const app = createApp();
      const res = await app.request('/routes/metrics');

      expect(res.status).toBe(200);
      // biome-ignore lint/suspicious/noExplicitAny: Metrics object has dynamic structure
      const data = (await res.json()) as { data: { cache: any; timestamp: string } };
      expect(data.data.cache).toMatchObject({
        hits: expect.any(Number),
        misses: expect.any(Number),
        sets: expect.any(Number),
        invalidations: expect.any(Number),
        lastQueryMs: expect.any(Number),
        cacheSize: expect.any(Number),
        hitRate: expect.any(Number),
      });
      expect(data.data.timestamp).toBeString();
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate cache after route creation', async () => {
      const services = createServices(db, null);
      const app = createApp(services); // Inject services to share state

      // Get initial metrics
      const initialMetrics = services.routeResolver.getMetrics();
      const initialInvalidations = initialMetrics.invalidations;

      // Create a route using testChat2
      const res = await app.request(`/instances/${testInstance.id}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'chat',
          chatId: testChat2.id,
          agentProviderId: testProvider.id,
          agentId: 'cache-test-agent',
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as { data: AgentRoute };
      insertedIds.routes.push(data.data.id);

      // Check that invalidations increased
      const newMetrics = services.routeResolver.getMetrics();
      expect(newMetrics.invalidations).toBeGreaterThan(initialInvalidations);
    });
  });

  describe('Unique Constraints', () => {
    test('should enforce one chat route per instance', async () => {
      const app = createApp();

      // First route should succeed (using testChat3)
      const res1 = await app.request(`/instances/${testInstance.id}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'chat',
          chatId: testChat3.id,
          agentProviderId: testProvider.id,
          agentId: 'unique-test-1',
        }),
      });
      expect(res1.status).toBe(201);
      const route1 = ((await res1.json()) as { data: AgentRoute }).data;
      insertedIds.routes.push(route1.id);

      // Second route for same chat should fail
      const res2 = await app.request(`/instances/${testInstance.id}/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'chat',
          chatId: testChat3.id,
          agentProviderId: testProvider.id,
          agentId: 'unique-test-2',
        }),
      });
      expect(res2.status).toBe(500); // Unique constraint violation

      // Cleanup
      await app.request(`/instances/${testInstance.id}/routes/${route1.id}`, {
        method: 'DELETE',
      });
      insertedIds.routes = insertedIds.routes.filter((id) => id !== route1.id);
    });
  });
});
