/**
 * Tests for follow-up config REST endpoints.
 *
 * Uses in-memory service mocks so the route handlers can be exercised without a
 * Postgres dependency. Schema validation (Zod) and the three scope handlers
 * are the contract under test — storage-side behavior is covered by the
 * lifecycle integration test.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import type { FollowUpSequenceConfig } from '@omni/core';
import type { Agent, Chat, Instance } from '@omni/db';
import { Hono } from 'hono';
import { followUpRoutes } from '../routes/v2/follow-up';
import type { AppVariables } from '../types';

const validConfig: FollowUpSequenceConfig = {
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'Ping {{chatName}} — {{minutes}}m',
  stopOutsideMessagingWindow: true,
  showTypingIndicator: true,
};

interface MockStore {
  agent: Partial<Agent>;
  instance: Partial<Instance>;
  chat: Partial<Chat>;
}

function makeApp(store: MockStore) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      agents: {
        getById: async (id: string) => ({ ...store.agent, id }) as Agent,
        update: async (id: string, data: Partial<Agent>) => {
          Object.assign(store.agent, data);
          return { ...store.agent, id } as Agent;
        },
      },
      instances: {
        getById: async (id: string) => ({ ...store.instance, id }) as Instance,
        update: async (id: string, data: Partial<Instance>) => {
          Object.assign(store.instance, data);
          return { ...store.instance, id } as Instance;
        },
      },
      chats: {
        getById: async (id: string) => ({ ...store.chat, id }) as Chat,
        update: async (id: string, data: Partial<Chat>) => {
          Object.assign(store.chat, data);
          return { ...store.chat, id } as Chat;
        },
      },
    } as unknown as AppVariables['services']);
    await next();
  });
  app.route('/follow-up', followUpRoutes);
  return app;
}

const uuid = '00000000-0000-0000-0000-00000000000a';

describe('follow-up config routes', () => {
  let store: MockStore;
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    store = { agent: {}, instance: {}, chat: { settings: {} } };
    app = makeApp(store);
  });

  describe('agents scope', () => {
    test('GET returns stored config', async () => {
      store.agent.followUpConfig = validConfig;
      const res = await app.request(`/follow-up/agents/${uuid}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: FollowUpSequenceConfig | null };
      expect(body.data).toEqual(validConfig);
    });

    test('GET returns null when unset', async () => {
      const res = await app.request(`/follow-up/agents/${uuid}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: FollowUpSequenceConfig | null };
      expect(body.data).toBeNull();
    });

    test('PUT stores a valid config', async () => {
      const res = await app.request(`/follow-up/agents/${uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validConfig),
      });
      expect(res.status).toBe(200);
      expect(store.agent.followUpConfig).toEqual(validConfig);
    });

    test('PUT rejects an invalid config (empty intervals)', async () => {
      const bad = { ...validConfig, schedule: { kind: 'fixed', intervalsMinutes: [] } };
      const res = await app.request(`/follow-up/agents/${uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bad),
      });
      expect(res.status).toBe(400);
    });

    test('DELETE clears the override', async () => {
      store.agent.followUpConfig = validConfig;
      const res = await app.request(`/follow-up/agents/${uuid}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(store.agent.followUpConfig).toBeNull();
    });
  });

  describe('instances scope', () => {
    test('PUT stores and GET returns the config', async () => {
      const put = await app.request(`/follow-up/instances/${uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validConfig),
      });
      expect(put.status).toBe(200);

      const get = await app.request(`/follow-up/instances/${uuid}`);
      const body = (await get.json()) as { data: FollowUpSequenceConfig | null };
      expect(body.data).toEqual(validConfig);
    });

    test('DELETE clears the override', async () => {
      store.instance.followUpConfig = validConfig;
      const res = await app.request(`/follow-up/instances/${uuid}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(store.instance.followUpConfig).toBeNull();
    });
  });

  describe('chats scope', () => {
    test('PUT merges into settings without clobbering unrelated keys', async () => {
      store.chat.settings = { muted: true, pinned: true };
      const res = await app.request(`/follow-up/chats/${uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validConfig),
      });
      expect(res.status).toBe(200);
      expect(store.chat.settings).toEqual({
        muted: true,
        pinned: true,
        followUpConfig: validConfig,
      });
    });

    test('GET reads from settings.followUpConfig', async () => {
      store.chat.settings = { followUpConfig: validConfig };
      const res = await app.request(`/follow-up/chats/${uuid}`);
      const body = (await res.json()) as { data: FollowUpSequenceConfig | null };
      expect(body.data).toEqual(validConfig);
    });

    test('DELETE drops only followUpConfig, leaves rest intact', async () => {
      store.chat.settings = { muted: true, followUpConfig: validConfig, pinned: true };
      const res = await app.request(`/follow-up/chats/${uuid}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(store.chat.settings).toEqual({ muted: true, pinned: true });
    });

    test('DELETE is idempotent when nothing was set', async () => {
      store.chat.settings = { muted: true };
      const res = await app.request(`/follow-up/chats/${uuid}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(store.chat.settings).toEqual({ muted: true });
    });
  });
});
