/**
 * `debounce.key` validation at the API boundary (#1110).
 *
 * `presence` mode extends an open window when a CONTACT starts typing or
 * recording — a statement about a conversation. A custom key says the window
 * is not a conversation, so the two cannot both be true. Accepting the pair and
 * ignoring one of them would leave a caller believing their `extendOnEvents`
 * does something, so the request is refused with a message that names the
 * conflict.
 *
 * Everything here is rejected (or accepted) by `zValidator` before any service
 * is touched, so the app needs no database double.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { automationsRoutes } from '../automations';

/** The create payload reaches the service only if validation passed. */
function buildApp(): { app: Hono<{ Variables: AppVariables }>; created: unknown[] } {
  const created: unknown[] = [];
  const services = {
    automations: {
      create: async (data: unknown) => {
        created.push(data);
        return { id: 'auto-1', ...(data as Record<string, unknown>) };
      },
    },
  } as unknown as AppVariables['services'];

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/automations', automationsRoutes);
  return { app, created };
}

async function createAutomation(debounce: Record<string, unknown>): Promise<Response> {
  const { app } = buildApp();
  return await app.request('/automations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'pr coalescer',
      triggerEventType: 'custom.repo.pull_request',
      actions: [{ type: 'log', config: { level: 'info', message: 'pr changed' } }],
      debounce,
    }),
  });
}

describe('POST /automations debounce.key (#1110)', () => {
  test('presence + key is REJECTED, with the conflict named', async () => {
    const res = await createAutomation({
      mode: 'presence',
      baseDelayMs: 1000,
      extendOnEvents: ['presence.composing'],
      key: '{{payload.pull_request.id}}',
    });

    expect(res.status).toBe(400);
    // A clear error, not a silent drop of one of the two.
    const body = (await res.json()) as { error: { issues: Array<{ message: string; path: string[] }> } };
    expect(body.error.issues[0]?.path).toEqual(['debounce', 'key']);
    expect(body.error.issues[0]?.message).toBe(
      'debounce.key cannot be combined with mode "presence": presence extension only applies to conversations',
    );
  });

  test('presence without a key is still accepted', async () => {
    const res = await createAutomation({
      mode: 'presence',
      baseDelayMs: 1000,
      extendOnEvents: ['presence.composing'],
    });
    expect(res.status).toBe(201);
  });

  test('fixed + key is accepted and reaches the service unchanged', async () => {
    const { app, created } = buildApp();
    const res = await app.request('/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'pr coalescer',
        triggerEventType: 'custom.repo.pull_request',
        actions: [{ type: 'log', config: { level: 'info', message: 'pr changed' } }],
        debounce: { mode: 'fixed', delayMs: 5000, key: '{{payload.pull_request.id}}' },
      }),
    });

    expect(res.status).toBe(201);
    expect((created[0] as { debounce: Record<string, unknown> }).debounce).toEqual({
      mode: 'fixed',
      delayMs: 5000,
      key: '{{payload.pull_request.id}}',
    });
  });

  test('an empty key is rejected rather than stored as a window that never renders', async () => {
    const res = await createAutomation({ mode: 'fixed', delayMs: 5000, key: '' });
    expect(res.status).toBe(400);
  });
});
