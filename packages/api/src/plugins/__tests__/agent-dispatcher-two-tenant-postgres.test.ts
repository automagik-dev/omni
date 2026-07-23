/**
 * Two-tenant AGENT-DISPATCHER containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * The dispatcher is a NATS consumer whose four direct tenant-table accesses
 * were `pending-G5-conversion` sites:
 *   - `agent_sessions` — the per-thread init marker (check/mark pair);
 *   - `agents`         — the FK-override read (`applyAgentFkOverrides`) and the
 *                        turn-based agent lookup;
 *   - `handoff_logs`   — the error-handoff audit insert;
 *   - `instances`      — the self-send-guard owner-identifier enumeration,
 *                        which also keeps an in-memory CACHE that must be
 *                        tenant-keyed (a global cache would serve tenant A's
 *                        identifiers to tenant B — the namespace deliverable).
 *
 * Each conversion threads the envelope-derived `trustedTenantId` (stamped into
 * `DispatchMetadata` by the subscription handlers, never read from payloads)
 * into a SHORT worker tenant scope around the discrete DB block. This suite
 * proves each converted seam — the exact functions the dispatch path calls —
 * stays inside the work item's tenant, and that aiming one tenant's scope at
 * another tenant's rows buys nothing.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  agentSessions,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
  handoffLogs,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { RouteResolver } from '../../services/route-resolver';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { applyAgentFkOverrides, __test__ as dispatcherTest } from '../agent-dispatcher';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '22222222-2222-4222-8222-2222222222ab';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555aa';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555ab';
const CHAT_A = '66666666-6666-4666-8666-6666666666aa';
const AGENT_A = '99999999-9999-4999-8999-9999999999aa';
const ROUTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const JID = '5511999990000@s.whatsapp.net';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-dispatcher-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string, user?: { name: string; password: string }): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

postgresDescribe('two-tenant agent-dispatcher containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_dispatcher_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  const sessionKeysForTenant = (tenantId: string, instanceId: string): Promise<{ sessionKey: string }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ sessionKey: agentSessions.sessionKey })
        .from(agentSessions)
        .where(eq(agentSessions.instanceId, instanceId)),
    );

  const handoffsForTenant = (tenantId: string, chatUuid: string): Promise<{ id: string }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ id: handoffLogs.id })
        .from(handoffLogs)
        .where(eq(handoffLogs.chatUuid, chatUuid)),
    );

  beforeAll(async () => {
    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    const superDbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(superDbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);

      INSERT INTO instances (id, name, channel, tenant_id, is_active, owner_identifier, created_at) VALUES
        ('${INSTANCE_A}', 'inst-a', 'whatsapp-baileys', '${TENANT_A}', true, 'owner-a', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'inst-b', 'whatsapp-baileys', '${TENANT_B}', true, 'owner-b', '${SHARED_TIMESTAMP}');

      INSERT INTO chats (id, instance_id, external_id, canonical_id, chat_type, channel, name, tenant_id, created_at)
      VALUES
        ('${CHAT_A}', '${INSTANCE_A}', '${JID}', '${JID}', 'direct', 'whatsapp-baileys', 'Chat A',
         '${TENANT_A}', '${SHARED_TIMESTAMP}');

      INSERT INTO agents (id, name, provider, agent_type, config_path) VALUES
        ('${AGENT_A}', 'agent-a', 'claude-code', 'assistant', 'agents/a.yaml');
      -- The BEFORE INSERT derivation trigger forces agents.tenant_id to NULL
      -- (agents derives its tenant via owner_id -> persons, and persons is
      -- G2-unowned until the G6 backfill). Stamp it directly as superuser to
      -- model the POST-G6-backfill state this conversion targets — exactly the
      -- write the G6 ledger tooling will perform.
      UPDATE agents SET tenant_id = '${TENANT_A}' WHERE id = '${AGENT_A}';

      -- A chat-scoped route on A's chat; the derivation trigger stamps its
      -- tenant from the (required) owning instance.
      INSERT INTO agent_routes (id, instance_id, scope, chat_id, is_active, priority) VALUES
        ('${ROUTE_A}', '${INSTANCE_A}', 'chat', '${CHAT_A}', true, 0);
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical connection shared by both tenants' workers: any bleed shows here.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 1);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('per-thread init marker lands under A and is invisible to B', async () => {
    await dispatcherTest.markPerThreadSessionInitialized(runtimeDb, INSTANCE_A, 'thread-1', TENANT_A);

    expect(await dispatcherTest.checkPerThreadSessionExists(runtimeDb, INSTANCE_A, 'thread-1', TENANT_A)).toBe(true);
    // B's worker scope cannot see A's marker — the lazy-init check refuses to
    // be satisfied by a foreign tenant's row.
    expect(await dispatcherTest.checkPerThreadSessionExists(runtimeDb, INSTANCE_A, 'thread-1', TENANT_B)).toBe(false);
    expect((await sessionKeysForTenant(TENANT_A, INSTANCE_A)).length).toBe(1);
    expect((await sessionKeysForTenant(TENANT_B, INSTANCE_A)).length).toBe(0);
  });

  test("a B worker cannot mark a session on A's instance", async () => {
    // The derivation trigger stamps the tenant from the instance (A); under B's
    // scope the WITH CHECK refuses the row rather than trusting the caller.
    await expect(
      dispatcherTest.markPerThreadSessionInitialized(runtimeDb, INSTANCE_A, 'thread-forged', TENANT_B),
    ).rejects.toThrow();
    expect((await sessionKeysForTenant(TENANT_A, INSTANCE_A)).length).toBe(1); // only the legit marker
  });

  test("applyAgentFkOverrides reads A's agent under A and refuses to see it under B", async () => {
    const effectiveA = { agentId: AGENT_A } as Parameters<typeof applyAgentFkOverrides>[2];
    await applyAgentFkOverrides(runtimeDb, AGENT_A, effectiveA, TENANT_A);
    expect(effectiveA.agentInternalId).toBe('agents/a.yaml');

    // Under B's scope A's agent row is invisible: nothing is stamped, so a
    // forged cross-tenant agentId cannot leak another tenant's agent config.
    const effectiveB = { agentId: AGENT_A } as Parameters<typeof applyAgentFkOverrides>[2];
    await applyAgentFkOverrides(runtimeDb, AGENT_A, effectiveB, TENANT_B);
    expect(effectiveB.agentInternalId).toBeUndefined();
  });

  test('the self-send-guard enumeration and its cache are tenant-keyed', async () => {
    dispatcherTest.resetActiveOwnerIdentifiersCache();

    // A sees only its own owner identifiers…
    expect(await dispatcherTest.listActiveOwnerIdentifiers(runtimeDb, TENANT_A)).toEqual(['owner-a']);
    // …and B, asking IMMEDIATELY afterwards (inside any cache TTL), must not be
    // served A's cached list — the cache key includes the tenant. With the old
    // global cache this returns ['owner-a'] and the guard would treat A's
    // instance as B's own (cross-tenant identifier leak + wrong gating).
    expect(await dispatcherTest.listActiveOwnerIdentifiers(runtimeDb, TENANT_B)).toEqual(['owner-b']);
    // Repeat A from cache: still A's list.
    expect(await dispatcherTest.listActiveOwnerIdentifiers(runtimeDb, TENANT_A)).toEqual(['owner-a']);
  });

  test('route resolution is tenant-scoped and its negative cache is tenant-keyed', async () => {
    const resolver = new RouteResolver(runtimeDb);

    // A foreign (B) worker scope aiming at A's instance/chat resolves NOTHING —
    // RLS hides the route — and caches its own negative entry…
    expect(await resolver.resolve(INSTANCE_A, CHAT_A, undefined, TENANT_B)).toBeNull();

    // …which must NOT poison A's lookup: with a tenant-less cache key, B's
    // NO_ROUTE sentinel would short-circuit this call and A's routing (and
    // every per-route override) would silently fall back to instance defaults
    // for the TTL. The tenant-keyed cache keeps the worlds apart.
    const route = await resolver.resolve(INSTANCE_A, CHAT_A, undefined, TENANT_A);
    expect(route?.id).toBe(ROUTE_A);
  });

  test("the error-handoff audit insert lands under A; a B worker aiming at A's chat writes nothing", async () => {
    // Minimal services stub: the chat row is supplied directly (the chats
    // service's own containment is its own site's test); the REAL
    // handoff_logs insert below is the probe.
    const services = {
      chats: {
        findByExternalIdSmart: async () => ({ id: CHAT_A, settings: {} }),
        update: async () => undefined,
      },
      followUpLifecycle: { disarm: async () => undefined },
    } as unknown as Parameters<typeof dispatcherTest.persistErrorHandoffSideEffects>[0];
    const instanceA = { id: INSTANCE_A, agentId: null } as Parameters<
      typeof dispatcherTest.persistErrorHandoffSideEffects
    >[3];

    await dispatcherTest.persistErrorHandoffSideEffects(
      services,
      runtimeDb,
      'whatsapp-baileys',
      instanceA,
      JID,
      'handoff message',
      'ext-msg-1',
      TENANT_A,
    );
    expect((await handoffsForTenant(TENANT_A, CHAT_A)).length).toBe(1);
    expect((await handoffsForTenant(TENANT_B, CHAT_A)).length).toBe(0);

    // A B worker aiming at A's chat/instance: the derivation trigger stamps
    // tenant A from the instance, B's WITH CHECK refuses, and the side-effect
    // block's best-effort catch swallows it — nothing lands anywhere.
    await dispatcherTest.persistErrorHandoffSideEffects(
      services,
      runtimeDb,
      'whatsapp-baileys',
      instanceA,
      JID,
      'forged handoff',
      'ext-msg-2',
      TENANT_B,
    );
    expect((await handoffsForTenant(TENANT_A, CHAT_A)).length).toBe(1);
    expect((await handoffsForTenant(TENANT_B, CHAT_A)).length).toBe(0);
  });
});
