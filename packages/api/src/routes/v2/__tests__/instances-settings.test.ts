/** #1403: real route + InstanceService, deterministic DB seam, no live services. */
import { describe, expect, mock, test } from 'bun:test';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { NotFoundError } from '@omni/core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { InstanceSchema, registerInstanceSchemas } from '../../../schemas/openapi/instances';
import { InstanceService } from '../../../services/instances';
import { runInTenantScope } from '../../../tenancy/tenant-scope';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const ID = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const MISSING = '33333333-3333-4333-8333-333333333333';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const followUp = {
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [15, 30] },
  maxFollowUps: 2,
  promptTemplate: 'Follow up with {{chatName}}',
  stopOutsideMessagingWindow: true,
  showTypingIndicator: false,
};
const settings = {
  agentChainToInstanceId: TARGET,
  chainMode: 'forward',
  triggerMode: 'fire-and-forget',
  triggerReactions: ['👍', '✅'],
  triggerMentionPatterns: ['assistant'],
  disableUsernamePrefix: true,
  agentAckMessage: 'Working on it',
  processAudio: false,
  processImages: false,
  processVideo: false,
  processDocuments: false,
  processMediaOnBlocked: false,
  downloadMediaOnSync: true,
  inboundMaxAgeMinutes: 25,
  replayEnabled: false,
  sessionReset: { default: { mode: 'daily', hour: 3 }, dm: { mode: 'idle', minutes: 60 } },
  followUpConfig: followUp,
};
const nullable = [
  'agentChainToInstanceId',
  'triggerReactions',
  'triggerMentionPatterns',
  'agentAckMessage',
  'sessionReset',
  'followUpConfig',
];
const dialect = new PgDialect();
const predicateId = (where: SQL) => String(dialect.sqlToQuery(where).params[0]);

function mount(options: { allowed?: string[]; tenant?: string; targetTenant?: string; failUpdate?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>([
    [
      ID,
      {
        id: ID,
        name: 'settings',
        channel: 'whatsapp-baileys',
        agentId: null,
        tenantId: options.tenant ?? null,
        ...settings,
      },
    ],
    [
      TARGET,
      {
        id: TARGET,
        name: 'target',
        channel: 'internal',
        agentId: null,
        tenantId: options.targetTenant ?? options.tenant ?? null,
      },
    ],
  ]);
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  const reads: string[] = [];
  const scopedReads: string[] = [];
  const publish = mock(async (_type: string, _payload: unknown) => ({}) as never);
  // Decode the real Drizzle predicate: a seam that ignores IDs could falsely
  // prove that PATCH/GET operated on the same row or that a target existed.
  function handle(tenant?: string) {
    const visible = (id: string) => {
      const row = rows.get(id);
      return row && (!tenant || row.tenantId === tenant) ? row : undefined;
    };
    return {
      execute: async (_sql: SQL) => [],
      select: () => ({
        from: () => ({
          where: (where: SQL) => ({
            limit: async () => {
              const id = predicateId(where);
              reads.push(id);
              if (tenant) scopedReads.push(id);
              const row = visible(id);
              return row ? [{ ...row }] : [];
            },
          }),
        }),
      }),
      update: () => ({
        set: (data: Record<string, unknown>) => ({
          where: (where: SQL) => ({
            returning: async () => {
              const id = predicateId(where);
              writes.push({ id, data });
              if (options.failUpdate || !visible(id)) return [];
              const defined = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
              const row = { ...rows.get(id), ...defined };
              rows.set(id, row);
              return [{ ...row }];
            },
          }),
        }),
      }),
    };
  }
  const db = {
    ...handle(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(handle(options.tenant)),
  };
  const service = new InstanceService(db as never, { publish } as never);
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', { instances: service } as never);
    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: options.allowed ?? null,
      expiresAt: null,
    } as never);
    if (options.tenant) {
      await runInTenantScope(db as never, { credentialClass: 'tenant', tenantId: options.tenant } as never, next);
    } else await next();
  });
  app.route('/instances', instancesRoutes);
  app.onError((err, c) =>
    err instanceof HTTPException
      ? err.getResponse()
      : c.json({ error: err.message }, err instanceof NotFoundError ? 404 : 500),
  );
  const patch = (body: unknown, id = ID) =>
    app.request(`/instances/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const get = () => app.request(`/instances/${ID}`);
  return { app, patch, get, writes, reads, scopedReads, publish, rows };
}

async function data(response: Response) {
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

// Obtain the actual published PATCH schema, not a test-only approximation.
const registry = new OpenAPIRegistry();
registerInstanceSchemas(registry);
const patchDefinition = registry.definitions.find(
  (definition) => definition.type === 'route' && definition.route.method === 'patch',
);
if (!patchDefinition || patchDefinition.type !== 'route') throw new Error('Missing PATCH definition');
const publishedPatch = patchDefinition.route.request?.body?.content['application/json']?.schema;
if (!(publishedPatch instanceof z.ZodType)) throw new Error('Missing PATCH schema');

describe('channel settings PATCH (#1403)', () => {
  test.each(Object.entries(settings))('accepts, persists and reads back %s on the same ID', async (key, value) => {
    const h = mount();
    // Seed a different value to prove the update actually changes storage.
    h.rows.set(ID, {
      ...h.rows.get(ID),
      [key]: nullable.includes(key) ? null : typeof value === 'boolean' ? !value : 'old',
    });
    const response = await h.patch({ [key]: value });
    expect(response.status).toBe(200);
    expect((await data(response))[key]).toEqual(value);
    expect((await data(await h.get()))[key]).toEqual(value);
    expect(h.reads).toContain(ID);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.id).toBe(ID);
    expect(h.writes[0]?.data[key]).toEqual(value);
    expect(h.rows.get(TARGET)?.name).toBe('target');
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledWith('instance.updated', {
      instanceId: ID,
      channelType: 'whatsapp-baileys',
      changedKeys: [key],
    });
    expect(publishedPatch.safeParse({ [key]: value }).success).toBe(true);
    expect(key in InstanceSchema.shape).toBe(true);
  });

  test('all17 together, then omitted settings remain unchanged with key-only event', async () => {
    const h = mount();
    expect((await h.patch(settings)).status).toBe(200);
    expect(await data(await h.get())).toMatchObject({ id: ID, ...settings });
    expect((await h.patch({ name: 'renamed' })).status).toBe(200);
    expect(await data(await h.get())).toMatchObject({ id: ID, name: 'renamed', ...settings });
    expect(h.publish.mock.calls[1]).toEqual([
      'instance.updated',
      {
        instanceId: ID,
        channelType: 'whatsapp-baileys',
        changedKeys: ['name'],
      },
    ]);
  });

  test.each(nullable)('explicit null clears nullable %s', async (key) => {
    const h = mount();
    expect((await h.patch({ [key]: null })).status).toBe(200);
    expect((await data(await h.get()))[key]).toBeNull();
    expect(publishedPatch.safeParse({ [key]: null }).success).toBe(true);
  });

  test.each(Object.keys(settings).filter((key) => !nullable.includes(key)))(
    'rejects null for NOT NULL %s',
    async (key) => {
      const h = mount();
      expect((await h.patch({ [key]: null })).status).toBe(400);
      expect(h.writes).toHaveLength(0);
      expect(h.publish).not.toHaveBeenCalled();
      expect(publishedPatch.safeParse({ [key]: null }).success).toBe(false);
    },
  );

  const invalid: Array<[string, unknown]> = [
    ['agentChainToInstanceId', 'not-a-uuid'],
    ['chainMode', 'loop'],
    ['triggerMode', 'sync'],
    ['triggerReactions', '👍'],
    ['triggerReactions', [1]],
    ['triggerMentionPatterns', [false]],
    ['agentAckMessage', 123],
    ['disableUsernamePrefix', 'true'],
    ['processAudio', 0],
    ['processImages', 'false'],
    ['processVideo', []],
    ['processDocuments', {}],
    ['processMediaOnBlocked', 1],
    ['downloadMediaOnSync', 'yes'],
    ['replayEnabled', 'false'],
    ['inboundMaxAgeMinutes', -1],
    ['inboundMaxAgeMinutes', 1.5],
    ['inboundMaxAgeMinutes', '10'],
    ['inboundMaxAgeMinutes', 2147483648],
    ['sessionReset', []],
    ['sessionReset', { unknown: { mode: 'none' } }],
    ['sessionReset', { dm: { mode: 'weekly' } }],
    ['sessionReset', { dm: { mode: 'daily', hour: 24 } }],
    ['sessionReset', { dm: { mode: 'daily', hour: -1 } }],
    ['sessionReset', { dm: { mode: 'daily', hour: 1.5 } }],
    ['sessionReset', { dm: { mode: 'idle', minutes: 0 } }],
    ['sessionReset', { dm: { mode: 'idle', minutes: '60' } }],
    ['sessionReset', { dm: { mode: 'none', hour: 3 } }],
    ['followUpConfig', {}],
    ['followUpConfig', { ...followUp, maxFollowUps: 51 }],
    ['followUpConfig', { ...followUp, surprise: true }],
    ['followUpConfig', { ...followUp, schedule: { kind: 'fixed', intervalsMinutes: [] } }],
    ['followUpConfig', { ...followUp, schedule: { kind: 'fixed', intervalsMinutes: [1], extra: 1 } }],
    ['followUpConfig', { ...followUp, quietHours: { start: '25:00', end: '08:00', timezone: 'UTC' } }],
    ['followUpConfig', { ...followUp, quietHours: { start: '22:00', end: '08:00', timezone: 'Not/AZone' } }],
    ['followUpConfig', { ...followUp, quietHours: { start: '22:00', end: '22:00', timezone: 'UTC' } }],
    ['unknownSetting', true],
    ['agentProviderId', TARGET],
    ['agentProviderId', null],
  ];
  test.each(invalid)('rejects malformed/unknown/read-only %s atomically (%j)', async (key, value) => {
    const h = mount();
    expect((await h.patch({ name: 'must-not-save', [key]: value })).status).toBe(400);
    expect(h.rows.get(ID)?.name).toBe('settings');
    expect(h.writes).toHaveLength(0);
    expect(h.publish).not.toHaveBeenCalled();
    expect(publishedPatch.safeParse({ [key]: value }).success).toBe(false);
  });

  test('accepts domain alternatives and zero inbound age', async () => {
    const h = mount();
    for (const body of [
      { chainMode: 'off', triggerMode: 'round-trip', inboundMaxAgeMinutes: 0 },
      { chainMode: 'bidirectional', triggerReactions: [], triggerMentionPatterns: [] },
      { sessionReset: { default: { mode: 'none' }, group: { mode: 'daily' }, thread: { mode: 'idle' } } },
      {
        followUpConfig: {
          ...followUp,
          schedule: { kind: 'exponential', initialMinutes: 1, factor: 2, maxMinutes: 60 },
        },
      },
      {
        followUpConfig: {
          ...followUp,
          quietHours: { start: '22:00', end: '08:00', timezone: 'UTC', spreadMinutes: 10 },
        },
      },
    ]) {
      expect((await h.patch(body)).status).toBe(200);
      expect(publishedPatch.safeParse(body).success).toBe(true);
    }
  });

  test('nested settings replace rather than merge, and follow-up defaults stay inside supplied config', async () => {
    const h = mount();
    const followUpConfig = { schedule: followUp.schedule, maxFollowUps: 1, promptTemplate: 'Hello' };
    expect((await h.patch({ sessionReset: { thread: { mode: 'none' } }, followUpConfig })).status).toBe(200);
    const stored = await data(await h.get());
    expect(stored.sessionReset).toEqual({ thread: { mode: 'none' } });
    expect(stored.followUpConfig).toEqual({
      ...followUpConfig,
      enabled: true,
      stopOutsideMessagingWindow: true,
      showTypingIndicator: true,
    });
    expect(publishedPatch.parse({ followUpConfig })).toMatchObject({ followUpConfig: stored.followUpConfig });
  });

  test('malformed JSON is rejected without a write or event', async () => {
    const h = mount();
    const response = await h.app.request(`/instances/${ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(h.writes).toHaveLength(0);
    expect(h.publish).not.toHaveBeenCalled();
  });

  test('missing chain target is rejected before persistence', async () => {
    const h = mount();
    expect((await h.patch({ agentChainToInstanceId: MISSING })).status).toBe(404);
    expect(h.reads).toContain(MISSING);
    expect(h.writes).toHaveLength(0);
    expect(h.publish).not.toHaveBeenCalled();
  });

  test('self-chain is rejected before persistence', async () => {
    const h = mount();
    expect((await h.patch({ agentChainToInstanceId: ID })).status).toBe(400);
    expect(h.writes).toHaveLength(0);
  });

  test('existing instance access restriction covers source and chain target', async () => {
    const h = mount({ allowed: [ID] });
    expect((await h.patch({ replayEnabled: true }, TARGET)).status).toBe(403);
    expect((await h.patch({ agentChainToInstanceId: TARGET })).status).toBe(403);
    expect(h.reads).not.toContain(TARGET);
    expect(h.writes).toHaveLength(0);
    expect(h.publish).not.toHaveBeenCalled();
  });

  test('allowed chain target uses existing tenant-scoped service lookup', async () => {
    const h = mount({ allowed: [ID, TARGET], tenant: TENANT });
    expect((await h.patch({ agentChainToInstanceId: TARGET })).status).toBe(200);
    expect(h.scopedReads).toContain(TARGET);
    expect((await data(await h.get())).agentChainToInstanceId).toBe(TARGET);
  });

  test('tenant-invisible chain target cannot be persisted', async () => {
    const h = mount({ tenant: TENANT, targetTenant: OTHER_TENANT });
    expect((await h.patch({ agentChainToInstanceId: TARGET })).status).toBe(404);
    expect(h.scopedReads).toContain(TARGET);
    expect(h.writes).toHaveLength(0);
    expect(h.publish).not.toHaveBeenCalled();
  });

  test('failed real service update emits no event', async () => {
    const h = mount({ failUpdate: true });
    expect((await h.patch({ replayEnabled: true })).status).toBe(404);
    expect(h.publish).not.toHaveBeenCalled();
  });

  test('OpenAPI document publishes all17 in PATCH and GET without PATCH defaults', () => {
    const document = new OpenApiGeneratorV3(registry.definitions).generateDocument({
      openapi: '3.0.0',
      info: { title: 'settings', version: '1' },
    });
    const operation = document.paths['/instances/{id}']?.patch;
    expect(operation?.responses['400']).toBeDefined();
    for (const key of Object.keys(settings)) {
      expect(publishedPatch.safeParse({}).success).toBe(true);
      const parsed = publishedPatch.parse({}) as Record<string, unknown>;
      expect(parsed[key]).toBeUndefined();
      expect(key in InstanceSchema.shape).toBe(true);
    }
  });
});
