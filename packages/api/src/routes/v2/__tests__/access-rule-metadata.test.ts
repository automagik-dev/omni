/**
 * #1704: staff keep a free JSON object on an access rule (the omni-channels plugin reads a
 * person's `context` and `capability` from their allow rule).
 *
 * Contract:
 *   POST /access/rules and PATCH /access/rules/:id take an optional `metadata` object of at
 *   most 16 KB as JSON; anything else is a 400 that reaches no service. PATCH replaces the
 *   object when given and leaves it alone when absent. A pairing request keeps its own.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { RULE_METADATA_MAX_BYTES, accessRoutes } from '../access';

type Call = { kind: 'create' | 'update'; data: Record<string, unknown> };

function mountAccessRoutes(calls: Call[], ruleType = 'allow'): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      access: {
        create: mock(async (data: Record<string, unknown>) => {
          calls.push({ kind: 'create', data });
          return { id: 'rule-1', ...data };
        }),
        update: mock(async (id: string, data: Record<string, unknown>) => {
          calls.push({ kind: 'update', data });
          return { id, ...data };
        }),
        getById: mock(async (id: string) => ({ id, ruleType })),
      },
    } as never);
    await next();
  });
  app.route('/access', accessRoutes);
  return app;
}

const send = (app: Hono<{ Variables: AppVariables }>, method: string, path: string, body: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const rule = { ruleType: 'allow', platformUserId: '5511988887777', action: 'allow' };

describe('access rule metadata (#1704)', () => {
  test('POST keeps a metadata object on the new rule', async () => {
    const calls: Call[] = [];
    const metadata = { context: 'Prefers short answers.', capability: { name: 'orders', secrets: ['ORDERS_TOKEN'] } };
    const res = await send(mountAccessRoutes(calls), 'POST', '/access/rules', { ...rule, metadata });
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data.metadata).toEqual(metadata);
  });

  test('POST without metadata passes none', async () => {
    const calls: Call[] = [];
    const res = await send(mountAccessRoutes(calls), 'POST', '/access/rules', rule);
    expect(res.status).toBe(201);
    expect('metadata' in (calls[0]?.data ?? {})).toBe(false);
  });

  for (const [label, metadata] of [
    ['an array', ['context']],
    ['a string', 'context'],
    ['null', null],
    ['more than 16 KB', { context: 'x'.repeat(RULE_METADATA_MAX_BYTES) }],
  ] as const) {
    test(`POST and PATCH refuse metadata that is ${label}`, async () => {
      const calls: Call[] = [];
      const app = mountAccessRoutes(calls);
      expect((await send(app, 'POST', '/access/rules', { ...rule, metadata })).status).toBe(400);
      expect((await send(app, 'PATCH', '/access/rules/rule-1', { metadata })).status).toBe(400);
      expect(calls).toHaveLength(0);
    });
  }

  test('metadata of exactly 16 KB is kept', async () => {
    const calls: Call[] = [];
    const filler = RULE_METADATA_MAX_BYTES - JSON.stringify({ context: '' }).length;
    const metadata = { context: 'x'.repeat(filler) };
    expect(new TextEncoder().encode(JSON.stringify(metadata)).length).toBe(RULE_METADATA_MAX_BYTES);
    const res = await send(mountAccessRoutes(calls), 'POST', '/access/rules', { ...rule, metadata });
    expect(res.status).toBe(201);
  });

  test('PATCH replaces metadata when given and leaves it alone when absent', async () => {
    const calls: Call[] = [];
    const app = mountAccessRoutes(calls);
    expect((await send(app, 'PATCH', '/access/rules/rule-1', { metadata: { context: 'New.' } })).status).toBe(200);
    expect(calls[0]?.data.metadata).toEqual({ context: 'New.' });
    expect((await send(app, 'PATCH', '/access/rules/rule-1', { reason: 'renamed' })).status).toBe(200);
    expect('metadata' in (calls[1]?.data ?? {})).toBe(false);
  });

  test('PATCH refuses metadata on a pairing request', async () => {
    const calls: Call[] = [];
    const res = await send(mountAccessRoutes(calls, 'pending_pairing'), 'PATCH', '/access/rules/rule-1', {
      metadata: { pairingCode: 'ABCDEF' },
    });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
