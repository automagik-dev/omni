/**
 * Two-tenant SESSION/DISPATCH-BACKEND containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * Three `pending-G5-conversion` sites share one caller graph — the
 * `message.received` dispatch/session consumers — and are converted together:
 *
 *   * `services/agent-runner.ts::instances`  — `getInstanceWithProvider`, the
 *     instance lookup EVERY dispatch path starts from. Zero HTTP callers.
 *   * `plugins/session-cleaner.ts::chat_participants` — `resolveCleanupPersonId`'s
 *     participant read, reached from the `session-cleaner` durable consumer and
 *     from `routes/v2/chats.ts`.
 *   * `plugins/session-storage.ts::agent_sessions` — the Claude-Code provider's
 *     session store, constructed inside the dispatcher and therefore reached only
 *     from a consumer.
 *
 * Before this leg all three ran on the AMBIENT POOL. Under enforcement that is
 * not merely unscoped, it is fail-closed loud: `omni_current_tenant_id()` RAISES
 * when no `app.tenant_id` is set, so an ambient read inside a worker scope errors
 * rather than quietly returning another tenant's row. That is what these tests
 * pin — each converted seam, run under `runInWorkerTenantScope`, must SUCCEED for
 * its own tenant and find NOTHING for the other.
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
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
} from '@omni/db';
import { AgentRunnerService } from '../../services/agent-runner';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { __test__ as sessionCleanerTest } from '../session-cleaner';
import { createSessionStorage } from '../session-storage';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111ca';
const TENANT_B = '22222222-2222-4222-8222-2222222222cb';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555ca';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555cb';
const CHAT_A = '66666666-6666-4666-8666-6666666666ca';
const CHAT_B = '66666666-6666-4666-8666-6666666666cb';

const JID_A = '5511999990101@s.whatsapp.net';
const JID_B = '5511999990102@s.whatsapp.net';
const PARTICIPANT_USER_A = '5511999990901';
const PARTICIPANT_USER_B = '5511999990902';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stdout: string; stderr: string } {
  const file = join(tmpdir(), `omni-g5-session-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
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

postgresDescribe('two-tenant session/dispatch-backend containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_sess_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  let superDbUrl: string;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  beforeAll(async () => {
    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    superDbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(superDbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'sess-tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'sess-tenant-b', 'Tenant B', 86400, 100, 100);

      INSERT INTO instances (id, name, channel, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'sess-inst-a', 'whatsapp-baileys', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'sess-inst-b', 'whatsapp-baileys', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO chats (id, instance_id, external_id, canonical_id, chat_type, channel, name, tenant_id, created_at)
      VALUES
        ('${CHAT_A}', '${INSTANCE_A}', '${JID_A}', '${JID_A}', 'direct', 'whatsapp-baileys', 'Chat A',
         '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${INSTANCE_B}', '${JID_B}', '${JID_B}', 'direct', 'whatsapp-baileys', 'Chat B',
         '${TENANT_B}', '${SHARED_TIMESTAMP}');

      -- Participants carry NO person_id: the tenant derives from chat_id, which
      -- is the required parent. This is deliberate — it keeps the probe off the
      -- G6-gated \`persons\` root while still exercising the real read.
      INSERT INTO chat_participants (chat_id, platform_user_id, tenant_id, created_at) VALUES
        ('${CHAT_A}', '${PARTICIPANT_USER_A}', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${PARTICIPANT_USER_B}', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO agent_sessions (instance_id, session_key, provider_session_data, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'provider:p1:session:shared-key', '{"sessionId":"sid-A"}', '${TENANT_A}',
         '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'provider:p1:session:shared-key', '{"sessionId":"sid-B"}', '${TENANT_B}',
         '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // maxConnections=2: the worker tenant transaction holds one; an ambient
    // pool access (the un-converted state) takes the OTHER, where no
    // `app.tenant_id` is set and `omni_current_tenant_id()` RAISES. The pre-G5
    // failure therefore surfaces as a loud error, not a silent leak.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 2);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  // -------------------------------------------------------------------------
  // agent-runner.ts::instances — getInstanceWithProvider
  // -------------------------------------------------------------------------

  test('getInstanceWithProvider resolves inside its worker tenant and finds nothing across tenants', async () => {
    const runner = new AgentRunnerService(runtimeDb);

    const aSeesA = await runInWorkerTenantScope(runtimeDb, TENANT_A, () => runner.getInstanceWithProvider(INSTANCE_A));
    expect(aSeesA?.id).toBe(INSTANCE_A);

    // B's scope must not resolve A's instance. Under RLS the row is invisible,
    // so the dispatch path that starts here simply has no instance to act on.
    const bSeesA = await runInWorkerTenantScope(runtimeDb, TENANT_B, () => runner.getInstanceWithProvider(INSTANCE_A));
    expect(bSeesA).toBeNull();

    const bSeesB = await runInWorkerTenantScope(runtimeDb, TENANT_B, () => runner.getInstanceWithProvider(INSTANCE_B));
    expect(bSeesB?.id).toBe(INSTANCE_B);
  });

  // -------------------------------------------------------------------------
  // session-cleaner.ts::chat_participants — resolveCleanupPersonId's read
  // -------------------------------------------------------------------------

  test('the session-cleaner participant read stays inside the work item’s tenant', async () => {
    const aOwnParticipant = await runInWorkerTenantScope(runtimeDb, TENANT_A, () =>
      sessionCleanerTest.readChatParticipant(runtimeDb, CHAT_A, PARTICIPANT_USER_A),
    );
    expect(aOwnParticipant).not.toBeUndefined();

    // A's chat is invisible to B, so B's cleanup resolves no participant at all
    // — it cannot learn that A's chat has one, let alone whose person it is.
    const bViewOfA = await runInWorkerTenantScope(runtimeDb, TENANT_B, () =>
      sessionCleanerTest.readChatParticipant(runtimeDb, CHAT_A, PARTICIPANT_USER_A),
    );
    expect(bViewOfA).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // session-storage.ts::agent_sessions — the provider session store
  // -------------------------------------------------------------------------

  test('session storage reads/writes only the resolved tenant’s agent_sessions row', async () => {
    // The store resolves its tenant from the instance's PERSISTED ownership —
    // the dispatcher passes `instance.tenantId`, never a payload claim.
    const storeA = createSessionStorage(runtimeDb, 'p1', undefined, { resolveTenantId: () => TENANT_A });
    const storeB = createSessionStorage(runtimeDb, 'p1', undefined, { resolveTenantId: () => TENANT_B });

    expect((await storeA.getSession(INSTANCE_A, 'shared-key'))?.sessionId).toBe('sid-A');
    expect((await storeB.getSession(INSTANCE_B, 'shared-key'))?.sessionId).toBe('sid-B');

    // The session KEY is identical across tenants; only the tenant scope
    // distinguishes them. B asking for A's instance gets nothing.
    expect(await storeB.getSession(INSTANCE_A, 'shared-key')).toBeNull();

    // A write under B for A's instance cannot land: `agent_sessions` derives its
    // tenant from the required `instances` parent, so the WITH CHECK refuses it.
    await expect(storeB.upsertSession(INSTANCE_A, 'stolen-key', 'sid-forged', null)).rejects.toThrow(
      /row-level security/i,
    );

    // A's own write lands and is readable only under A.
    await storeA.upsertSession(INSTANCE_A, 'fresh-key', 'sid-A2', null);
    expect((await storeA.getSession(INSTANCE_A, 'fresh-key'))?.sessionId).toBe('sid-A2');
    expect(await storeB.getSession(INSTANCE_A, 'fresh-key')).toBeNull();

    // And a delete under B cannot remove A's row.
    await storeB.deleteSession(INSTANCE_A, 'fresh-key');
    expect((await storeA.getSession(INSTANCE_A, 'fresh-key'))?.sessionId).toBe('sid-A2');
  });

  test('a store with NO tenant resolver keeps the pre-G5 ambient path (dual world)', async () => {
    // The legacy shape: no resolver, so no scope is opened and the query runs on
    // the ambient pool exactly as before. Under enforcement that is fail-closed
    // LOUD — which is the proof that the converted path above is what carries
    // the tenant, not some incidental ambient visibility.
    const legacyStore = createSessionStorage(runtimeDb, 'p1');
    await expect(legacyStore.getSession(INSTANCE_A, 'shared-key')).rejects.toThrow(/tenant/i);
  });
});
