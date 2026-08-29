/**
 * POST /scheduled-messages error classification (#3).
 *
 * The route's catch mapped EVERY non-OmniError to VALIDATION (400), so a
 * server-side fault — a platform/native scheduling failure, a network blip, a
 * DB error — was reported to the caller as a 400 they can do nothing about.
 * Genuine caller mistakes (past dates, malformed content) must stay 400; real
 * faults must surface as 5xx.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { scheduledMessagesRoutes } from '../scheduled-messages';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const IN_ONE_HOUR = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

/** Minimal db that only answers createPluginResolver's instance-channel lookup. */
function channelLookupDb(channel = 'slack'): Database {
  const chain = () => {
    const self: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'orderBy', 'for']) self[m] = () => self;
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's thenable builder
    (self as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve([{ channel }]);
    return self;
  };
  return { select: () => chain() } as unknown as Database;
}

function makeApp(plugin: unknown, db: Database): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', db as never);
    c.set('channelRegistry', { get: () => plugin } as never);
    await next();
  });
  app.route('/', scheduledMessagesRoutes);
  app.onError(errorHandler);
  return app;
}

async function post(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>): Promise<Response> {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  instanceId: INSTANCE_ID,
  chatId: 'C1',
  content: { type: 'text', text: 'oi' },
  sendAt: IN_ONE_HOUR(),
};

describe('POST /scheduled-messages error classification', () => {
  test('a server-side scheduling fault surfaces as 5xx, not a caller 400 (#3)', async () => {
    // A native channel that advertises scheduling and then throws is a server
    // fault, not a caller error.
    const plugin = {
      id: 'slack',
      capabilities: { canScheduleMessage: true },
      scheduleMessage: async () => {
        throw new Error('slack API exploded');
      },
    };
    const res = await post(makeApp(plugin, channelLookupDb('slack')), validBody);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  test('a genuine caller mistake (malformed content) still returns 400', async () => {
    const plugin = { id: 'slack', capabilities: { canScheduleMessage: false } };
    const res = await post(makeApp(plugin, channelLookupDb('slack')), {
      ...validBody,
      content: { text: 'no type discriminant' },
    });
    expect(res.status).toBe(400);
  });
});
