/**
 * Two-tenant FOLLOW-UP SWEEPER fan-out over real PostgreSQL
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0003).
 *
 * The sweeper is a CRON path: no envelope, no credential. Its G5 conversion
 * enumerates active tenants on the auth-plane connection and runs one pass per
 * tenant, each DB block in its own short worker scope, stamping every fired
 * event with the row's trusted tenant. This suite proves, against a disposable
 * database:
 *
 *   PHASE 1 (pre-enforcement, flag-on — the transitional mixed state):
 *   * tenant A's due row fires inside A's pass with an A-stamped envelope,
 *     tenant B's inside B's with a B-stamped envelope — never crossed;
 *   * a NULL-tenant legacy row is swept by the transitional legacy pass and
 *     its envelope stays legacy (no version, no tenant);
 *
 *   PHASE 2 (RLS enforcement installed, runtime role):
 *   * the per-tenant passes still fire their own tenants' rows;
 *   * the legacy pass is skipped — a NULL-tenant row stays untouched (the
 *     enforcement state machine forbids that mixed state; nothing ambient
 *     runs against a policed table);
 *   * a SUSPENDED tenant drops out of the enumeration — its due row does not
 *     fire (dequeue-time revalidation for periodic work).
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventBus } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  chatFollowUpState,
  createDbHandle,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { FollowUpSweeperService } from '../follow-up-sweeper';

/** Held in a const so `delete process.env[ENFORCEMENT_ENV]` is a computed
 * member access (satisfies biome's noDelete + useLiteralKeys). */
const ENFORCEMENT_ENV = 'OMNI_DB_ENFORCEMENT';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111fa';
const TENANT_B = '22222222-2222-4222-8222-2222222222fb';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555fa';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555fb';
const INSTANCE_L = '55555555-5555-4555-8555-5555555555fc';
const CHAT_A = '66666666-6666-4666-8666-6666666666fa';
const CHAT_B = '66666666-6666-4666-8666-6666666666fb';
const CHAT_L = '66666666-6666-4666-8666-6666666666fc';
const ROW_A = '77777777-7777-4777-8777-7777777777fa';
const ROW_B = '77777777-7777-4777-8777-7777777777fb';
const ROW_L = '77777777-7777-4777-8777-7777777777fc';

const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

/** A fixed 3-step config whose first fire is due immediately when seeded due. */
const SEQ_CONFIG = JSON.stringify({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'idle {{minutes}}m',
  stopOutsideMessagingWindow: false,
  showTypingIndicator: false,
});

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-sweeper-${crypto.randomUUID()}.sql`);
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

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | undefined;
}

/** An EventBus fake that records publishes (the sweeper only publishes). */
function recordingBus(events: PublishedEvent[]): EventBus {
  return {
    publish: async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      events.push({ type, payload, metadata });
      return { ok: true };
    },
  } as unknown as EventBus;
}

/** Re-seed the three follow-up rows as armed and due NOW. */
function seedDueRows(superDbUrl: string): void {
  const seeded = runSqlOn(
    superDbUrl,
    `
    DELETE FROM chat_follow_up_state
      WHERE id IN ('${ROW_A}', '${ROW_B}', '${ROW_L}');
    INSERT INTO chat_follow_up_state
      (id, chat_id, instance_id, agent_id, sequence_config, sequence_index,
       last_agent_message_at, next_fire_at, disarm_reason, tenant_id)
    VALUES
      ('${ROW_A}', '${CHAT_A}', '${INSTANCE_A}', NULL, '${SEQ_CONFIG}', 0,
       now() - interval '10 minutes', now() - interval '1 minute', NULL, '${TENANT_A}'),
      ('${ROW_B}', '${CHAT_B}', '${INSTANCE_B}', NULL, '${SEQ_CONFIG}', 0,
       now() - interval '10 minutes', now() - interval '1 minute', NULL, '${TENANT_B}'),
      ('${ROW_L}', '${CHAT_L}', '${INSTANCE_L}', NULL, '${SEQ_CONFIG}', 0,
       now() - interval '10 minutes', now() - interval '1 minute', NULL, NULL);
    `,
  );
  if (seeded.exitCode !== 0) throw new Error(`row seed failed: ${seeded.stderr}`);
}

postgresDescribe('two-tenant follow-up sweeper fan-out (real PostgreSQL)', () => {
  const dbName = `omni_g5_sweeper_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  const savedEnv: Record<string, string | undefined> = {};
  let superDbUrl = '';
  let superDb: Database;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  function sweeperOn(pool: Database, authPlane: Database, events: PublishedEvent[]): FollowUpSweeperService {
    const sweeper = new FollowUpSweeperService(pool, recordingBus(events));
    sweeper.setAuthPlane(authPlane);
    return sweeper;
  }

  beforeAll(async () => {
    for (const key of [MULTITENANCY_FLAG_ENV, ENFORCEMENT_ENV]) {
      savedEnv[key] = process.env[key];
    }

    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);
    superDbUrl = urlFor(superUrl, dbName);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    const migrated = runSqlOn(superDbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);

      INSERT INTO instances (id, name, channel, tenant_id, is_active, created_at) VALUES
        ('${INSTANCE_A}', 'inst-a', 'whatsapp-baileys', '${TENANT_A}', true, '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'inst-b', 'whatsapp-baileys', '${TENANT_B}', true, '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_L}', 'inst-legacy', 'whatsapp-baileys', NULL, true, '${SHARED_TIMESTAMP}');

      INSERT INTO chats (id, instance_id, external_id, canonical_id, chat_type, channel, name, tenant_id, created_at)
      VALUES
        ('${CHAT_A}', '${INSTANCE_A}', 'jid-a', 'jid-a', 'direct', 'whatsapp-baileys', 'Chat A',
         '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${INSTANCE_B}', 'jid-b', 'jid-b', 'direct', 'whatsapp-baileys', 'Chat B',
         '${TENANT_B}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_L}', '${INSTANCE_L}', 'jid-l', 'jid-l', 'direct', 'whatsapp-baileys', 'Chat L',
         NULL, '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    superDb = openDb(superDbUrl, 3);
  }, 180_000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  // ── PHASE 1: flag-on, pre-enforcement (the transitional mixed state) ──────

  test('pre-enforcement: each tenant pass fires its own row with its own stamp; the legacy pass fires the NULL row unstamped', async () => {
    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    delete process.env[ENFORCEMENT_ENV];
    seedDueRows(superDbUrl);

    const events: PublishedEvent[] = [];
    const stats = await sweeperOn(superDb, superDb, events).sweep();

    expect(stats.fired).toBe(3);

    const fired = events.filter((e) => e.type === 'chat.idle_timeout');
    const byChat = new Map(fired.map((e) => [e.payload.chatId as string, e]));
    expect(byChat.get(CHAT_A)?.metadata?.tenantId).toBe(TENANT_A);
    expect(byChat.get(CHAT_B)?.metadata?.tenantId).toBe(TENANT_B);
    // The legacy row's envelope carries NO tenant claim at all.
    expect(byChat.get(CHAT_L)?.metadata && 'tenantId' in (byChat.get(CHAT_L)?.metadata ?? {})).toBe(false);

    // Every row advanced exactly once.
    const rows = await superDb
      .select({ id: chatFollowUpState.id, sequenceIndex: chatFollowUpState.sequenceIndex })
      .from(chatFollowUpState);
    expect(new Map(rows.map((r) => [r.id, r.sequenceIndex]))).toEqual(
      new Map([
        [ROW_A, 1],
        [ROW_B, 1],
        [ROW_L, 1],
      ]),
    );
  });

  test('flag-off is the single pre-G5 pass: no enumeration, every row swept ambient, no envelope stamped', async () => {
    delete process.env[MULTITENANCY_FLAG_ENV];
    delete process.env[ENFORCEMENT_ENV];
    seedDueRows(superDbUrl);

    const events: PublishedEvent[] = [];
    // No auth plane injected on purpose: the flag-off path must never need it.
    const sweeper = new FollowUpSweeperService(superDb, recordingBus(events));
    const stats = await sweeper.sweep();

    expect(stats.fired).toBe(3);
    for (const event of events) {
      expect(event.metadata && 'tenantId' in event.metadata).toBe(false);
      expect(event.metadata && 'envelopeVersion' in event.metadata).toBe(false);
    }
  });

  // ── PHASE 2: RLS enforcement installed, runtime + auth-plane roles ────────

  test('enforced: per-tenant passes fire their own rows; the NULL-tenant row is untouched (no ambient pass exists)', async () => {
    // Install enforcement ONCE, then run everything below as the runtime role.
    await applyTenantRlsEnforcement(superDb);
    await applyTenancyRoles(superDb, passwords, DEFAULT_ROLE_NAMES, dbName);
    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    process.env[ENFORCEMENT_ENV] = 'on';
    seedDueRows(superDbUrl);

    const runtimeDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
      1,
    );
    const authPlaneDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }),
      1,
    );

    const events: PublishedEvent[] = [];
    const stats = await sweeperOn(runtimeDb, authPlaneDb, events).sweep();

    expect(stats.fired).toBe(2);
    const fired = events.filter((e) => e.type === 'chat.idle_timeout');
    const byChat = new Map(fired.map((e) => [e.payload.chatId as string, e]));
    expect(byChat.get(CHAT_A)?.metadata?.tenantId).toBe(TENANT_A);
    expect(byChat.get(CHAT_B)?.metadata?.tenantId).toBe(TENANT_B);
    expect(byChat.has(CHAT_L)).toBe(false);

    // A's row is visible inside A's scope and advanced; the NULL-tenant row
    // never fired (checked via the superuser handle — it is invisible to every
    // tenant scope, which is the point).
    const scopedA = await runInWorkerTenantScope(runtimeDb, TENANT_A, async () =>
      scopedHandle(runtimeDb)
        .select({ sequenceIndex: chatFollowUpState.sequenceIndex })
        .from(chatFollowUpState)
        .where(eq(chatFollowUpState.id, ROW_A)),
    );
    expect(scopedA).toEqual([{ sequenceIndex: 1 }]);
    const legacyRow = await superDb
      .select({ sequenceIndex: chatFollowUpState.sequenceIndex })
      .from(chatFollowUpState)
      .where(eq(chatFollowUpState.id, ROW_L));
    expect(legacyRow).toEqual([{ sequenceIndex: 0 }]);
  });

  test('enforced: a suspended tenant drops out of the enumeration — its due row does not fire', async () => {
    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    process.env[ENFORCEMENT_ENV] = 'on';
    seedDueRows(superDbUrl);
    const suspended = runSqlOn(superDbUrl, `UPDATE tenants SET status = 'suspended' WHERE id = '${TENANT_B}';`);
    if (suspended.exitCode !== 0) throw new Error(`suspend failed: ${suspended.stderr}`);

    const runtimeDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
      1,
    );
    const authPlaneDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }),
      1,
    );

    const events: PublishedEvent[] = [];
    const stats = await sweeperOn(runtimeDb, authPlaneDb, events).sweep();

    expect(stats.fired).toBe(1);
    const fired = events.filter((e) => e.type === 'chat.idle_timeout');
    expect(fired.map((e) => e.payload.chatId)).toEqual([CHAT_A]);

    // B's row is exactly where it was seeded — suspended work never dequeues.
    const rowB = await superDb
      .select({ sequenceIndex: chatFollowUpState.sequenceIndex })
      .from(chatFollowUpState)
      .where(eq(chatFollowUpState.id, ROW_B));
    expect(rowB).toEqual([{ sequenceIndex: 0 }]);
  });
});
