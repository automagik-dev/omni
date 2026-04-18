/**
 * Tests for routes/v2/voice.ts REST API — platform-agnostic via VoiceCapable.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { voiceRoutes } from '../routes/v2/voice';
import type { AppVariables } from '../types';

const NOOP = () => {};

/** Mock voice session matching VoiceSession interface. */
function mockVoiceSession(
  overrides?: Partial<{
    id: string;
    state: string;
    channelId: string;
    instanceId: string;
    participants: string[];
    createdAt: number;
  }>,
) {
  return {
    id: overrides?.id ?? 'voice-123',
    state: overrides?.state ?? 'ready',
    channelId: overrides?.channelId ?? 'chan-1',
    instanceId: overrides?.instanceId ?? 'inst-1',
    participants: overrides?.participants ?? [],
    createdAt: overrides?.createdAt ?? 1000,
    onAudio: NOOP,
    offAudio: NOOP,
    sendAudio: NOOP,
  };
}

/** Mock VoiceCapable plugin. */
function mockVoicePlugin(sessions: ReturnType<typeof mockVoiceSession>[] = []) {
  return {
    id: 'test',
    voiceJoin: async () => sessions[0] ?? mockVoiceSession(),
    voiceLeave: async () => {},
    voiceSessions: () => sessions,
    voiceSession: (id: string) => sessions.find((s) => s.id === id),
  };
}

function createTestApp(opts?: { channelRegistry?: unknown; eventBus?: unknown }) {
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
    test('returns empty list when no voice plugin', async () => {
      const app = createTestApp();
      const res = await app.request('/voice/sessions');
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
    });

    test('returns sessions from voice-capable plugin', async () => {
      const session = mockVoiceSession({ id: 'voice-abc', channelId: 'chan-1' });
      const app = createTestApp({
        channelRegistry: { getAll: () => [mockVoicePlugin([session])] },
      });
      const res = await app.request('/voice/sessions');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { sessionId: string }[] };
      expect(body.items.length).toBe(1);
      expect(body.items[0]?.sessionId).toBe('voice-abc');
    });
  });

  describe('GET /voice/sessions/:id', () => {
    test('returns session detail', async () => {
      const session = mockVoiceSession({ id: 'voice-abc' });
      const app = createTestApp({
        channelRegistry: { getAll: () => [mockVoicePlugin([session])] },
      });
      const res = await app.request('/voice/sessions/voice-abc');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { sessionId: string } };
      expect(body.data.sessionId).toBe('voice-abc');
    });

    test('returns 404 for unknown session', async () => {
      const app = createTestApp({
        channelRegistry: { getAll: () => [mockVoicePlugin([])] },
      });
      const res = await app.request('/voice/sessions/unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /voice/join', () => {
    test('validates request body', async () => {
      const app = createTestApp();
      const res = await app.request('/voice/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when no voice plugin', async () => {
      const app = createTestApp({ channelRegistry: { getAll: () => [] } });
      const res = await app.request('/voice/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'inst-1', channelId: 'chan-1', guildId: 'guild-1' }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 201 on successful join', async () => {
      const session = mockVoiceSession({ id: 'voice-new' });
      const app = createTestApp({
        channelRegistry: { getAll: () => [mockVoicePlugin([session])] },
      });
      const res = await app.request('/voice/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'inst-1', channelId: 'chan-1', guildId: 'guild-1' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { sessionId: string } };
      expect(body.data.sessionId).toBe('voice-new');
    });
  });

  describe('POST /voice/leave', () => {
    test('validates request body', async () => {
      const app = createTestApp();
      const res = await app.request('/voice/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    test('returns success on leave', async () => {
      const app = createTestApp({
        channelRegistry: { getAll: () => [mockVoicePlugin()] },
      });
      const res = await app.request('/voice/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'voice-123' }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { success: boolean }).success).toBe(true);
    });
  });
});
