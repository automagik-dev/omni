/**
 * Agent unbind/reassign/rebind through the real PATCH route and ApiKeyService.
 * Disposable PostgreSQL proves revocation invalidates cached authentication,
 * active-key lookup skips audited revoked rows, and replacement keys work.
 * Opt in with OMNI_G4_POSTGRES_URL; never reads ambient DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDbHandle } from '@omni/db';
import type { Database } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { Hono } from 'hono';
import { DEFAULT_TURN_SCOPES } from '../../../constants/scopes';
import { ApiKeyService } from '../../../services/api-keys';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const INSTANCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_A = 'a0000000-0000-4000-8000-000000000001';
const AGENT_B = 'b0000000-0000-4000-8000-000000000002';

postgresDescribe('agent key assignment lifecycle (real PostgreSQL)', () => {
  const dbName = `omni_agent_keys_${crypto.randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const url = new URL(superUrl);
    url.pathname = `/${dbName}`;
    const handle = createDbHandle({ url: url.toString(), maxConnections: 3 });
    db = handle.db;
    close = handle.close;
  }, 180_000);

  afterAll(async () => {
    await close?.();
    const result = Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '--set',
        'ON_ERROR_STOP=1',
        '--dbname',
        superUrl,
        '-c',
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  });

  function harness(tenantId: string | null = null) {
    const service = new ApiKeyService(db);
    const issued: Awaited<ReturnType<ApiKeyService['create']>>[] = [];
    const create = service.create.bind(service);
    service.create = async (options) => {
      const result = await create(options);
      issued.push(result);
      return result;
    };
    const names: Record<string, string> = {
      [AGENT_A]: `old-${crypto.randomUUID()}`,
      [AGENT_B]: `new-${crypto.randomUUID()}`,
    };
    const assignments = new Map([[INSTANCE_A, AGENT_A]]);
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('apiKey', { id: 'operator', name: 'operator', scopes: ['*'], instanceIds: null, expiresAt: null });
      c.set('services', {
        apiKeys: service,
        instances: {
          create: async (data: { agentId?: string }) => {
            if (data.agentId) assignments.set(INSTANCE_B, data.agentId);
            return { ...data, id: INSTANCE_B, tenantId };
          },
          getById: async (id: string) => ({
            id,
            agentId: assignments.get(id) ?? null,
            agentReplyFilter: null,
            tenantId,
          }),
          update: async (id: string, patch: { agentId?: string | null }) => {
            if (patch.agentId === null) assignments.delete(id);
            else if (patch.agentId !== undefined) assignments.set(id, patch.agentId);
            return { id, channel: 'whatsapp-baileys', tenantId };
          },
        },
        agents: { getById: async (id: string) => ({ id, name: names[id], metadata: null }) },
      } as never);
      await next();
    });
    app.route('/instances', instancesRoutes);
    const assign = (id: string, agentId: string | null) =>
      app.request(`/instances/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
    const seed = (instanceIds: string[]) =>
      service.create({
        name: tenantId ? `agent:${tenantId}:${names[AGENT_A]}` : `agent:${names[AGENT_A]}`,
        instanceIds,
        scopes: [...DEFAULT_TURN_SCOPES],
        createdBy: 'system:auto-provision',
      });
    return { app, service, issued, names, assign, seed };
  }

  for (const tenantId of [null, '11111111-1111-4111-8111-111111111111']) {
    test(`POST extends the key before PATCH unbinds the first instance (${tenantId ?? 'legacy'})`, async () => {
      const h = harness(tenantId);
      const old = await h.seed([INSTANCE_A]);
      await h.service.validate(old.plainTextKey);
      const res = await h.app.request('/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'second', channel: 'whatsapp-baileys', agentId: AGENT_A }),
      });
      expect(res.status).toBe(201);
      expect((await h.service.validate(old.plainTextKey))?.instanceIds).toEqual([INSTANCE_A, INSTANCE_B]);
      expect((await h.assign(INSTANCE_A, null)).status).toBe(200);
      expect((await h.service.getById(old.key.id))?.status).toBe('active');
      expect((await h.service.validate(old.plainTextKey))?.instanceIds).toEqual([INSTANCE_B]);
    });
  }

  test('agent lookup ignores user-created names and audited revoked system keys', async () => {
    const h = harness();
    const name = `agent:${h.names[AGENT_A]}`;
    await h.service.create({
      name,
      instanceIds: [INSTANCE_A],
      scopes: [...DEFAULT_TURN_SCOPES],
      createdBy: 'operator',
    });
    expect(await h.service.findAgentKeyByName(name)).toBeNull();
    const system = await h.seed([INSTANCE_A]);
    expect((await h.service.findAgentKeyByName(name))?.id).toBe(system.key.id);
    await h.service.revoke(system.key.id);
    expect(await h.service.findAgentKeyByName(name)).toBeNull();
  });

  test('unbinding the last instance revokes the key and invalidates cached authentication', async () => {
    const h = harness();
    const old = await h.seed([INSTANCE_A]);
    expect((await h.service.validate(old.plainTextKey))?.instanceIds).toEqual([INSTANCE_A]);
    expect((await h.assign(INSTANCE_A, null)).status).toBe(200);
    const stored = await h.service.getById(old.key.id);
    expect(stored?.status).toBe('revoked');
    expect(stored?.instanceIds).toEqual([INSTANCE_A]);
    expect(await h.service.validate(old.plainTextKey)).toBeNull();
    expect(await h.service.findAgentKeyByName(old.key.name)).toBeNull();
  });

  test('reassigning an instance preserves the old key for only its other instance', async () => {
    const h = harness();
    const old = await h.seed([INSTANCE_A, INSTANCE_B]);
    await h.service.validate(old.plainTextKey); // warm the cache before narrowing
    h.issued.length = 0;
    expect((await h.assign(INSTANCE_A, AGENT_B)).status).toBe(200);
    expect((await h.service.getById(old.key.id))?.status).toBe('active');
    expect((await h.service.validate(old.plainTextKey))?.instanceIds).toEqual([INSTANCE_B]);
    const replacement = h.issued[0];
    if (!replacement) throw new Error('new agent key was not provisioned');
    expect((await h.service.validate(replacement.plainTextKey))?.instanceIds).toEqual([INSTANCE_A]);
    expect(await h.service.findAgentKeyByName(`agent:${h.names[AGENT_B]}`)).toMatchObject({ id: replacement.key.id });
  });

  test('rebind creates a fresh working key; subsequent binds select it instead of the revoked row', async () => {
    const h = harness();
    const old = await h.seed([INSTANCE_A]);
    await h.service.validate(old.plainTextKey);
    h.issued.length = 0;
    expect((await h.assign(INSTANCE_A, null)).status).toBe(200);
    expect((await h.assign(INSTANCE_A, AGENT_A)).status).toBe(200);
    expect(h.issued).toHaveLength(1);
    const fresh = h.issued[0];
    if (!fresh) throw new Error('fresh key was not provisioned');
    expect(fresh.key.id).not.toBe(old.key.id);
    expect(await h.service.validate(old.plainTextKey)).toBeNull();
    const validated = await h.service.validate(fresh.plainTextKey);
    expect(validated?.instanceIds).toEqual([INSTANCE_A]);
    expect(validated?.scopes).toEqual([...DEFAULT_TURN_SCOPES]);
    expect(ApiKeyService.instanceAllowed(validated?.instanceIds ?? [], INSTANCE_B)).toBe(false);
    expect((await h.assign(INSTANCE_B, AGENT_A)).status).toBe(200);
    expect(h.issued).toHaveLength(1);
    expect((await h.service.findAgentKeyByName(old.key.name))?.id).toBe(fresh.key.id);
    expect((await h.service.validate(fresh.plainTextKey))?.instanceIds).toEqual([INSTANCE_A, INSTANCE_B]);
    expect((await h.service.getById(old.key.id))?.status).toBe('revoked');
    expect((await h.service.getById(old.key.id))?.instanceIds).toEqual([INSTANCE_A]);
  });
});
