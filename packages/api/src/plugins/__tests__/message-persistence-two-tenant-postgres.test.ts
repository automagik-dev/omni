/**
 * Two-tenant MESSAGE-PERSISTENCE containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * `message-persistence` is the dominant inbound consumer — every message on
 * every channel lands here — and until the G5 read-path leg it was wholly
 * unconverted: its `chats`, `messages`, `chat_participants`, `chat_id_mappings`,
 * `platform_identities` and `instances` writes all reached the ambient pool with
 * no tenant context. This suite drives the REAL registered NATS handler (through
 * a capture bus and a real `Services` container over the runtime role) against a
 * real RLS-enforced database, so it exercises the code the consumer actually
 * runs rather than a re-implementation.
 *
 * The seed is deliberately adversarial: both tenants own an instance, and BOTH
 * inbound events carry the SAME external chat JID and the SAME external message
 * id. Nothing but the tenant distinguishes them, so any leak — a lookup that
 * crosses tenants, a find-or-create that latches onto the other tenant's row —
 * shows up as a wrong row count rather than as a subtle field difference.
 *
 * Probes:
 *   1. tenant A's envelope creates A's chat + message, invisible to B;
 *   2. tenant B's envelope creates its OWN rows for the same external ids —
 *      neither tenant's row is reused or overwritten;
 *   3. a B-scoped envelope naming A's instance writes nothing under either
 *      tenant (the derivation trigger + RLS WITH CHECK refuse it — the caller's
 *      claim buys nothing);
 *   4. a malformed envelope (tenant claim, no version) is quarantined before any
 *      write — never processed globally.
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
  chats,
  createDbHandle,
  messages,
} from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { createServices } from '../../services';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { setupMessagePersistence } from '../message-persistence';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111da';
const TENANT_B = '22222222-2222-4222-8222-2222222222db';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555da';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555db';

/** The whole point of the seed: identical external identity, different tenants. */
const SHARED_JID = '5511999990000@s.whatsapp.net';
const SHARED_EXTERNAL_ID = 'shared-external-message-id';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-msgpersist-${crypto.randomUUID()}.sql`);
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

/** Capture the handlers `setupMessagePersistence` registers on the bus. */
function captureBus() {
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const bus = {
    subscribe: async (type: string, handler: (event: never) => Promise<void>) => {
      handlers.set(type, handler as unknown as (event: unknown) => Promise<void>);
    },
    publish: async () => undefined,
  } as unknown as EventBus;
  const fire = (type: string, event: unknown): Promise<void> => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no handler for ${type}`);
    return handler(event);
  };
  return { bus, fire };
}

/**
 * A `message.received` envelope. `metadata` is the ONLY place a tenant may come
 * from — `envelopeVersion`/`tenantId` are producer-stamped (G5, ADR-0008).
 */
function receivedEvent(opts: {
  instanceId: string;
  envelopeVersion?: number;
  tenantId?: string;
  text: string;
}): unknown {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.parse('2026-01-01T00:00:00Z'),
    payload: {
      externalId: SHARED_EXTERNAL_ID,
      chatId: SHARED_JID,
      from: SHARED_JID,
      senderName: 'Sender',
      content: { type: 'text', text: opts.text },
      rawPayload: {},
    },
    metadata: {
      instanceId: opts.instanceId,
      channelType: 'whatsapp-baileys',
      ...(opts.envelopeVersion === undefined ? {} : { envelopeVersion: opts.envelopeVersion }),
      ...(opts.tenantId === undefined ? {} : { tenantId: opts.tenantId }),
    },
  };
}

/** Let the handler's fire-and-forget continuations settle. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

postgresDescribe('two-tenant message-persistence containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_msgpersist_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  let fire: (type: string, event: unknown) => Promise<void>;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  /** Chats this tenant can see for the shared JID, read as a worker would. */
  const chatsForTenant = (tenantId: string): Promise<{ id: string; instanceId: string | null }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ id: chats.id, instanceId: chats.instanceId })
        .from(chats)
        .where(eq(chats.externalId, SHARED_JID)),
    );

  /** Messages this tenant can see for the shared external id. */
  const messagesForTenant = (tenantId: string): Promise<{ id: string; textContent: string | null }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ id: messages.id, textContent: messages.textContent })
        .from(messages)
        .where(eq(messages.externalId, SHARED_EXTERNAL_ID)),
    );

  /** Total rows regardless of tenant — the check that "nothing landed" is real. */
  const totalChats = (): { chats: number; messages: number } => {
    const out = Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '-A',
        '-t',
        '--dbname',
        urlFor(superUrl, dbName),
        '-c',
        `SELECT (SELECT count(*) FROM chats WHERE external_id = '${SHARED_JID}') || ' ' ||
                (SELECT count(*) FROM messages WHERE external_id = '${SHARED_EXTERNAL_ID}')`,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [c, m] = out.stdout.toString().trim().split(/\s+/).map(Number);
    return { chats: c ?? -1, messages: m ?? -1 };
  };

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

    // Only the tenants and their instances are seeded. The chats, messages,
    // participants and identities under test are created BY the consumer.
    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);

      INSERT INTO instances (id, name, channel, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'inst-a', 'whatsapp-baileys', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'inst-b', 'whatsapp-baileys', '${TENANT_B}', '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical connection shared by both tenants' workers: any bleed shows here.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 1);

    const captured = captureBus();
    fire = captured.fire;
    await setupMessagePersistence(captured.bus, createServices(runtimeDb, null));
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test("tenant A's envelope creates A's chat + message, invisible to B", async () => {
    await fire(
      'message.received',
      receivedEvent({ instanceId: INSTANCE_A, envelopeVersion: 1, tenantId: TENANT_A, text: 'hello from A' }),
    );
    await drain();

    const aChats = await chatsForTenant(TENANT_A);
    expect(aChats.length).toBe(1);
    expect(aChats[0]?.instanceId).toBe(INSTANCE_A);
    expect(await messagesForTenant(TENANT_A)).toEqual([{ id: expect.any(String), textContent: 'hello from A' }]);

    // B sees nothing at all — not the chat, not the message.
    expect(await chatsForTenant(TENANT_B)).toEqual([]);
    expect(await messagesForTenant(TENANT_B)).toEqual([]);
  }, 30_000);

  test("tenant B's envelope creates its OWN rows for the SAME external ids", async () => {
    await fire(
      'message.received',
      receivedEvent({ instanceId: INSTANCE_B, envelopeVersion: 1, tenantId: TENANT_B, text: 'hello from B' }),
    );
    await drain();

    const bChats = await chatsForTenant(TENANT_B);
    expect(bChats.length).toBe(1);
    expect(bChats[0]?.instanceId).toBe(INSTANCE_B);
    expect(await messagesForTenant(TENANT_B)).toEqual([{ id: expect.any(String), textContent: 'hello from B' }]);

    // A's row is untouched: same id, same text, still exactly one.
    const aMessages = await messagesForTenant(TENANT_A);
    expect(aMessages.length).toBe(1);
    expect(aMessages[0]?.textContent).toBe('hello from A');

    // Two chats and two messages exist in total — one per tenant, never shared.
    expect(totalChats()).toEqual({ chats: 2, messages: 2 });
  }, 30_000);

  test("a B-scoped envelope naming A's instance writes nothing under either tenant", async () => {
    const before = totalChats();

    // The envelope claims tenant B; the instance it names belongs to A. The
    // chat insert's derivation trigger computes A from `instance_id` while the
    // scope is B, so the RLS WITH CHECK refuses it. The handler rethrows (the
    // consumer's retry/DLQ contract) — what matters is that NOTHING lands.
    await expect(
      fire(
        'message.received',
        receivedEvent({ instanceId: INSTANCE_A, envelopeVersion: 1, tenantId: TENANT_B, text: 'cross-tenant' }),
      ),
    ).rejects.toThrow();
    await drain();

    expect(totalChats()).toEqual(before);
    // Neither tenant gained a row, and A's text is still A's.
    expect((await messagesForTenant(TENANT_A)).map((m) => m.textContent)).toEqual(['hello from A']);
    expect((await messagesForTenant(TENANT_B)).map((m) => m.textContent)).toEqual(['hello from B']);
  }, 30_000);

  test('a malformed envelope (tenant claim, no version) is quarantined before any write', async () => {
    const before = totalChats();

    await expect(
      fire('message.received', receivedEvent({ instanceId: INSTANCE_A, tenantId: TENANT_A, text: 'quarantine me' })),
    ).rejects.toThrow(/quarantin|worker-tenant-context/i);
    await drain();

    // Not processed globally, not processed at all.
    expect(totalChats()).toEqual(before);
  }, 30_000);

  test('a legacy envelope writes NOTHING under the runtime role — the dual world is data, not a branch', async () => {
    // A legacy (unversioned, tenant-less) envelope runs the same handler body on
    // the ambient pool, exactly as pre-G5. Under RLS enforcement with no scope
    // set, the runtime role's policies match no rows, so the write is refused
    // rather than silently landing NULL-tenant. This is the enforcement-mode
    // shape of the dual world; a flag-off deployment (no RLS) keeps the
    // byte-identical pre-G5 behaviour, which the unit suite covers.
    const before = totalChats();

    await expect(fire('message.received', receivedEvent({ instanceId: INSTANCE_A, text: 'legacy' }))).rejects.toThrow();
    await drain();

    expect(totalChats()).toEqual(before);
    // And no cross-tenant residue: each tenant still sees exactly its own row.
    expect((await chatsForTenant(TENANT_A)).length).toBe(1);
    expect((await chatsForTenant(TENANT_B)).length).toBe(1);
  }, 30_000);

  test("chat lookups are tenant-scoped: A cannot reach B's chat by its UUID", async () => {
    const bChat = (await chatsForTenant(TENANT_B))[0];
    expect(bChat).toBeTruthy();
    const bChatId = bChat?.id as string;

    const seenByA = await runInWorkerTenantScope(runtimeDb, TENANT_A, async () =>
      scopedHandle(runtimeDb)
        .select({ id: chats.id })
        .from(chats)
        .where(and(eq(chats.id, bChatId), eq(chats.externalId, SHARED_JID))),
    );
    expect(seenByA).toEqual([]);
  }, 30_000);
});
