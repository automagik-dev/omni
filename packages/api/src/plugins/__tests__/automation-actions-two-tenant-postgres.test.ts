/**
 * Two-tenant AUTOMATION-ACTIONS containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * The automation engine executes tenant-controlled actions from a NATS
 * consumer callback. This suite drives the REAL callback factory
 * (`buildAutomationEngineDeps` — exactly what `index.ts` hands
 * `startEngine`) with real `Services` over the enforced runtime role, so the
 * resolution reads (`instances.getById`, `chats.getById`, the direct `agents`
 * lookup) run precisely the scoped path production runs.
 *
 * Probes:
 *   1. tenant A's callback resolves A's own chat UUID to its external id;
 *   2. tenant A's callback CANNOT resolve tenant B's chat UUID — RLS turns the
 *      cross-tenant reference into not-found, and no send happens;
 *   3. tenant A's callback CANNOT see tenant B's instance;
 *   4. the `agents` G6 gate, fail-closed: `agents` derives its tenant via
 *      owner_id → persons (G2-`unowned`), so every row is NULL-tenant until
 *      the G6 backfill and a SCOPED read finds nothing — `call_agent` refuses
 *      with "Agent not found" rather than reading another tenant's (or a
 *      global) agent. Named degradation, mirrors the session-cleaner finding.
 *   5. under enforcement a LEGACY (tenantless) invocation reads through the
 *      runtime role with no tenant GUC and the policies match no rows — the
 *      dual world is data, not a code branch (flag-off byte-identity is
 *      asserted by the unit worker-scope probes).
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
import { createServices } from '../../services';
import { buildAutomationEngineDeps } from '../automation-actions';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '22222222-2222-4222-8222-2222222222bb';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555aa';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555bb';
const CHAT_A = '66666666-6666-4666-8666-6666666666aa';
const CHAT_B = '66666666-6666-4666-8666-6666666666bb';
const AGENT_ID = '77777777-7777-4777-8777-7777777777aa';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-autoactions-${crypto.randomUUID()}.sql`);
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

postgresDescribe('two-tenant automation-actions containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_autoactions_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let deps: ReturnType<typeof buildAutomationEngineDeps>;
  let sent: Array<{ instanceId: string; to: string }>;

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
    const superDbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(superDbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    // Seed: both tenants own an instance and a chat. The agent row is
    // deliberately NULL-tenant — that IS production's shape until the G6
    // persons backfill (agents derives owner_id → persons, G2-`unowned`).
    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);

      INSERT INTO instances (id, name, channel, tenant_id) VALUES
        ('${INSTANCE_A}', 'inst-a', 'whatsapp-baileys', '${TENANT_A}'),
        ('${INSTANCE_B}', 'inst-b', 'whatsapp-baileys', '${TENANT_B}');

      INSERT INTO chats (id, instance_id, external_id, chat_type, channel, tenant_id) VALUES
        ('${CHAT_A}', '${INSTANCE_A}', 'chat-a@s.whatsapp.net', 'dm', 'whatsapp-baileys', '${TENANT_A}'),
        ('${CHAT_B}', '${INSTANCE_B}', 'chat-b@s.whatsapp.net', 'dm', 'whatsapp-baileys', '${TENANT_B}');

      INSERT INTO agents (id, name, provider, agent_type) VALUES
        ('${AGENT_ID}', 'null-tenant-agent', 'agno', 'assistant');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical connection shared by every probe: any bleed shows here.
    const runtimeDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
      1,
    );

    sent = [];
    const capture = sent;
    deps = buildAutomationEngineDeps(createServices(runtimeDb, null), runtimeDb, {
      resolvePlugin: async () =>
        ({
          sendMessage: async (instanceId: string, msg: { to: string }) => {
            capture.push({ instanceId, to: msg.to });
          },
        }) as never,
    });
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test("tenant A's callback resolves A's own chat UUID to its external id", async () => {
    await deps.sendMessage(INSTANCE_A, CHAT_A, 'hello', TENANT_A);
    expect(sent).toEqual([{ instanceId: INSTANCE_A, to: 'chat-a@s.whatsapp.net' }]);
    sent.length = 0;
  }, 30_000);

  test("tenant A's callback cannot resolve tenant B's chat UUID — not found, nothing sent", async () => {
    await expect(deps.sendMessage(INSTANCE_A, CHAT_B, 'leak?', TENANT_A)).rejects.toThrow(
      `Chat not found for UUID: ${CHAT_B}`,
    );
    expect(sent).toEqual([]);
  }, 30_000);

  test("tenant A's callback cannot see tenant B's instance", async () => {
    await expect(deps.sendMessage(INSTANCE_B, CHAT_B, 'leak?', TENANT_A)).rejects.toThrow(/not found/i);
    expect(sent).toEqual([]);
  }, 30_000);

  test('call_agent under a tenant scope refuses the NULL-tenant agent row (G6 gate, fail-closed)', async () => {
    await expect(
      deps.callAgent(
        { instanceId: INSTANCE_A, agentId: AGENT_ID, chatId: CHAT_A, senderId: 'sender-1', messages: ['hi'] },
        { agentId: '' },
        TENANT_A,
      ),
    ).rejects.toThrow(`Agent not found: ${AGENT_ID}`);
  }, 30_000);

  test('a legacy invocation under enforcement is refused outright — the dual world is data, not a branch', async () => {
    // No tenant threaded: the read runs on the ambient (runtime-role) pool with
    // no tenant GUC, and the enforced `omni_current_tenant_id()` guard refuses
    // the transaction rather than silently matching rows. Flag-off
    // byte-identity for the legacy world is asserted by the unit worker-scope
    // probes; under enforcement a scope-less read cannot succeed.
    await expect(deps.sendMessage(INSTANCE_A, CHAT_A, 'legacy', undefined)).rejects.toThrow(
      /app\.tenant_id is not set|not found/i,
    );
    expect(sent).toEqual([]);
  }, 30_000);
});
