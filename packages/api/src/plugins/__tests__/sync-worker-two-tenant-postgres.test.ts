/**
 * Two-tenant SYNC-WORKER containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * The `sync-worker` plugin is a `sync.started` NATS consumer. Its two tenant-table
 * access sites were the `pending-G5-conversion` sites:
 *   - `omni_groups` — the per-group upsert in the `onGroup`/`onGuild` callbacks
 *     (extracted here as `__test__.upsertSyncedGroup`);
 *   - `messages`    — the raw-SQL anchor read `__test__.buildWhatsAppAnchors`.
 *
 * Before G5 both ran on the ambient pool with no tenant context. This proves the
 * converted seams — the exact functions the consumer calls — stay inside the
 * work item's tenant when run under `runInWorkerTenantScope`, and that neither
 * a read nor a write leaks across to another tenant.
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
  omniGroups,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { __test__ as syncWorkerTest } from '../sync-worker';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111da';
const TENANT_B = '22222222-2222-4222-8222-2222222222db';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555da';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555db';
const CHAT_A = '66666666-6666-4666-8666-6666666666da';
const CHAT_B = '66666666-6666-4666-8666-6666666666db';
const MESSAGE_A = '77777777-7777-4777-8777-7777777777da';
const MESSAGE_B = '77777777-7777-4777-8777-7777777777db';

const JID_A = '5511999990001@s.whatsapp.net';
const JID_B = '5511999990002@s.whatsapp.net';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-sync-${crypto.randomUUID()}.sql`);
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

postgresDescribe('two-tenant sync-worker containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_sync_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  /** Read a tenant's omni_groups rows for an externalId, as a worker would. */
  const groupsForTenant = (tenantId: string, externalId: string): Promise<{ id: string; name: string | null }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ id: omniGroups.id, name: omniGroups.name })
        .from(omniGroups)
        .where(eq(omniGroups.externalId, externalId)),
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

      INSERT INTO instances (id, name, channel, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'inst-a', 'whatsapp-baileys', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'inst-b', 'whatsapp-baileys', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO chats (id, instance_id, external_id, canonical_id, chat_type, channel, name, tenant_id, created_at)
      VALUES
        ('${CHAT_A}', '${INSTANCE_A}', '${JID_A}', '${JID_A}', 'direct', 'whatsapp-baileys', 'Chat A',
         '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${INSTANCE_B}', '${JID_B}', '${JID_B}', 'direct', 'whatsapp-baileys', 'Chat B',
         '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO messages (id, chat_id, external_id, source, message_type, platform_timestamp, raw_payload, tenant_id)
      VALUES
        ('${MESSAGE_A}', '${CHAT_A}', 'wamid.A', 'sync', 'text', '${SHARED_TIMESTAMP}',
         '{"key":{"id":"wamid.A","remoteJid":"${JID_A}","fromMe":false}}', '${TENANT_A}'),
        ('${MESSAGE_B}', '${CHAT_B}', 'wamid.B', 'sync', 'text', '${SHARED_TIMESTAMP}',
         '{"key":{"id":"wamid.B","remoteJid":"${JID_B}","fromMe":false}}', '${TENANT_B}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // maxConnections=2: the worker tenant transaction holds one; a raw-pool
    // access (the un-converted state) would take the OTHER, so the pre-G5
    // failure surfaces as an RLS rejection rather than a single-connection
    // deadlock — a fast, deterministic RED.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 2);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('upsertSyncedGroup writes a group only under its worker tenant; the other tenant cannot see it', async () => {
    const outcome = await runInWorkerTenantScope(runtimeDb, TENANT_A, () =>
      syncWorkerTest.upsertSyncedGroup(runtimeDb, INSTANCE_A, 'whatsapp-baileys', {
        externalId: 'group-a@g.us',
        name: 'A group',
      }),
    );
    expect(outcome).toBe('stored');

    // Visible to A, invisible to B.
    expect((await groupsForTenant(TENANT_A, 'group-a@g.us')).map((r) => r.name)).toEqual(['A group']);
    expect((await groupsForTenant(TENANT_B, 'group-a@g.us')).length).toBe(0);

    // A second upsert of the same group under A takes the update path (the
    // select-existing read is itself scoped).
    const second = await runInWorkerTenantScope(runtimeDb, TENANT_A, () =>
      syncWorkerTest.upsertSyncedGroup(runtimeDb, INSTANCE_A, 'whatsapp-baileys', {
        externalId: 'group-a@g.us',
        name: 'A group renamed',
      }),
    );
    expect(second).toBe('updated');
    expect((await groupsForTenant(TENANT_A, 'group-a@g.us')).map((r) => r.name)).toEqual(['A group renamed']);
  });

  test('a B worker cannot write a group on A’s instance — RLS rejects the cross-tenant insert', async () => {
    // B's select cannot see A's row (RLS), so it takes the INSERT path. The
    // omni_groups WITH CHECK is derived from instance ownership, and INSTANCE_A
    // belongs to A, so B's insert is rejected outright rather than landing a
    // stray B-row. (In the live consumer `onGroup` swallows this and continues.)
    await expect(
      runInWorkerTenantScope(runtimeDb, TENANT_B, () =>
        syncWorkerTest.upsertSyncedGroup(runtimeDb, INSTANCE_A, 'whatsapp-baileys', {
          externalId: 'group-a@g.us',
          name: 'B overwrite attempt',
        }),
      ),
    ).rejects.toThrow(/row-level security/i);

    // A's row is untouched; B has no row at all.
    expect((await groupsForTenant(TENANT_A, 'group-a@g.us')).map((r) => r.name)).toEqual(['A group renamed']);
    expect((await groupsForTenant(TENANT_B, 'group-a@g.us')).length).toBe(0);
  });

  test('buildWhatsAppAnchors reads only the worker tenant’s messages', async () => {
    // Under A's scope, A's seeded message yields exactly one anchor.
    const aAnchors = await runInWorkerTenantScope(runtimeDb, TENANT_A, () =>
      syncWorkerTest.buildWhatsAppAnchors(runtimeDb, INSTANCE_A),
    );
    expect(aAnchors.map((a) => a.messageKey.id)).toEqual(['wamid.A']);

    // B cannot see A's instance data — RLS hides A's chats/messages entirely.
    const bViewOfA = await runInWorkerTenantScope(runtimeDb, TENANT_B, () =>
      syncWorkerTest.buildWhatsAppAnchors(runtimeDb, INSTANCE_A),
    );
    expect(bViewOfA.length).toBe(0);

    // And B sees its OWN instance's anchor.
    const bAnchors = await runInWorkerTenantScope(runtimeDb, TENANT_B, () =>
      syncWorkerTest.buildWhatsAppAnchors(runtimeDb, INSTANCE_B),
    );
    expect(bAnchors.map((a) => a.messageKey.id)).toEqual(['wamid.B']);
  });
});
