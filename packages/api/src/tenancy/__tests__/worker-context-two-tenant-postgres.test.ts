/**
 * Two-tenant WORKER-context containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * `two-tenant-adversarial-postgres.test.ts` proves a REQUEST scope contains. This
 * asks the async question G5 owns: when a consumer establishes its tenant from a
 * versioned envelope via `runInWorkerTenantScope` — no request, no credential —
 * does its DB work stay inside that tenant, and does a producer LYING about the
 * tenant get rejected by the server-side ownership derivation rather than
 * trusted?
 *
 * It exercises the real converted consumer (`setupEventPersistence`) end to end:
 * the same handler the NATS subscription calls, driven with tenant-A and
 * tenant-B envelopes against the runtime role under FORCE RLS.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventBus, OmniEvent } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
  omniEvents,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { setupEventPersistence } from '../../plugins/event-persistence';
import { InstanceService } from '../../services/instances';
import { scopedHandle } from '../tenant-scope';
import { runInWorkerTenantScope } from '../worker-tenant-context';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const INSTANCE_A = '55555555-5555-4555-8555-55555555555a';
const INSTANCE_B = '55555555-5555-4555-8555-55555555555b';
const CHAT_A = '66666666-6666-4666-8666-66666666666a';
const CHAT_B = '66666666-6666-4666-8666-66666666666b';

const SHARED_JID = '5511999990000@s.whatsapp.net';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-${crypto.randomUUID()}.sql`);
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

/** A message.received envelope for `instanceId`, optionally stamped for a tenant. */
function receivedEvent(
  instanceId: string,
  externalId: string,
  tenant: { envelopeVersion: number; tenantId: string } | null,
): OmniEvent {
  return {
    id: crypto.randomUUID(),
    type: 'message.received',
    timestamp: Date.now(),
    payload: {
      externalId,
      chatId: SHARED_JID,
      from: 'someone',
      content: { type: 'text', text: 'hello' },
    },
    metadata: {
      correlationId: crypto.randomUUID(),
      instanceId,
      channelType: 'whatsapp-baileys',
      ...(tenant ?? {}),
    },
  } as OmniEvent;
}

postgresDescribe('two-tenant worker-context containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  let instances: InstanceService;

  /** The captured NATS handlers, keyed by event type. */
  const handlers = new Map<string, (event: unknown) => Promise<void>>();

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  /** Read this tenant's omni_events rows for an externalId, as a worker would. */
  const eventsForTenant = (tenantId: string, externalId: string): Promise<{ id: string }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ id: omniEvents.id })
        .from(omniEvents)
        .where(eq(omniEvents.externalId, externalId)),
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

      -- Same external JID on both sides: only tenant_id distinguishes them.
      INSERT INTO chats (id, instance_id, external_id, canonical_id, chat_type, channel, name, tenant_id, created_at)
      VALUES
        ('${CHAT_A}', '${INSTANCE_A}', '${SHARED_JID}', '${SHARED_JID}', 'direct', 'whatsapp-baileys',
         'Chat', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${INSTANCE_B}', '${SHARED_JID}', '${SHARED_JID}', 'direct', 'whatsapp-baileys',
         'Chat', '${TENANT_B}', '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical connection shared by both tenants' workers: any bleed shows
    // here rather than being hidden by pool luck.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 1);
    instances = new InstanceService(runtimeDb, null);

    // Capture the real consumer handlers exactly as the NATS bus would.
    const captureBus = {
      subscribe: async (type: string, handler: (event: unknown) => Promise<void>) => {
        handlers.set(type, handler);
      },
    } as unknown as EventBus;
    await setupEventPersistence(captureBus, runtimeDb);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  describe('a worker scope contains a real service to one tenant', () => {
    test('a worker for A lists only A instances; a worker for B only B', async () => {
      const a = await runInWorkerTenantScope(runtimeDb, TENANT_A, () => instances.list());
      const b = await runInWorkerTenantScope(runtimeDb, TENANT_B, () => instances.list());
      expect(a.items.map((i) => i.id)).toEqual([INSTANCE_A]);
      expect(b.items.map((i) => i.id)).toEqual([INSTANCE_B]);
    });

    test('a worker for A cannot fetch B’s instance by its real id (not-found, as if it never existed)', async () => {
      // `getById` throws NotFoundError for a foreign id exactly as for a
      // nonexistent one — the row is invisible under A's scope, so there is no
      // oracle distinguishing "belongs to B" from "does not exist".
      await expect(runInWorkerTenantScope(runtimeDb, TENANT_A, () => instances.getById(INSTANCE_B))).rejects.toThrow();
      await expect(
        runInWorkerTenantScope(runtimeDb, TENANT_A, () => instances.getById('00000000-0000-4000-8000-000000000000')),
      ).rejects.toThrow();
    });
  });

  describe('event-persistence consumer isolates by envelope tenant', () => {
    test('an A-stamped event lands only under tenant A; a B-stamped event only under B', async () => {
      const received = handlers.get('message.received');
      if (!received) throw new Error('message.received handler not captured');

      const extA = `ext-a-${crypto.randomUUID()}`;
      const extB = `ext-b-${crypto.randomUUID()}`;
      await received(receivedEvent(INSTANCE_A, extA, { envelopeVersion: 1, tenantId: TENANT_A }));
      await received(receivedEvent(INSTANCE_B, extB, { envelopeVersion: 1, tenantId: TENANT_B }));

      // A sees its own event and NOT B's; B sees its own and NOT A's.
      expect((await eventsForTenant(TENANT_A, extA)).length).toBe(1);
      expect((await eventsForTenant(TENANT_B, extA)).length).toBe(0);
      expect((await eventsForTenant(TENANT_B, extB)).length).toBe(1);
      expect((await eventsForTenant(TENANT_A, extB)).length).toBe(0);
    });

    test('a producer LYING about tenant is rejected by server-side ownership, not trusted', async () => {
      const received = handlers.get('message.received');
      if (!received) throw new Error('message.received handler not captured');

      // Envelope claims tenant B, but the instance it names is owned by A. The
      // BEFORE INSERT derivation trigger stamps tenant_id from the instance (A);
      // under the worker's B scope the RLS WITH CHECK (A = B) rejects it. The
      // handler swallows the error (best-effort persistence) — the point is that
      // NO row lands under EITHER tenant, so the lie buys nothing.
      const extLie = `ext-lie-${crypto.randomUUID()}`;
      await received(receivedEvent(INSTANCE_A, extLie, { envelopeVersion: 1, tenantId: TENANT_B }));

      expect((await eventsForTenant(TENANT_A, extLie)).length).toBe(0);
      expect((await eventsForTenant(TENANT_B, extLie)).length).toBe(0);
    });
  });
});
