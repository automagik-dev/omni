/**
 * Action configs reject unknown keys (#1117) instead of silently stripping
 * them, and the error names the offending key and the valid ones.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { automationsRoutes } from '../automations';

function buildApp(): Hono<{ Variables: AppVariables }> {
  const services = {
    automations: { create: async (data: Record<string, unknown>) => ({ id: 'auto-1', ...data }) },
  } as unknown as AppVariables['services'];
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/automations', automationsRoutes);
  return app;
}

async function create(action: { type: string; config: Record<string, unknown> }): Promise<Response> {
  return await buildApp().request('/automations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x', triggerEventType: 'message.received', actions: [action] }),
  });
}

const VALID: Array<{ type: string; config: Record<string, unknown>; validKey: string }> = [
  { type: 'emit_event', config: { eventType: 'custom.example' }, validKey: 'payloadTemplate' },
  { type: 'webhook', config: { url: 'https://example.com' }, validKey: 'bodyTemplate' },
  { type: 'send_message', config: { contentTemplate: 'hi' }, validKey: 'contentTemplate' },
  { type: 'log', config: { level: 'info', message: 'hi' }, validKey: 'message' },
  { type: 'call_agent', config: { agentId: 'a1' }, validKey: 'agentId' },
];

describe('POST /automations action config strictness (#1117)', () => {
  for (const { type, config, validKey } of VALID) {
    test(`${type}: valid config is accepted`, async () => {
      expect((await create({ type, config })).status).toBe(201);
    });

    test(`${type}: unknown key is rejected naming it and the valid keys`, async () => {
      const res = await create({ type, config: { ...config, payload: { text: 'x' } } });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { issues: Array<{ message: string; path: Array<string | number> }> };
      };
      expect(body.error.issues[0]?.path).toEqual(['actions', 0, 'config']);
      const message = body.error.issues[0]?.message ?? '';
      expect(message).toContain('payload');
      expect(message).toContain('Valid keys:');
      expect(message).toContain(validKey);
    });
  }
});

describe('call_agent waitForResponse (#1176)', () => {
  test('waitForResponse: false is accepted', async () => {
    expect((await create({ type: 'call_agent', config: { agentId: 'a1', waitForResponse: false } })).status).toBe(201);
  });

  test('responseAs with waitForResponse: false is rejected', async () => {
    const res = await create({
      type: 'call_agent',
      config: { agentId: 'a1', waitForResponse: false, responseAs: 'r' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: Array<{ message: string; path: Array<string | number> }> } };
    expect(body.error.issues[0]?.path).toEqual(['actions', 0, 'config', 'responseAs']);
    expect(body.error.issues[0]?.message).toContain('no response to bind');
  });
});
