/**
 * Two-tenant SYNC-JOB containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * `sync_jobs` is one of the job tables ADR-0008 names explicitly ("Jobs, retries,
 * dead letters, idempotency keys, consumer state, and callbacks preserve tenant
 * context"). Its registry site was `pending-G5-conversion` for the dual-caller
 * reason: `SyncJobService` already read through `scopedHandle`, but its WORKER
 * callers — the daily contacts/groups crons and the `sync.started` /
 * `instance.connected` consumers — established no scope, so every worker-created
 * job reached the ambient pool.
 *
 * The service now takes a THREADED trusted tenant rather than being wrapped by
 * its callers, because every mutating method writes the row AND publishes a
 * `sync.*` event: a scope held across that publish would make the event a
 * pre-commit side effect. This suite drives the service exactly as those callers
 * now do and pins:
 *
 *   * a threaded tenant lands the row under that tenant and nowhere else;
 *   * a job created for ANOTHER tenant's instance is refused by the WITH CHECK
 *     (`sync_jobs` derives its tenant from the REQUIRED `instance_id` parent);
 *   * every read path (`getById`, `getActiveForInstance`, `hasActiveJob`) and
 *     every mutation (`start`, `complete`, `fail`, `updateProgress`) is confined
 *     to the threaded tenant;
 *   * the published envelope carries the tenant the ROW was stamped with, so the
 *     downstream `sync.started` consumer derives from persisted ownership.
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
  createDbHandle,
} from '@omni/db';
import { SyncJobService } from '../sync-jobs';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-11111111aa1a';
const TENANT_B = '22222222-2222-4222-8222-22222222bb2b';
const INSTANCE_A = '55555555-5555-4555-8555-55555555aa1a';
const INSTANCE_B = '55555555-5555-4555-8555-55555555bb2b';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-syncjobs-${crypto.randomUUID()}.sql`);
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

/** Records what a publish was told, so the envelope tenant can be asserted. */
interface CapturedPublish {
  type: string;
  metadata: Record<string, unknown> | undefined;
}

postgresDescribe('two-tenant sync-job containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_syncjobs_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  let service: SyncJobService;
  const published: CapturedPublish[] = [];

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

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'job-tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'job-tenant-b', 'Tenant B', 86400, 100, 100);

      INSERT INTO instances (id, name, channel, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'job-inst-a', 'whatsapp-baileys', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'job-inst-b', 'whatsapp-baileys', '${TENANT_B}', '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // maxConnections=2 — see the sibling suites: a worker transaction holds one,
    // so an unscoped ambient read takes the other and fails LOUDLY under RLS
    // rather than deadlocking.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 2);

    const eventBus = {
      publish: async (type: string, _payload: unknown, metadata?: Record<string, unknown>) => {
        published.push({ type, metadata });
        return { eventId: 'e', subject: 's' };
      },
    } as unknown as EventBus;
    service = new SyncJobService(runtimeDb, eventBus);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('a threaded tenant lands the job under that tenant, and stamps the published envelope', async () => {
    published.length = 0;
    const job = await service.create({
      instanceId: INSTANCE_A,
      channelType: 'whatsapp-baileys',
      type: 'contacts',
      tenantId: TENANT_A,
    });

    expect(job.tenantId).toBe(TENANT_A);

    // The `sync.started` publish carries the tenant the ROW was stamped with, so
    // the consumer derives its worker scope from persisted ownership rather than
    // from whatever scope happened to be active at publish time.
    const started = published.find((p) => p.type === 'sync.started');
    expect(started?.metadata?.tenantId).toBe(TENANT_A);

    // Visible to A...
    expect((await service.getById(job.id, TENANT_A)).id).toBe(job.id);
    // ...and entirely invisible to B, which cannot even learn it exists.
    await expect(service.getById(job.id, TENANT_B)).rejects.toThrow(/not found/i);
  });

  test('a job for ANOTHER tenant’s instance is refused by RLS, not silently mis-stamped', async () => {
    await expect(
      service.create({
        instanceId: INSTANCE_A,
        channelType: 'whatsapp-baileys',
        type: 'groups',
        tenantId: TENANT_B,
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  test('the read paths a worker uses are confined to the threaded tenant', async () => {
    const aJob = await service.create({
      instanceId: INSTANCE_A,
      channelType: 'whatsapp-baileys',
      type: 'history-push',
      tenantId: TENANT_A,
    });
    await service.start(aJob.id, TENANT_A);

    // This is the exact pair the history-push tracker calls.
    const aActive = await service.getActiveForInstance(INSTANCE_A, TENANT_A);
    expect(aActive.map((j) => j.id)).toContain(aJob.id);
    expect(await service.hasActiveJob(INSTANCE_A, 'history-push', TENANT_A)).toBe(true);

    // B asking about A's instance sees no jobs and reports no active job — so a
    // B-scoped tracker never creates a duplicate against A's work, and never
    // learns A has any.
    expect(await service.getActiveForInstance(INSTANCE_A, TENANT_B)).toEqual([]);
    expect(await service.hasActiveJob(INSTANCE_A, 'history-push', TENANT_B)).toBe(false);

    // And B's own instance is unaffected by A's job.
    expect(await service.hasActiveJob(INSTANCE_B, 'history-push', TENANT_B)).toBe(false);
  });

  test('mutations cannot reach across tenants', async () => {
    const aJob = await service.create({
      instanceId: INSTANCE_A,
      channelType: 'whatsapp-baileys',
      type: 'messages',
      tenantId: TENANT_A,
    });

    // B cannot advance, finish, or fail A's job: the row is not in its scope, so
    // each lands as "not found" rather than as a cross-tenant write.
    await expect(service.start(aJob.id, TENANT_B)).rejects.toThrow(/not found/i);
    await expect(service.complete(aJob.id, TENANT_B)).rejects.toThrow(/not found/i);
    await expect(service.fail(aJob.id, 'forged', TENANT_B)).rejects.toThrow(/not found/i);
    await expect(service.updateProgress(aJob.id, { fetched: 99 }, TENANT_B)).rejects.toThrow(/not found/i);

    // A's own job is untouched and still advances normally.
    expect((await service.getById(aJob.id, TENANT_A)).status).toBe('pending');
    await service.updateProgress(aJob.id, { fetched: 7 }, TENANT_A);
    const done = await service.complete(aJob.id, TENANT_A);
    expect(done.status).toBe('completed');
    expect((done.progress as { fetched: number }).fetched).toBe(7);
  });
});
