import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { configAuditMiddleware, diffRows, fingerprint, redactSecrets, resolveTarget } from '../config-audit';

const ID = '11111111-1111-1111-1111-111111111111';

describe('config audit helpers', () => {
  test('resolveTarget maps config paths and skips others', () => {
    expect(resolveTarget('POST', '/api/v2/instances')).toMatchObject({
      targetId: undefined,
      action: 'instance.create',
    });
    expect(resolveTarget('POST', `/api/v2/instances/${ID}/connect`)).toMatchObject({
      targetId: ID,
      action: 'instance.connect',
    });
    expect(resolveTarget('DELETE', `/api/v2/instances/${ID}/routes/r1`)?.resource.type).toBe('route');
    expect(resolveTarget('PUT', '/api/v2/settings/foo')).toMatchObject({ targetId: 'foo', action: 'setting.update' });
    expect(resolveTarget('POST', '/api/v2/messages/send')).toBeNull();
  });

  test('secrets become stable fingerprints, never the value', () => {
    const a = redactSecrets({ name: 'x', slackAppToken: 'xapp-SECRET', config: { botToken: 'xoxb-SECRET' } });
    const b = redactSecrets({ slackAppToken: 'xapp-SECRET' }) as Record<string, unknown>;
    expect(JSON.stringify(a)).not.toContain('SECRET');
    expect((a as Record<string, unknown>).slackAppToken).toBe(fingerprint('xapp-SECRET'));
    expect(b.slackAppToken).toBe((a as Record<string, unknown>).slackAppToken); // reuse is detectable
    expect(fingerprint('xapp-SECRET')).toMatch(/^sha256:[0-9a-f]{12}$/);
  });

  test('diffRows reports only changed fields and ignores updatedAt', () => {
    expect(
      diffRows({ name: 'a', token: 'sha256:1', updatedAt: 1 }, { name: 'b', token: 'sha256:1', updatedAt: 2 }),
    ).toEqual({ name: { before: 'a', after: 'b' } });
    expect(diffRows(null, { name: 'b' })).toEqual({ name: { before: null, after: 'b' } });
  });
});

describe('configAuditMiddleware', () => {
  function mockDb(rows: Record<string, unknown>[], inserts: Record<string, unknown>[]) {
    let call = 0;
    const chain = { from: () => chain, where: () => chain, limit: async () => [rows[call++]].filter(Boolean) };
    return { select: () => chain, insert: () => ({ values: async (v: Record<string, unknown>) => inserts.push(v) }) };
  }

  test('writes actor, ip, and fingerprinted before/after for a PATCH', async () => {
    const inserts: Record<string, unknown>[] = [];
    const db = mockDb(
      [
        { id: ID, name: 'old', slackBotToken: 'xoxb-A' },
        { id: ID, name: 'new', slackBotToken: 'xoxb-B' },
      ],
      inserts,
    );
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('services', { db } as never);
      c.set('requestId', 'req_1');
      c.set('apiKey', { id: 'k1', name: '__primary__' } as never);
      await next();
    });
    app.use('*', configAuditMiddleware);
    app.patch('/api/v2/instances/:id', (c) => c.json({ data: { id: ID } }));
    app.get('/api/v2/instances/:id', (c) => c.json({}));

    await app.request(`/api/v2/instances/${ID}`);
    expect(inserts).toHaveLength(0); // reads are never audited

    const res = await app.request(`/api/v2/instances/${ID}`, {
      method: 'PATCH',
      headers: { 'x-omni-actor': 'cli:alice', 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'omni-cli' },
    });
    expect(res.status).toBe(200);
    await Bun.sleep(0);

    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      apiKeyName: '__primary__',
      actor: 'cli:alice',
      requestId: 'req_1',
      ipAddress: '203.0.113.9',
      userAgent: 'omni-cli',
      action: 'instance.update',
      targetType: 'instance',
      targetId: ID,
      statusCode: 200,
    });
    expect(row.changedFields).toEqual(['name', 'slackBotToken']);
    expect(JSON.stringify(row.changes)).not.toContain('xoxb');
  });
});
