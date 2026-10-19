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
 *  - opt-in instance scoping (0082): a scoped consumer pages only its
 *    instances' rows (cursor still moves past the others) and is invisible
 *    (404) to non-owner restricted keys; unscoped consumers stay global; a
 *    scoped create naming a nonexistent instance is refused;
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
  instances,
  omniEvents,
} from '@omni/db';
import { driverRejection, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { createPluginContext } from '../plugins/context';
import { setupEventPersistence } from '../plugins/event-persistence';
import { type ConsumerCaller, EventConsumerService } from '../services/event-consumers';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';

const FULL_ACCESS = { tenantId: null, caller: { keyId: null, instanceIds: null } };
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

/** Capture the real `message.received` persistence fill (the upsert that completes a claimed row). */
async function captureMessageReceivedHandler(db: Database): Promise<CustomEventHandler> {
  const subscriptions = new Map<string, CustomEventHandler>();
  const mockBus = {
    subscribe: async (eventType: string, handler: CustomEventHandler) => {
      subscriptions.set(eventType, handler);
    },
    subscribePattern: async () => {},
  } as unknown as EventBus;

  await setupEventPersistence(mockBus, db);
  const handler = subscriptions.get('message.received');
  if (!handler) throw new Error('message.received subscriber was not registered');
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

  describe('shared (competing) consumers (#1188)', () => {
    const ids: string[] = [];

    beforeAll(async () => {
      await service.create({ name: 'workers', eventType: 'custom.dc1188.*', startFrom: 'beginning', shared: true });
      await service.create({ name: 'observer-1', eventType: 'custom.dc1188.*', startFrom: 'beginning' });
      await service.create({ name: 'observer-2', eventType: 'custom.dc1188.*', startFrom: 'beginning' });
      for (let i = 0; i < 6; i++) ids.push(await journal(`custom.dc1188.ev${i}`, { i }));
    });

    test('two concurrent pullers on a shared consumer get each event exactly once', async () => {
      const other = new EventConsumerService(db, null);
      const delivered: string[] = [];
      for (;;) {
        const pages = await Promise.all([service.pull('workers', { limit: 2 }), other.pull('workers', { limit: 2 })]);
        if (pages.every((p) => p.items.length === 0)) break;
        for (const page of pages) {
          delivered.push(...page.items.map((e) => e.id));
          if (page.leaseId) await service.ack('workers', 0, page.leaseId);
        }
      }
      expect([...delivered].sort()).toEqual([...ids].sort());
      expect((await service.getByName('workers')).cursor).toBeGreaterThan(0);
    });

    test('an expired lease is redelivered; a cursor ack is refused', async () => {
      const id = await journal('custom.dc1188.late');
      const first = await service.pull('workers', { limit: 10, leaseMs: 1000 });
      expect(first.items.map((e) => e.id)).toEqual([id]);
      expect((await service.pull('workers', { limit: 10 })).items).toEqual([]);
      await new Promise((r) => setTimeout(r, 1100));
      const again = await service.pull('workers', { limit: 10 });
      expect(again.items.map((e) => e.id)).toEqual([id]);
      await expect(service.ack('workers', again.cursor)).rejects.toThrow(/shared/);
      if (!first.leaseId || !again.leaseId) throw new Error('leaseId missing');
      await expect(service.ack('workers', 0, first.leaseId)).rejects.toThrow(/expired/);
      await service.ack('workers', 0, again.leaseId);
    });

    test('fan-out default is unchanged: every name sees every event', async () => {
      const one = await service.pull('observer-1', { limit: 50 });
      const two = await service.pull('observer-2', { limit: 50 });
      expect(one.items.map((e) => e.id).slice(0, 6)).toEqual(ids);
      expect(two.items.map((e) => e.id).slice(0, 6)).toEqual(ids);
      expect(one.leaseId).toBeUndefined();
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

    test('excludeTypes drop housekeeping from the stored filter; exclusion wins (#1078)', async () => {
      await service.create({
        name: 'excluder',
        eventType: 'custom.dc1078.*',
        excludeTypes: ['custom.dc1078.chat.*', 'custom.dc1078.lid-mapping.batch'],
        startFrom: 'beginning',
      });
      const kept = await journal('custom.dc1078.github.push');
      await journal('custom.dc1078.chat.unread-updated');
      await journal('custom.dc1078.lid-mapping.batch');

      const page = await service.pull('excluder', { limit: 100 });
      expect(page.items.map((e) => e.id)).toEqual([kept]);
      expect((await service.getByName('excluder')).excludeTypes).toEqual([
        'custom.dc1078.chat.*',
        'custom.dc1078.lid-mapping.batch',
      ]);
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

    test('more non-matching rows than the scan window never wedge the cursor (#1128)', async () => {
      await service.create({
        name: 'wedge',
        eventType: 'custom.dc1128.*',
        filters: [{ field: 'chat', operator: 'eq', value: 'target' }],
        startFrom: 'beginning',
      });
      const start = (await service.getByName('wedge')).cursor;
      for (let i = 0; i < 7; i++) await journal('custom.dc1128.noise', { chat: 'other' });
      const hit = await journal('custom.dc1128.msg', { chat: 'target' });

      // Peek-style pulls (never acking) with a window of 3 must still reach the match.
      const empty = await service.pull('wedge', { limit: 3 });
      expect(empty.items).toEqual([]);
      expect(empty.scanExhausted).toBe(true);
      expect((await service.getByName('wedge')).cursor).toBeGreaterThan(start);

      let delivered: string[] = [];
      for (let i = 0; i < 5 && delivered.length === 0; i++) {
        delivered = (await service.pull('wedge', { limit: 3 })).items.map((e) => e.id);
      }
      expect(delivered).toEqual([hit]);
      expect((await service.inspect('wedge')).caughtUp).toBe(false); // delivered but not acked
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

  describe('opt-in journal readiness gate (waitForReady)', () => {
    let instanceId: string;
    /** An allowlist instance with no rules: every inbound sender is journaled 'denied'. */
    let deniedInstanceId: string;
    let fillHandler: CustomEventHandler;
    let ingress: NonNullable<ReturnType<typeof createPluginContext>['ingressClaim']>;

    beforeAll(async () => {
      const [instance] = await db
        .insert(instances)
        .values({ name: `inst-journal-ready-${randomUUID()}`, channel: 'whatsapp-baileys' })
        .returning();
      if (!instance) throw new Error('instance seed failed');
      instanceId = instance.id;
      const [denying] = await db
        .insert(instances)
        .values({ name: `inst-journal-denied-${randomUUID()}`, channel: 'whatsapp-baileys', accessMode: 'allowlist' })
        .returning();
      if (!denying) throw new Error('denying instance seed failed');
      deniedInstanceId = denying.id;
      fillHandler = await captureMessageReceivedHandler(db);
      const claimer = createPluginContext({ pluginId: 'whatsapp-baileys', eventBus: {} as EventBus, db }).ingressClaim;
      if (!claimer) throw new Error('ingressClaim missing from plugin context');
      ingress = claimer;
    });

    /** A real ingress claim: commits the hollow skeleton row (journal_ready = false). */
    async function claim(tag: string, onInstance = instanceId): Promise<{ id: string; seq: number }> {
      const id = await ingress.claim({
        idempotencyKey: `whatsapp-baileys:${onInstance}:jr-${tag}-${randomUUID()}`,
        instanceId: onInstance,
        channelType: 'whatsapp-baileys',
        externalId: `jr-${tag}`,
      });
      if (!id) throw new Error('claim was deduped');
      const [row] = await db.select().from(omniEvents).where(eq(omniEvents.id, id));
      if (!row) throw new Error('claim did not commit a row (fail-open path)');
      expect(row.journalReady).toBe(false);
      expect(row.rawPayload).toBeNull();
      return { id, seq: Number(row.journalSeq) };
    }

    /** The real message.received persistence fill under the claimed id. */
    async function fill(id: string, tag: string, onInstance = instanceId): Promise<void> {
      await fillHandler({
        id,
        type: 'message.received',
        timestamp: Date.now(),
        payload: {
          externalId: `jr-${tag}`,
          chatId: 'jr-chat@s.whatsapp.net',
          from: 'jr-sender@s.whatsapp.net',
          content: { type: 'text', text: `hello ${tag}` },
          rawPayload: { kind: 'jr', tag },
        },
        metadata: { correlationId: id, instanceId: onInstance, channelType: 'whatsapp-baileys' },
      });
      const [row] = await db.select().from(omniEvents).where(eq(omniEvents.id, id));
      expect(row?.journalReady).toBe(true);
    }

    test('(a) no flag: a pull between claim and fill returns the hollow row and moves the cursor exactly as today', async () => {
      const plain = await service.create({ name: 'jr-nogate', eventType: 'message.received' });
      const filtered = await service.create({
        name: 'jr-nogate-filtered',
        eventType: 'message.received',
        filters: [{ field: 'kind', operator: 'eq', value: 'jr' }],
      });
      expect(plain.waitForReady).toBe(false);
      expect((await service.getByName('jr-nogate-filtered')).waitForReady).toBe(false);
      const { id, seq } = await claim('a');

      // Unfiltered: the hollow skeleton row is delivered; the returned cursor covers it, the stored cursor waits for ack.
      const page = await service.pull('jr-nogate', { limit: 10 });
      expect(page.items.map((e) => e.id)).toEqual([id]);
      expect(page.items[0]?.rawPayload).toBeNull();
      expect(page.items[0]?.journalReady).toBe(false);
      expect(page.cursor).toBe(seq);
      expect((await service.getByName('jr-nogate')).cursor).toBe(plain.cursor);

      // Filtered: the hollow row fails the payload filter and the cursor is advanced past it (#1128), as today.
      const dropped = await service.pull('jr-nogate-filtered', { limit: 10 });
      expect(dropped.items).toEqual([]);
      expect(dropped.cursor).toBe(seq);
      expect((await service.getByName('jr-nogate-filtered')).cursor).toBe(seq);
      expect(filtered.cursor).toBeLessThan(seq);
      await fill(id, 'a');
    });

    test('(b) waitForReady=true: a claimed row is held, the cursor stays before it, and the filled row is delivered', async () => {
      const gated = await service.create({ name: 'jr-gate', eventType: 'message.received', waitForReady: true });
      await service.create({
        name: 'jr-gate-filtered',
        eventType: 'message.received',
        filters: [{ field: 'kind', operator: 'eq', value: 'jr' }],
        waitForReady: true,
      });
      expect(gated.waitForReady).toBe(true);
      expect((await service.inspect('jr-gate')).waitForReady).toBe(true);
      const { id, seq } = await claim('b');

      const held = await service.pull('jr-gate', { limit: 10 });
      expect(held.items).toEqual([]);
      expect(held.cursor).toBe(gated.cursor);
      expect(held.cursor).toBeLessThan(seq);
      expect((await service.getByName('jr-gate')).cursor).toBe(gated.cursor);
      const heldFiltered = await service.pull('jr-gate-filtered', { limit: 10 });
      expect(heldFiltered.items).toEqual([]);
      expect((await service.getByName('jr-gate-filtered')).cursor).toBeLessThan(seq);

      await fill(id, 'b');

      const page = await service.pull('jr-gate', { limit: 10 });
      expect(page.items.map((e) => e.id)).toEqual([id]);
      expect(page.items[0]?.journalReady).toBe(true);
      expect(page.items[0]?.rawPayload).toEqual({ kind: 'jr', tag: 'b' });
      expect(page.items[0]?.textContent).toBe('hello b');
      expect(page.cursor).toBe(seq);
      const filteredPage = await service.pull('jr-gate-filtered', { limit: 10 });
      expect(filteredPage.items.map((e) => e.id)).toEqual([id]);
    });

    test('(c) waitForReady=true: a not-ready row older than the settle window is delivered', async () => {
      await service.create({ name: 'jr-gate-stale', eventType: 'message.received', waitForReady: true });
      const { id, seq } = await claim('c');
      await db
        .update(omniEvents)
        .set({ receivedAt: new Date(Date.now() - 60_000) })
        .where(eq(omniEvents.id, id));

      const page = await service.pull('jr-gate-stale', { limit: 10 });
      expect(page.items.map((e) => e.id)).toEqual([id]);
      expect(page.items[0]?.journalReady).toBe(false);
      expect(page.cursor).toBe(seq);
    });

    test('(d) waitForReady=true: a long-poll whose page is truncated to empty keeps waiting', async () => {
      const gated = await service.create({ name: 'jr-gate-wait', eventType: 'message.received', waitForReady: true });
      await claim('d');

      const started = Date.now();
      const page = await service.pull('jr-gate-wait', { limit: 10, waitMs: 1200 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
      expect(page.items).toEqual([]);
      expect(page.cursor).toBe(gated.cursor);
      expect((await service.getByName('jr-gate-wait')).cursor).toBe(gated.cursor);
    });

    test('(e) shared + waitForReady=true: no fresh lease spans a held row; the filled row is leased', async () => {
      const shared = await service.create({
        name: 'jr-gate-shared',
        eventType: 'message.received',
        shared: true,
        waitForReady: true,
      });
      const { id, seq } = await claim('e');

      const held = await service.pull('jr-gate-shared', { limit: 10 });
      expect(held.items).toEqual([]);
      expect(held.leaseId).toBeUndefined();
      expect(held.cursor).toBe(shared.cursor);
      const state = (await service.getByName('jr-gate-shared')).leaseState;
      expect(state?.claimed).toBe(shared.cursor);
      expect(state?.claimed).toBeLessThan(seq);
      expect(state?.leases).toEqual([]);

      await fill(id, 'e');

      const page = await service.pull('jr-gate-shared', { limit: 10 });
      expect(page.items.map((e) => e.id)).toEqual([id]);
      expect(page.items[0]?.journalReady).toBe(true);
      expect(page.cursor).toBe(seq);
      if (!page.leaseId) throw new Error('leaseId missing');
      const acked = await service.ack('jr-gate-shared', 0, page.leaseId);
      expect(acked.cursor).toBe(seq);
    });

    test('(f) SSE stream scan: catches up filled rows, holds a hollow row (gate forced on), never writes the cursor', async () => {
      // No waitForReady on the consumer: the stream applies the gate anyway.
      const consumer = await service.create({ name: 'jr-stream', eventType: 'message.received' });
      expect(consumer.waitForReady).toBe(false);
      const first = await claim('f1');
      await fill(first.id, 'f1');
      const hollow = await claim('f2');

      const catchUp = await service.scanForStream('jr-stream', consumer.cursor, FULL_ACCESS);
      expect(catchUp.items.map((e) => e.id)).toEqual([first.id]);
      expect(catchUp.through).toBe(first.seq);
      expect(catchUp.held).toBe(true);
      expect(catchUp.full).toBe(false);

      const stillHeld = await service.scanForStream('jr-stream', first.seq, FULL_ACCESS);
      expect(stillHeld).toEqual({ items: [], through: null, held: true, full: false });

      await fill(hollow.id, 'f2');
      const live = await service.scanForStream('jr-stream', first.seq, FULL_ACCESS);
      expect(live.items.map((e) => e.id)).toEqual([hollow.id]);
      expect(live.items[0]?.rawPayload).toEqual({ kind: 'jr', tag: 'f2' });
      expect(live.through).toBe(hollow.seq);
      expect(live.held).toBe(false);

      expect((await service.getByName('jr-stream')).cursor).toBe(consumer.cursor);
    });

    test('(g) SSE stream scan refuses a shared consumer', async () => {
      await service.create({ name: 'jr-stream-shared', eventType: 'message.received', shared: true });
      await expect(service.scanForStream('jr-stream-shared', 0, FULL_ACCESS)).rejects.toThrow(/shared/);
    });

    test('(h) SSE stream scan: an instance-restricted key only receives its instances; a full key receives all', async () => {
      const [other] = await db
        .insert(instances)
        .values({ name: `inst-stream-other-${randomUUID()}`, channel: 'whatsapp-baileys' })
        .returning();
      if (!other) throw new Error('instance seed failed');
      const consumer = await service.create({ name: 'jr-stream-instances', eventType: 'custom.stream.instances' });
      const seed = async (instance: string): Promise<{ id: string; seq: number }> => {
        const [inserted] = await db
          .insert(omniEvents)
          .values({ channel: 'whatsapp-baileys', instanceId: instance, eventType: 'custom.stream.instances' })
          .returning();
        if (!inserted) throw new Error('event seed failed');
        return { id: inserted.id, seq: Number(inserted.journalSeq) };
      };
      const mine1 = await seed(instanceId);
      const theirs = await seed(other.id);
      const mine2 = await seed(instanceId);

      const restricted = await service.scanForStream('jr-stream-instances', consumer.cursor, {
        tenantId: null,
        caller: { keyId: null, instanceIds: [instanceId] },
      });
      expect(restricted.items.map((e) => e.id)).toEqual([mine1.id, mine2.id]);
      expect(restricted.through).toBe(mine2.seq);

      const all = await service.scanForStream('jr-stream-instances', consumer.cursor, FULL_ACCESS);
      expect(all.items.map((e) => e.id)).toEqual([mine1.id, theirs.id, mine2.id]);

      const none = await service.scanForStream('jr-stream-instances', consumer.cursor, {
        tenantId: null,
        caller: { keyId: null, instanceIds: [] },
      });
      expect(none.items).toEqual([]);
      expect((await service.getByName('jr-stream-instances')).cursor).toBe(consumer.cursor);
    });

    describe('access filter + waitForReady (#1299 on #1294)', () => {
      const ACCESS_ENV = 'OMNI_JOURNAL_ACCESS_DECISION';
      let savedAccessEnv: string | undefined;
      beforeAll(() => {
        savedAccessEnv = process.env[ACCESS_ENV];
        process.env[ACCESS_ENV] = 'true'; // create() accepts access, the fill journals the verdict
      });
      afterAll(() => {
        if (savedAccessEnv === undefined) delete process.env[ACCESS_ENV];
        else process.env[ACCESS_ENV] = savedAccessEnv;
      });

      async function decisionOf(id: string): Promise<string | null | undefined> {
        const [row] = await db.select().from(omniEvents).where(eq(omniEvents.id, id));
        return row?.accessDecision;
      }

      async function backdate(id: string): Promise<void> {
        await db
          .update(omniEvents)
          .set({ receivedAt: new Date(Date.now() - 60_000) })
          .where(eq(omniEvents.id, id));
      }

      test("(f) 'allowed': an unfilled row holds the page until its verdict lands, then both rows deliver in order", async () => {
        const gated = await service.create({
          name: 'jr-access-gate',
          eventType: 'message.received',
          access: 'allowed',
          waitForReady: true,
        });
        await service.create({ name: 'jr-access-nogate', eventType: 'message.received', access: 'allowed' });
        expect(gated.accessFilter).toBe('allowed');
        expect(gated.waitForReady).toBe(true);
        const first = await claim('f1');
        const second = await claim('f2');
        await fill(second.id, 'f2');
        expect(await decisionOf(first.id)).toBeNull();
        expect(await decisionOf(second.id)).toBe('allowed');

        const held = await service.pull('jr-access-gate', { limit: 10 });
        expect(held.items).toEqual([]);
        expect(held.cursor).toBe(gated.cursor);
        expect((await service.getByName('jr-access-gate')).cursor).toBe(gated.cursor);

        // Documented gap: without waitForReady the plain SQL predicate already skips the unfilled row.
        const gap = await service.pull('jr-access-nogate', { limit: 10 });
        expect(gap.items.map((e) => e.id)).toEqual([second.id]);

        await fill(first.id, 'f1');
        expect(await decisionOf(first.id)).toBe('allowed');
        const page = await service.pull('jr-access-gate', { limit: 10 });
        expect(page.items.map((e) => e.id)).toEqual([first.id, second.id]);
        expect(page.cursor).toBe(second.seq);
        expect((await service.ack('jr-access-gate', page.cursor)).cursor).toBe(second.seq);
      });

      test("(s) SSE stream scan on an 'allowed' consumer WITHOUT waitForReady: holds, then delivers; denied skipped", async () => {
        const plain = await service.create({
          name: 'jr-access-stream',
          eventType: 'message.received',
          access: 'allowed',
        });
        expect(plain.waitForReady).toBe(false);
        const first = await claim('s1');
        const second = await claim('s2');
        await fill(second.id, 's2');
        const denied = await claim('s3', deniedInstanceId);
        await fill(denied.id, 's3', deniedInstanceId);
        const dead = await claim('s4');
        await backdate(dead.id);
        const last = await claim('s5');
        await fill(last.id, 's5');

        // The young unfilled row holds the stream page (the pull without waitForReady would skip it).
        const held = await service.scanForStream('jr-access-stream', plain.cursor, FULL_ACCESS);
        expect(held).toEqual({ items: [], through: null, held: true, full: false });

        await fill(first.id, 's1');
        const page = await service.scanForStream('jr-access-stream', plain.cursor, FULL_ACCESS);
        expect(page.items.map((e) => e.id)).toEqual([first.id, second.id, last.id]); // denied + dead skipped
        expect(page.through).toBe(last.seq);
        expect(page.held).toBe(false);
        expect((await service.getByName('jr-access-stream')).cursor).toBe(plain.cursor);
      });

      test("(g) 'allowed': a 'denied' fill is skipped and a dead unfilled row neither delivers nor stalls", async () => {
        const gated = await service.create({
          name: 'jr-access-skip',
          eventType: 'message.received',
          access: 'allowed',
          waitForReady: true,
        });
        const denied = await claim('g1', deniedInstanceId);
        const dead = await claim('g2');
        await backdate(dead.id);
        const allowed = await claim('g3');
        await fill(allowed.id, 'g3');

        // The young unfilled row (verdict not landed yet) holds the page.
        const held = await service.pull('jr-access-skip', { limit: 10 });
        expect(held.items).toEqual([]);
        expect((await service.getByName('jr-access-skip')).cursor).toBe(gated.cursor);

        await fill(denied.id, 'g1', deniedInstanceId);
        expect(await decisionOf(denied.id)).toBe('denied');
        const page = await service.pull('jr-access-skip', { limit: 10 });
        expect(page.items.map((e) => e.id)).toEqual([allowed.id]);
        expect(page.cursor).toBe(allowed.seq);
        expect(dead.seq).toBeLessThan(allowed.seq);

        // A page holding only a dead unfilled row delivers nothing and advances the stored cursor (#1128).
        const onlyDead = await service.create({
          name: 'jr-access-dead',
          eventType: 'message.received',
          access: 'allowed',
          waitForReady: true,
        });
        const lone = await claim('g4');
        await backdate(lone.id);
        const skipped = await service.pull('jr-access-dead', { limit: 10 });
        expect(skipped.items).toEqual([]);
        expect(skipped.cursor).toBe(lone.seq);
        expect((await service.getByName('jr-access-dead')).cursor).toBe(lone.seq);
        expect(onlyDead.cursor).toBeLessThan(lone.seq);
      });

      test("(h) shared + 'allowed' + waitForReady: no fresh lease spans an unfilled row; the filled page is leased", async () => {
        const shared = await service.create({
          name: 'jr-access-shared',
          eventType: 'message.received',
          access: 'allowed',
          waitForReady: true,
          shared: true,
        });
        const first = await claim('h1');
        const second = await claim('h2');
        await fill(second.id, 'h2');

        const held = await service.pull('jr-access-shared', { limit: 10 });
        expect(held.items).toEqual([]);
        expect(held.leaseId).toBeUndefined();
        expect((await service.getByName('jr-access-shared')).leaseState?.claimed).toBe(shared.cursor);

        await fill(first.id, 'h1');
        const page = await service.pull('jr-access-shared', { limit: 10 });
        expect(page.items.map((e) => e.id)).toEqual([first.id, second.id]);
        expect(page.cursor).toBe(second.seq);
        if (!page.leaseId) throw new Error('leaseId missing');
        expect((await service.ack('jr-access-shared', 0, page.leaseId)).cursor).toBe(second.seq);

        // A fresh page of only a dead unfilled row is leased, matches nothing, and is released past it.
        const lone = await claim('h3');
        await backdate(lone.id);
        const skipped = await service.pull('jr-access-shared', { limit: 10 });
        expect(skipped.items).toEqual([]);
        expect(skipped.leaseId).toBeUndefined();
        expect((await service.getByName('jr-access-shared')).cursor).toBe(lone.seq);
      });
    });
  });

  describe('opt-in instance scoping + ownership (0082)', () => {
    // Own instances (omni_events.instance_id is an FK): seeded on the superuser
    // handle BEFORE the two-tenant block below turns on RLS enforcement.
    let instA: string;
    let instB: string;
    let owner: ConsumerCaller;
    let otherRestricted: ConsumerCaller;
    const unrestricted: ConsumerCaller = { keyId: randomUUID(), instanceIds: null };
    const rows = new Map<string, string>();
    const idOf = (label: string): string => {
      const id = rows.get(label);
      if (!id) throw new Error(`no journal row labelled ${label}`);
      return id;
    };

    /** Journal one row for an instance (or none) directly — the custom.> subscriber never sets instance_id. */
    async function journalFor(label: string, instanceId: string | null): Promise<void> {
      const [row] = await db
        .insert(omniEvents)
        .values({
          channel: 'internal',
          instanceId,
          eventType: `custom.dc0082.${label}`,
          direction: 'internal',
          status: 'completed',
          rawPayload: { label },
        })
        .returning({ id: omniEvents.id });
      if (!row) throw new Error('journal insert returned nothing');
      rows.set(label, row.id);
    }

    beforeAll(async () => {
      const seeded = await db
        .insert(instances)
        .values([
          { name: 'inst-a-0082', channel: 'whatsapp-baileys' as const },
          { name: 'inst-b-0082', channel: 'whatsapp-baileys' as const },
        ])
        .returning({ id: instances.id, name: instances.name });
      const a = seeded.find((i) => i.name === 'inst-a-0082')?.id;
      const b = seeded.find((i) => i.name === 'inst-b-0082')?.id;
      if (!a || !b) throw new Error('instance seed failed');
      instA = a;
      instB = b;
      owner = { keyId: randomUUID(), instanceIds: [instA] };
      otherRestricted = { keyId: randomUUID(), instanceIds: [instA] };

      await service.create({ name: 'legacy-0082', eventType: 'custom.dc0082.*', startFrom: 'beginning' }, owner);
      await service.create(
        { name: 'scoped-0082', eventType: 'custom.dc0082.*', startFrom: 'beginning', scoped: true },
        owner,
      );
      for (const [label, instance] of [
        ['a1', instA],
        ['b1', instB],
        ['none', null],
        ['b2', instB],
        ['a2', instA],
        ['b3', instB],
      ] as const) {
        await journalFor(label, instance);
      }
    });

    test('no new option: identical behaviour — an unscoped consumer is global for every key', async () => {
      const stored = await service.getByName('legacy-0082');
      expect([stored.scoped, stored.instanceIds, stored.ownerKeyId]).toEqual([false, null, null]);
      expect(published.find((p) => p.payload.name === 'legacy-0082')?.payload).not.toHaveProperty('scoped');

      for (const caller of [owner, otherRestricted, unrestricted, undefined]) {
        expect((await service.inspect('legacy-0082', caller)).name).toBe('legacy-0082');
        expect((await service.list(caller)).map((c) => c.name)).toContain('legacy-0082');
        // Every instance's rows (and instance-less rows) — the key's restriction does not apply.
        const page = await service.pull('legacy-0082', { limit: 100 }, caller);
        expect(page.items.map((e) => e.id)).toEqual(['a1', 'b1', 'none', 'b2', 'a2', 'b3'].map(idOf));
      }
      const page = await service.pull('legacy-0082', { limit: 2 }, otherRestricted);
      expect((await service.ack('legacy-0082', page.cursor, undefined, otherRestricted)).cursor).toBe(page.cursor);
      await service.delete('legacy-0082', otherRestricted);
      await expect(service.inspect('legacy-0082')).rejects.toThrow(/not found/i);
    });

    test('a scoped create naming an instance that does not exist is refused (400) and stores nothing', async () => {
      const missing = randomUUID();
      const refused = service.create(
        { name: 'scoped-0082-missing', eventType: 'custom.dc0082.*', scoped: true, instanceIds: [instA, missing] },
        unrestricted,
      );
      await expect(refused).rejects.toMatchObject({ code: 'VALIDATION', context: { instanceIds: [missing] } });
      await expect(service.getByName('scoped-0082-missing')).rejects.toThrow(/not found/i);
    });

    test('scoped create stores the owner key and the restricted key instances', async () => {
      const stored = await service.inspect('scoped-0082', owner);
      expect(stored.scoped).toBe(true);
      expect(stored.instanceIds).toEqual([instA]);
      expect(stored.ownerKeyId).toBe(owner.keyId);
    });

    test("scoped pull pages only its instances' rows and the cursor moves past filtered rows", async () => {
      const first = await service.pull('scoped-0082', { limit: 1 }, owner);
      expect(first.items.map((e) => e.id)).toEqual([idOf('a1')]);
      await service.ack('scoped-0082', first.cursor, undefined, owner);

      // b1, none, b2 are skipped in SQL: the next 1-row page is a2.
      const second = await service.pull('scoped-0082', { limit: 1 }, owner);
      expect(second.items.map((e) => e.id)).toEqual([idOf('a2')]);
      expect(second.items.every((e) => e.instanceId === instA)).toBe(true);
      await service.ack('scoped-0082', second.cursor, undefined, owner);

      // Only b3 (another instance) remains past the cursor: nothing to page, caught up despite lag.
      const after = await service.pull('scoped-0082', { limit: 100 }, owner);
      expect(after.items).toEqual([]);
      expect(after.cursor).toBe(second.cursor);
      const inspected = await service.inspect('scoped-0082', owner);
      expect(inspected.caughtUp).toBe(true);
      expect(inspected.lag).toBeGreaterThan(0);
    });

    test('SSE stream scan resolves like pull: the owner streams only its instances, a stranger gets 404', async () => {
      const cursor = (await service.getByName('scoped-0082')).cursor;
      const page = await service.scanForStream('scoped-0082', 0, { tenantId: null, caller: owner });
      expect(page.items.map((e) => e.id)).toEqual([idOf('a1'), idOf('a2')]);
      await expect(
        service.scanForStream('scoped-0082', 0, { tenantId: null, caller: otherRestricted }),
      ).rejects.toThrow(/not found/i);
      await expect(service.getStreamable('scoped-0082', otherRestricted)).rejects.toThrow(/not found/i);
      expect((await service.getByName('scoped-0082')).cursor).toBe(cursor);
    });

    test('a non-owner restricted key gets 404 on get/pull/ack/delete and does not see it listed', async () => {
      await expect(service.inspect('scoped-0082', otherRestricted)).rejects.toThrow(/not found/i);
      await expect(service.pull('scoped-0082', { limit: 10 }, otherRestricted)).rejects.toThrow(/not found/i);
      const cursor = (await service.getByName('scoped-0082')).cursor;
      await expect(service.ack('scoped-0082', cursor + 1000, undefined, otherRestricted)).rejects.toThrow(/not found/i);
      await expect(service.delete('scoped-0082', otherRestricted)).rejects.toThrow(/not found/i);
      expect((await service.list(otherRestricted)).map((c) => c.name)).not.toContain('scoped-0082');

      // Nothing moved: the cursor is untouched and the consumer still exists.
      expect((await service.getByName('scoped-0082')).cursor).toBe(cursor);
    });

    test('the owner and an instance-unrestricted key succeed', async () => {
      for (const caller of [owner, unrestricted]) {
        expect((await service.inspect('scoped-0082', caller)).ownerKeyId).toBe(owner.keyId);
        expect((await service.list(caller)).map((c) => c.name)).toContain('scoped-0082');
        const page = await service.pull('scoped-0082', { limit: 10 }, caller);
        await service.ack('scoped-0082', page.cursor, undefined, caller);
      }
      await service.delete('scoped-0082', unrestricted);
      await expect(service.inspect('scoped-0082', owner)).rejects.toThrow(/not found/i);
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
