/**
 * Two-tenant MEDIA-PROCESSOR containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * The `media-processor` plugin is a NATS consumer: it downloads a message's
 * media, runs it through the AI processing service, then writes the result back
 * to `messages` and an audit row to `media_content`. Those two writes are the
 * only tenant-table access the plugin owns, and before G5 they ran on the
 * ambient pool with no tenant context — the `pending-G5-conversion` sites.
 *
 * This proves the converted persistence path (`__test__.persistProcessingResult`,
 * the exact code the consumer calls) stays inside the worker's tenant when it is
 * run under `runInWorkerTenantScope`, and that a write aimed at ANOTHER tenant's
 * message buys nothing — the ambient derivation + RLS WITH CHECK reject it rather
 * than trusting the caller.
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
  mediaContent,
  messages,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { __test__ as mediaProcessorTest } from '../media-processor';

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
const MESSAGE_A = '77777777-7777-4777-8777-7777777777ca';
const MESSAGE_B = '77777777-7777-4777-8777-7777777777cb';
const EVENT_A = '88888888-8888-4888-8888-8888888888ca';
const EVENT_B = '88888888-8888-4888-8888-8888888888cb';

const SHARED_JID = '5511999990000@s.whatsapp.net';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

type PersistResult = Parameters<typeof mediaProcessorTest.persistProcessingResult>[3];

/** A minimal successful transcription result. */
function transcription(text: string): PersistResult {
  return {
    success: true,
    processingType: 'transcription',
    content: text,
    model: 'test-model',
    provider: 'test-provider',
    language: 'en',
    duration: 1,
    processingTimeMs: 5,
  } as unknown as PersistResult;
}

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-media-${crypto.randomUUID()}.sql`);
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

postgresDescribe('two-tenant media-processor containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_media_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  // The plugin only reads `ctx.db` in the persistence path; a minimal ctx suffices.
  let ctx: Parameters<typeof mediaProcessorTest.persistProcessingResult>[0];

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  /** Count this tenant's media_content rows for a mediaId, as a worker would. */
  const mediaForTenant = (tenantId: string, mediaId: string): Promise<{ id: string }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ id: mediaContent.id })
        .from(mediaContent)
        .where(eq(mediaContent.mediaId, mediaId)),
    );

  /** Read a message's transcription under a tenant scope. */
  const transcriptionForTenant = (tenantId: string, messageId: string): Promise<(string | null)[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ t: messages.transcription })
        .from(messages)
        .where(eq(messages.id, messageId))
        .then((rows) => rows.map((r) => r.t)),
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
        ('${CHAT_A}', '${INSTANCE_A}', '${SHARED_JID}', '${SHARED_JID}', 'direct', 'whatsapp-baileys', 'Chat',
         '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${INSTANCE_B}', '${SHARED_JID}', '${SHARED_JID}', 'direct', 'whatsapp-baileys', 'Chat',
         '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO messages (id, chat_id, external_id, source, message_type, platform_timestamp, tenant_id)
      VALUES
        ('${MESSAGE_A}', '${CHAT_A}', 'msg-a', 'realtime', 'audio', '${SHARED_TIMESTAMP}', '${TENANT_A}'),
        ('${MESSAGE_B}', '${CHAT_B}', 'msg-b', 'realtime', 'audio', '${SHARED_TIMESTAMP}', '${TENANT_B}');

      INSERT INTO omni_events (id, instance_id, channel, event_type, external_id, tenant_id)
      VALUES
        ('${EVENT_A}', '${INSTANCE_A}', 'whatsapp-baileys', 'message.received', 'msg-a', '${TENANT_A}'),
        ('${EVENT_B}', '${INSTANCE_B}', 'whatsapp-baileys', 'message.received', 'msg-b', '${TENANT_B}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical connection shared by both tenants' workers: any bleed shows here.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 1);
    ctx = { db: runtimeDb } as Parameters<typeof mediaProcessorTest.persistProcessingResult>[0];
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('A worker persists media only under A; B cannot see it', async () => {
    await runInWorkerTenantScope(runtimeDb, TENANT_A, () =>
      mediaProcessorTest.persistProcessingResult(ctx, MESSAGE_A, EVENT_A, transcription('hello from A'), 'audio'),
    );

    // The message transcription landed under A and only A.
    expect(await transcriptionForTenant(TENANT_A, MESSAGE_A)).toEqual(['hello from A']);
    // The audit row is visible to A, invisible to B.
    expect((await mediaForTenant(TENANT_A, MESSAGE_A)).length).toBe(1);
    expect((await mediaForTenant(TENANT_B, MESSAGE_A)).length).toBe(0);
  });

  test("a B worker aiming at A's message writes nothing under either tenant", async () => {
    // A B-scoped worker tries to persist for A's message + A's event. RLS hides
    // A's message from B's UPDATE (0 rows), and the media_content WITH CHECK
    // rejects the A-derived tenant under B's scope — the insert is swallowed as
    // non-critical. Nothing lands, and A's earlier legit row is untouched.
    await runInWorkerTenantScope(runtimeDb, TENANT_B, () =>
      mediaProcessorTest.persistProcessingResult(
        ctx,
        MESSAGE_A,
        EVENT_A,
        transcription('B overwrite attempt'),
        'audio',
      ),
    );

    // A still sees exactly its own single row and original transcription.
    expect(await transcriptionForTenant(TENANT_A, MESSAGE_A)).toEqual(['hello from A']);
    expect((await mediaForTenant(TENANT_A, MESSAGE_A)).length).toBe(1);
    expect((await mediaForTenant(TENANT_B, MESSAGE_A)).length).toBe(0);
  });
});
