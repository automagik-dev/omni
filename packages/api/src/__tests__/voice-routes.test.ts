/**
 * Tests for routes/v2/voice.ts REST API
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { voiceRoutes } from '../routes/v2/voice';
import type { AppVariables } from '../types';

/** Create a test app with mock services. */
function createTestApp(opts?: {
  channelRegistry?: unknown;
  eventBus?: unknown;
}) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('channelRegistry', (opts?.channelRegistry ?? null) as AppVariables['channelRegistry']);
    c.set('eventBus', (opts?.eventBus ?? null) as AppVariables['eventBus']);
    c.set('services', {} as AppVariables['services']);
    c.set('db', {} as AppVariables['db']);
    c.set('requestId', 'test-123');
    await next();
  });

  app.route('/voice', voiceRoutes);
  return app;
}

describe('voice routes', () => {
  describe('GET /voice/sessions', () => {
    test('should return empty list when no channel registry', async () => {
      const app = createTestApp();
      const res = await app.request('/voice/sessions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toEqual([]);
    });

    test('should return empty list when no discord plugin', async () => {
      const app = createTestApp({
        channelRegistry: { get: () => null },
      });
      const res = await app.request('/voice/sessions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toEqual([]);
    });

    test('should return sessions from voice manager', async () => {
      const mockSessions = [
        {
          sessionId: 'voice-123',
          instanceId: 'inst-1',
          guildId: 'guild-1',
          channelId: 'chan-1',
          state: 'ready',
          participants: ['user-1', 'user-2'],
          createdAt: 1000,
        },
      ];
      const app = createTestApp({
        channelRegistry: {
          get: () => ({ voiceManager: { getSessions: () => mockSessions } }),
        },
      });
      const res = await app.request('/voice/sessions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: typeof mockSessions };
      expect(body.items.length).toBe(1);
      expect(body.items[0]?.sessionId).toBe('voice-123');
    });
  });

  describe('GET /voice/sessions/:id', () => {
    test('should return session detail', async () => {
      const mockSession = {
        sessionId: 'voice-123',
        instanceId: 'inst-1',
        guildId: 'guild-1',
        channelId: 'chan-1',
        state: 'ready',
        participants: ['user-1'],
        createdAt: 1000,
      };
      const app = createTestApp({
        channelRegistry: {
          get: () => ({ voiceManager: { getSession: (id: string) => (id === 'voice-123' ? mockSession : undefined) } }),
        },
      });

      const res = await app.request('/voice/sessions/voice-123');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: typeof mockSession };
      expect(body.data.sessionId).toBe('voice-123');
    });

    test('should return 404 for unknown session', async () => {
      const app = createTestApp({
        channelRegistry: {
          get: () => ({ voiceManager: { getSession: () => undefined } }),
        },
      });

      const res = await app.request('/voice/sessions/unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /voice/join', () => {
    test('should validate request body', async () => {
      const app = createTestApp();
      const res = await app.request('/voice/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test('should return 503 when no channel registry', async () => {
      const app = createTestApp();
      const res = await app.request('/voice/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'inst-1', channelId: 'chan-1', guildId: 'guild-1' }),
      });
      expect(res.status).toBe(503);
    });

    test('should return 201 on successful join', async () => {
      const mockSession = {
        sessionId: 'voice-guild-1-123',
        state: 'ready',
        participants: [],
      };
      const mockVoiceManager = { joinChannel: async () => mockSession };
      const app = createTestApp({
        channelRegistry: {
          get: () => ({
            voiceManagers: new Map([['inst-1', mockVoiceManager]]),
          }),
        },
      });

      const res = await app.request('/voice/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'inst-1', channelId: 'chan-1', guildId: 'guild-1' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: typeof mockSession };
      expect(body.data.sessionId).toBe('voice-guild-1-123');
    });
  });

  describe('POST /voice/leave', () => {
    test('should validate request body', async () => {
      const app = createTestApp();
      const res = await app.request('/voice/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test('should return success on leave', async () => {
      const app = createTestApp({
        channelRegistry: {
          get: () => ({
            voiceManager: {
              leaveChannel: async () => {},
            },
          }),
        },
      });

      const res = await app.request('/voice/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'voice-123' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });
});
