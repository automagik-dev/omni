/**
 * POST /messages/send/presence — opt-in server-held presence (hold=true) and
 * the unchanged default path. Runs without a database: services and the
 * channel registry are in-memory mocks (the DB-gated suite in
 * src/__tests__/messages-presence.test.ts is skipped in CI).
 */

import { describe, expect, mock, test } from 'bun:test';
import { zValidator } from '@hono/zod-validator';
import { ERROR_CODES, OmniError } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '55555555-5555-4555-8555-555555555555';
const CHAT = '5511999999999@s.whatsapp.net';

type HoldArgs = [instanceId: string, chatId: string, type: 'typing' | 'recording' | 'paused', maxLifetimeMs?: number];

/**
 * sendPresenceSchema exactly as on origin/dev (before hold existed). The
 * default (non-hold) path must reject bad input with byte-identical errors.
 */
const devSendPresenceSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Chat ID to show presence in'),
  type: z.enum(['typing', 'recording', 'paused']).describe('Presence type'),
  threadId: z.string().min(1).optional().describe('Thread timestamp/id for thread-scoped presence surfaces'),
  status: z.string().min(1).max(100).optional().describe('Custom status text for channels that support it'),
  loadingMessages: z
    .array(z.string().min(1).max(100))
    .max(10)
    .optional()
    .describe('Rotating loading messages for channels that support them'),
  duration: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .describe('Duration in ms before auto-pause; omit for channel default, 0 = until paused'),
});

function mountPresenceRoute(
  holdPresence?: (...args: HoldArgs) => Promise<{ expiresAt: number | null; lifetimeMs: number }>,
) {
  const sendTyping = mock(async (_instanceId: string, _chatId: string, _duration?: number) => {});
  const plugin = {
    capabilities: { canSendTyping: true },
    sendTyping,
    ...(holdPresence ? { holdPresence } : {}),
  };
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: { getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })) },
      persons: { getIdentityForChannel: mock(async () => null) },
      chats: { getById: mock(async () => null) },
    } as never);
    c.set('channelRegistry', { get: mock(() => plugin) } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/messages', messagesRoutes);
  return { app, sendTyping };
}

function holdMock(lifetimeMs = 60_000) {
  return mock(async (...args: HoldArgs) => ({
    expiresAt: args[2] === 'paused' ? null : Date.parse('2026-10-18T12:01:00.000Z'),
    lifetimeMs: args[2] === 'paused' ? 0 : lifetimeMs,
  }));
}

function postPresence(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>) {
  return app.request('/messages/send/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: CHAT, ...body }),
  });
}

/** What the origin/dev route returned for this body (zValidator over dev's schema). */
async function devValidationResponse(body: Record<string, unknown>) {
  const devApp = new Hono();
  devApp.post('/p', zValidator('json', devSendPresenceSchema), (c) => c.json({ ok: true }));
  const res = await devApp.request('/p', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: CHAT, ...body }),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /messages/send/presence — default (no hold) path is unchanged', () => {
  test('non-hold duration 400000 fails with exactly the error origin/dev returned', async () => {
    const { app, sendTyping } = mountPresenceRoute(holdMock());
    const body = { type: 'typing', duration: 400000 };

    const res = await postPresence(app, body);
    const dev = await devValidationResponse(body);

    expect(dev.status).toBe(400);
    expect(res.status).toBe(dev.status);
    expect(await res.json()).toEqual(dev.body);
    const issues = (dev.body as { error: { issues: Array<Record<string, unknown>> } }).error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'too_big', maximum: 30000, path: ['duration'], exact: false });
    expect(sendTyping).not.toHaveBeenCalled();
  });

  test('duration keeps the 30000 bound even with hold=true (duration is ignored under hold, not widened)', async () => {
    const hold = holdMock();
    const { app } = mountPresenceRoute(hold);

    const res = await postPresence(app, { type: 'typing', hold: true, duration: 30001 });

    expect(res.status).toBe(400);
    expect(hold).not.toHaveBeenCalled();
  });

  test('no hold: sendTyping keeps the 5000 default, holdPresence untouched, no hold key in the response', async () => {
    const hold = holdMock();
    const { app, sendTyping } = mountPresenceRoute(hold);

    const res = await postPresence(app, { type: 'typing' });
    const explicitFalse = await postPresence(app, { type: 'recording', hold: false, duration: 10000 });

    expect(res.status).toBe(200);
    expect(explicitFalse.status).toBe(200);
    expect(sendTyping.mock.calls).toEqual([
      [INSTANCE_ID, CHAT, 5000],
      [INSTANCE_ID, CHAT, 10000],
    ]);
    expect(hold).not.toHaveBeenCalled();
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect('hold' in json.data).toBe(false);
    expect(json.data.method).toBe('typing_indicator');
  });
});

describe('POST /messages/send/presence — hold=true (opt-in)', () => {
  test('holdMaxMs is the hold lifetime; duration is ignored', async () => {
    const hold = holdMock(120_000);
    const { app, sendTyping } = mountPresenceRoute(hold);

    const res = await postPresence(app, { type: 'recording', hold: true, holdMaxMs: 120000, duration: 5000 });

    expect(res.status).toBe(200);
    expect(hold.mock.calls).toEqual([[INSTANCE_ID, CHAT, 'recording', 120000]]);
    expect(sendTyping).not.toHaveBeenCalled();
    const json = (await res.json()) as {
      data: { duration: number; method: string; hold: { expiresAt: string | null } };
    };
    expect(json.data.duration).toBe(120_000);
    expect(json.data.method).toBe('presence_hold');
    expect(json.data.hold).toEqual({ expiresAt: '2026-10-18T12:01:00.000Z' });
  });

  test('holdMaxMs omitted reaches the plugin as undefined (server default)', async () => {
    const hold = holdMock();
    const { app } = mountPresenceRoute(hold);

    await postPresence(app, { type: 'typing', hold: true, duration: 20000 });

    expect(hold.mock.calls).toEqual([[INSTANCE_ID, CHAT, 'typing', undefined]]);
  });

  test('holdMaxMs accepts 0 and 300000 and rejects 300001', async () => {
    const hold = holdMock();
    const { app } = mountPresenceRoute(hold);

    const zero = await postPresence(app, { type: 'typing', hold: true, holdMaxMs: 0 });
    const max = await postPresence(app, { type: 'typing', hold: true, holdMaxMs: 300000 });
    const tooLong = await postPresence(app, { type: 'typing', hold: true, holdMaxMs: 300001 });

    expect(zero.status).toBe(200);
    expect(max.status).toBe(200);
    expect(tooLong.status).toBe(400);
    expect(hold.mock.calls.map((call) => call[3])).toEqual([0, 300000]);
  });

  test('paused hold reports expiresAt null', async () => {
    const hold = holdMock();
    const { app } = mountPresenceRoute(hold);

    const res = await postPresence(app, { type: 'paused', hold: true });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { hold: { expiresAt: string | null } } };
    expect(json.data.hold).toEqual({ expiresAt: null });
  });

  test('the per-instance hold cap surfaces as 429 CHANNEL_RATE_LIMITED', async () => {
    const hold = mock(async (..._args: HoldArgs): Promise<{ expiresAt: number | null; lifetimeMs: number }> => {
      throw new OmniError({
        code: ERROR_CODES.CHANNEL_RATE_LIMITED,
        message: 'Instance already holds presence in 50 chats',
        recoverable: true,
      });
    });
    const { app } = mountPresenceRoute(hold);

    const res = await postPresence(app, { type: 'typing', hold: true });

    expect(res.status).toBe(429);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('CHANNEL_RATE_LIMITED');
  });

  test('a channel without holdPresence answers CAPABILITY_NOT_SUPPORTED and sends nothing', async () => {
    const { app, sendTyping } = mountPresenceRoute();

    const res = await postPresence(app, { type: 'typing', hold: true });

    expect(res.ok).toBe(false);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(sendTyping).not.toHaveBeenCalled();
  });
});
