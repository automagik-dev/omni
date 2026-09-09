/**
 * Durable event consumers over real PostgreSQL (#989, RFC #925 G7).
 *
 * The full contract, end to end against a migrated disposable database:
 *  - events journaled through the REAL `custom.>` subscriber get monotonic
 *    `journal_seq` values (the cursor's total order);
 *  - register → pull pages strictly-after-cursor in journal_seq order →
 *    ack advances → a re-pull (disconnect/resume) starts exactly after the
 *    last ack;
 *  - acks are monotonic: equal = idempotent no-op, behind = refused;
 *  - trailing-* type globs and payload conditions (the events-wait matcher)
 *    are honored, and the scanned cursor advances past filtered-out rows;
 *  - `startFrom: 'now'` skips history, `'beginning'` replays it;
 *  - lag = journal head minus cursor;
 *  - two-tenant containment: under RLS enforcement a tenant-scoped pull only
 *    ever pages its own tenant's journal rows (automation-actions two-tenant
 *    suite precedent).
 *
 * Set `OMNI_G3_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBus } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
  durableConsumers,
  omniEvents,
} from '@omni/db';
import { driverRejection, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { setupEventPersistence } from '../plugins/event-persistence';
import { EventConsumerService } from '../services/event-consumers';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '22222222-2222-4222-8222-2222222222bb';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555aa';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555bb';

function urlFor(base: string, database: string, user?: { name: string; password: string }): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-989-consumers-${crypto.randomUUID()}.sql`);
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

type CustomEventHandler = (event: {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  metadata: Record<string, unknown>;
}) => Promise<void>;

/** Capture the real `custom.>` subscriber handler via a mock bus (events-custom-journal precedent). */
async function captureCustomHandler(db: Database): Promise<CustomEventHandler> {
  const subscriptions = new Map<string, CustomEventHandler>();
  const mockBus = {
    subscribe: async () => {},
    subscribePattern: async (pattern: string, handler: CustomEventHandler) => {
      subscriptions.set(pattern, handler);
    },
  } as unknown as EventBus;

  await setupEventPersistence(mockBus, db);
  const handler = subscriptions.get('custom.>');
  if (!handler) throw new Error('custom.> subscriber was not registered');
  return handler;
}

postgresDescribe('durable event consumers (#989, real PostgreSQL)', () => {
  const dbName = `omni_dc989_${randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let handler: CustomEventHandler;
  let service: EventConsumerService;
  let published: Array<{ type: string; payload: Record<string, unknown> }>;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  /** Journal one custom event through the real subscriber handler. */
  async function journal(type: string, payload: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await handler({ id, type, payload, timestamp: Date.now(), metadata: { correlationId: randomUUID() } });
    return id;
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    db = openDb(urlFor(superUrl, dbName), 3);
    handler = await captureCustomHandler(db);

    published = [];
    const capture = published;
    const stubBus = {
      publishGeneric: async (type: string, payload: Record<string, unknown>) => {
        capture.push({ type, payload });
        return { id: randomUUID() };
      },
    } as unknown as EventBus;
    service = new EventConsumerService(db, stubBus);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  describe('journal_seq total order', () => {
    test('journaled events carry strictly increasing journal_seq', async () => {
      const a = await journal('custom.dc989-seq.one');
      const b = await journal('custom.dc989-seq.two');
      const rows = await db.select().from(omniEvents);
      const seqA = rows.find((r) => r.id === a)?.journalSeq;
      const seqB = rows.find((r) => r.id === b)?.journalSeq;
      if (seqA == null || seqB == null) throw new Error('journal_seq missing');
      expect(Number(seqB)).toBeGreaterThan(Number(seqA));
    });
  });

  describe('register → pull → ack → resume', () => {
    const ids: string[] = [];

    beforeAll(async () => {
      await service.create({ name: 'pager', eventType: 'custom.dc989-page.*', startFrom: 'beginning' });
      for (let i = 0; i < 5; i++) {
        ids.push(await journal(`custom.dc989-page.ev${i}`, { i }));
      }
    });

    test('creation publishes system.consumer.created', () => {
      const created = published.filter((p) => p.type === 'system.consumer.created');
      expect(created.map((p) => p.payload.name)).toContain('pager');
    });

    test('pull pages in journal_seq order and ack advances the cursor', async () => {
      const page1 = await service.pull('pager', { limit: 2 });
      expect(page1.items.map((e) => e.id)).toEqual(ids.slice(0, 2));
      expect(page1.hasMore).toBe(true);

      // Pull WITHOUT ack re-delivers the same page (at-least-once).
      const again = await service.pull('pager', { limit: 2 });
      expect(again.items.map((e) => e.id)).toEqual(ids.slice(0, 2));

      await service.ack('pager', page1.cursor);
      const page2 = await service.pull('pager', { limit: 2 });
      expect(page2.items.map((e) => e.id)).toEqual(ids.slice(2, 4));
    });

    test('disconnect/re-follow resumes exactly-after-cursor (state is server-side)', async () => {
      // A "reconnect" is just a fresh service over the same database.
      const reconnected = new EventConsumerService(db, null);
      const stored = await reconnected.getByName('pager');
      const page = await reconnected.pull('pager', { limit: 10 });
      expect(page.items.every((e) => Number(e.journalSeq) > stored.cursor)).toBe(true);
      expect(page.items.map((e) => e.id)).toEqual(ids.slice(2, 5));
    });

    test('acking backwards is refused; an equal ack is an idempotent no-op', async () => {
      const full = await service.pull('pager', { limit: 10 });
      const acked = await service.ack('pager', full.cursor);
      expect(acked.cursor).toBe(full.cursor);

      // Equal: no-op success (client retry).
      const again = await service.ack('pager', full.cursor);
      expect(again.cursor).toBe(full.cursor);

      // Behind: refused, cursor unchanged.
      await expect(service.ack('pager', full.cursor - 1)).rejects.toThrow(/monotonic/);
      expect((await service.getByName('pager')).cursor).toBe(full.cursor);
    });

    test('lag is journal head minus cursor', async () => {
      const inspected = await service.inspect('pager');
      expect(inspected.lag).toBe(inspected.head - inspected.cursor);
      // 'pager' is fully acked to its last matching row; only rows journaled
      // AFTER that (other suites' types included) contribute to lag.
      expect(inspected.lag).toBeGreaterThanOrEqual(0);
    });

    test('ack on an unknown consumer is not-found', async () => {
      await expect(service.ack('never-registered', 1)).rejects.toThrow(/not found/i);
    });
  });

  describe('filters', () => {
    test('trailing-* glob matches the prefix and nothing else', async () => {
      await service.create({ name: 'globber', eventType: 'custom.dc989-glob.*', startFrom: 'beginning' });
      const inGlob = await journal('custom.dc989-glob.alpha');
      await journal('custom.dc989-other.beta');

      const page = await service.pull('globber', { limit: 100 });
      expect(page.items.map((e) => e.id)).toEqual([inGlob]);
    });

    test('payload conditions use the events-wait matcher; the scanned cursor skips non-matches', async () => {
      await service.create({
        name: 'filtered',
        eventType: 'custom.dc989-filter.*',
        filters: [{ field: 'status', operator: 'eq', value: 'open' }],
        startFrom: 'beginning',
      });
      const open1 = await journal('custom.dc989-filter.a', { status: 'open' });
      await journal('custom.dc989-filter.b', { status: 'closed' });
      const open2 = await journal('custom.dc989-filter.c', { status: 'open' });

      const page = await service.pull('filtered', { limit: 100 });
      expect(page.items.map((e) => e.id)).toEqual([open1, open2]);

      // The returned cursor covers the SCANNED range (including the closed
      // row): acking it means a re-pull yields nothing — no re-scan loop.
      await service.ack('filtered', page.cursor);
      const after = await service.pull('filtered', { limit: 100 });
      expect(after.items).toEqual([]);
      expect(after.cursor).toBe(page.cursor);
    });

    test('nested-path conditions match (dot notation, same as events wait --filter)', async () => {
      await service.create({
        name: 'nested',
        eventType: 'custom.dc989-nested.*',
        filters: [{ field: 'user.id', operator: 'eq', value: 42 }],
        startFrom: 'beginning',
      });
      const hit = await journal('custom.dc989-nested.a', { user: { id: 42 } });
      await journal('custom.dc989-nested.b', { user: { id: 43 } });

      const page = await service.pull('nested', { limit: 100 });
      expect(page.items.map((e) => e.id)).toEqual([hit]);
    });
  });

  describe('registry lifecycle', () => {
    test("startFrom 'now' (the default) skips history", async () => {
      await journal('custom.dc989-now.before');
      await service.create({ name: 'fresh', eventType: 'custom.dc989-now.*' });

      const empty = await service.pull('fresh', { limit: 100 });
      expect(empty.items).toEqual([]);

      const after = await journal('custom.dc989-now.after');
      const page = await service.pull('fresh', { limit: 100 });
      expect(page.items.map((e) => e.id)).toEqual([after]);
    });

    test('a duplicate name is refused with a conflict', async () => {
      await service.create({ name: 'dupe', eventType: 'custom.dc989-dupe.*' });
      await expect(service.create({ name: 'dupe', eventType: 'custom.dc989-dupe.*' })).rejects.toThrow(
        /already exists/,
      );
    });

    test('delete removes the registration and publishes system.consumer.deleted', async () => {
      await service.create({ name: 'doomed', eventType: 'custom.dc989-doomed.*' });
      await service.delete('doomed');
      await expect(service.inspect('doomed')).rejects.toThrow(/not found/i);
      const deleted = published.filter((p) => p.type === 'system.consumer.deleted');
      expect(deleted.map((p) => p.payload.name)).toContain('doomed');
    });

    test('list carries per-consumer lag', async () => {
      const items = await service.list();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.lag).toBe(Math.max(0, item.head - item.cursor));
      }
    });
  });

  describe('two-tenant containment under RLS enforcement', () => {
    const passwords = { ddl: password(), runtime: password(), authPlane: password() };
    let runtimeService: EventConsumerService;
    let runtimeDb: Database;
    let eventA: string;

    beforeAll(async () => {
      const superDbUrl = urlFor(superUrl, dbName);
      eventA = randomUUID();

      // Seed both tenants + an owning instance each (superuser bypasses RLS).
      // omni_events carries a BEFORE INSERT derivation trigger (0041) that
      // OVERWRITES tenant_id from the owning parents — so the journal rows
      // below reference the tenant-owned instances instead of claiming a
      // tenant directly, exactly as production rows earn their ownership.
      const seeded = runSqlOn(
        superDbUrl,
        `
        INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
          ('${TENANT_A}', 'tenant-a-989', 'Tenant A', 86400, 100, 100),
          ('${TENANT_B}', 'tenant-b-989', 'Tenant B', 86400, 100, 100);

        INSERT INTO instances (id, name, channel, tenant_id) VALUES
          ('${INSTANCE_A}', 'inst-a-989', 'whatsapp-baileys', '${TENANT_A}'),
          ('${INSTANCE_B}', 'inst-b-989', 'whatsapp-baileys', '${TENANT_B}');
        `,
      );
      if (seeded.exitCode !== 0) throw new Error(`tenant seed failed: ${seeded.stderr}`);

      await db.insert(omniEvents).values([
        {
          id: eventA,
          channel: 'internal',
          instanceId: INSTANCE_A,
          eventType: 'custom.dc989-iso.a',
          direction: 'internal',
          status: 'completed',
          rawPayload: { tenant: 'a' },
        },
        {
          channel: 'internal',
          instanceId: INSTANCE_B,
          eventType: 'custom.dc989-iso.b',
          direction: 'internal',
          status: 'completed',
          rawPayload: { tenant: 'b' },
        },
      ]);
      await db.insert(durableConsumers).values({ name: 'iso', eventType: 'custom.dc989-iso.*', cursor: 0 });

      const provisioner = openDb(superDbUrl, 3);
      await applyTenantRlsEnforcement(provisioner);
      await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

      runtimeDb = openDb(
        urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
        1,
      );
      runtimeService = new EventConsumerService(runtimeDb, null);
    }, 120_000);

    test("tenant A's scoped pull sees A's events and never B's", async () => {
      const page = await runInWorkerTenantScope(runtimeDb, TENANT_A, () => runtimeService.pull('iso', { limit: 100 }));
      expect(page.items.map((e) => e.id)).toEqual([eventA]);
      expect(page.items.every((e) => e.tenantId === TENANT_A)).toBe(true);
    });

    test('a scope-less pull on the enforced runtime role fails closed rather than leaking', async () => {
      // No tenant GUC: the omni_events SELECT policy's context reader RAISES,
      // so the read errors instead of silently returning another tenant's rows.
      await expect(driverRejection(runtimeService.pull('iso', { limit: 100 }))).rejects.toThrow(
        /app\.tenant_id|insufficient/i,
      );
    });
  });
});
