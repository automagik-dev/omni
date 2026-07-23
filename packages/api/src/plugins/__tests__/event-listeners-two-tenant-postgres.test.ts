/**
 * Two-tenant EVENT-LISTENERS containment over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0004).
 *
 * `event-listeners.ts` registers small NATS/eventBus consumers that update
 * connection state on `instances`, persist LID→phone mappings to
 * `chat_id_mappings`, and write contact names / unread counts to `chats`.
 * Before G5 all of them ran on the ambient pool — the `pending-G5-conversion`
 * sites for this file.
 *
 * This suite exercises the REAL registered handlers (captured through a fake
 * eventBus, exactly as `setup*Listener` wires them) against a disposable
 * RLS-enforced database:
 *
 *   * a tenant-world envelope runs the handler's DB work inside the worker
 *     tenant scope and lands only under that tenant;
 *   * an envelope forged for the OTHER tenant's resource writes nothing —
 *     RLS row visibility + the WITH CHECK derivation refuse it rather than
 *     trusting the payload;
 *   * a malformed envelope (tenant claim without a version) is refused
 *     outright — no global-processing fallback.
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
  chatIdMappings,
  chats,
  createDbHandle,
  instances,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import {
  setupChatUnreadListener,
  setupConnectionListener,
  setupContactNamesListener,
  setupLidMappingListener,
} from '../event-listeners';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111ea';
const TENANT_B = '22222222-2222-4222-8222-2222222222eb';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555ea';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555eb';
const CHAT_A = '66666666-6666-4666-8666-6666666666ea';
const CHAT_B = '66666666-6666-4666-8666-6666666666eb';

const JID = '5511999990000@s.whatsapp.net';
const LID = '123456789@lid';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-listeners-${crypto.randomUUID()}.sql`);
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

/** Capture the handlers `setup*Listener` registers, exactly as wired. */
function captureBus() {
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const bus = {
    subscribe: async (type: string, handler: (event: never) => Promise<void>) => {
      handlers.set(type, handler as unknown as (event: unknown) => Promise<void>);
    },
    subscribePattern: async (type: string, handler: (event: never) => Promise<void>) => {
      handlers.set(type, handler as unknown as (event: unknown) => Promise<void>);
    },
  } as unknown as EventBus;
  const fire = (type: string, event: unknown): Promise<void> => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no handler registered for ${type}`);
    return handler(event);
  };
  return { bus, fire };
}

/** A consumer-side event: tenant world, legacy world, or a malformed forgery. */
function eventWith(
  tenantId: string | null | 'malformed',
  payload: Record<string, unknown>,
  extraMetadata: Record<string, unknown> = {},
): { id: string; payload: Record<string, unknown>; metadata: Record<string, unknown>; timestamp: number } {
  const metadata: Record<string, unknown> = { correlationId: `evt-${crypto.randomUUID()}`, ...extraMetadata };
  if (tenantId === 'malformed') {
    metadata.tenantId = TENANT_A; // a tenant claim with NO envelope version
  } else if (tenantId) {
    metadata.envelopeVersion = 1;
    metadata.tenantId = tenantId;
  }
  return { id: crypto.randomUUID(), payload, metadata, timestamp: Date.now() };
}

postgresDescribe('two-tenant event-listeners containment (real PostgreSQL)', () => {
  const dbName = `omni_g5_listeners_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  let fire: (type: string, event: unknown) => Promise<void>;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  const instanceForTenant = (tenantId: string, instanceId: string): Promise<{ isActive: boolean | null }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ isActive: instances.isActive })
        .from(instances)
        .where(eq(instances.id, instanceId)),
    );

  const mappingsForTenant = (tenantId: string, instanceId: string): Promise<{ lidId: string }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ lidId: chatIdMappings.lidId })
        .from(chatIdMappings)
        .where(eq(chatIdMappings.instanceId, instanceId)),
    );

  const chatForTenant = (
    tenantId: string,
    chatId: string,
  ): Promise<{ name: string | null; unreadCount: number | null }[]> =>
    runInWorkerTenantScope(runtimeDb, tenantId, async () =>
      scopedHandle(runtimeDb)
        .select({ name: chats.name, unreadCount: chats.unreadCount })
        .from(chats)
        .where(eq(chats.id, chatId)),
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

      INSERT INTO instances (id, name, channel, tenant_id, is_active, created_at) VALUES
        ('${INSTANCE_A}', 'inst-a', 'whatsapp-baileys', '${TENANT_A}', false, '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'inst-b', 'whatsapp-baileys', '${TENANT_B}', false, '${SHARED_TIMESTAMP}');

      INSERT INTO chats (id, instance_id, external_id, canonical_id, chat_type, channel, name, tenant_id, created_at)
      VALUES
        ('${CHAT_A}', '${INSTANCE_A}', '${JID}', '${JID}', 'direct', 'whatsapp-baileys', NULL,
         '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${INSTANCE_B}', '${JID}', '${JID}', 'direct', 'whatsapp-baileys', NULL,
         '${TENANT_B}', '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical connection shared by both tenants' workers: any bleed shows here.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 1);

    // Register the REAL handlers against the runtime handle.
    const captured = captureBus();
    fire = captured.fire;
    await setupConnectionListener(captured.bus, runtimeDb);
    await setupLidMappingListener(captured.bus, runtimeDb);
    await setupContactNamesListener(captured.bus, runtimeDb);
    await setupChatUnreadListener(captured.bus, runtimeDb);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test("instance.connected under A's envelope activates A's instance (and only A's)", async () => {
    await fire(
      'instance.connected',
      eventWith(TENANT_A, { instanceId: INSTANCE_A, channelType: 'whatsapp-baileys', profileName: 'A' }),
    );

    expect(await instanceForTenant(TENANT_A, INSTANCE_A)).toEqual([{ isActive: true }]);
    expect(await instanceForTenant(TENANT_B, INSTANCE_B)).toEqual([{ isActive: false }]);
  });

  test("an A-envelope aiming at B's instanceId updates nothing (payload is not trusted)", async () => {
    await fire(
      'instance.connected',
      eventWith(TENANT_A, { instanceId: INSTANCE_B, channelType: 'whatsapp-baileys', profileName: 'forged' }),
    );

    // B's instance is invisible to A's scope — the update matched zero rows.
    expect(await instanceForTenant(TENANT_B, INSTANCE_B)).toEqual([{ isActive: false }]);
  });

  test("instance.disconnected (logged out) under A deactivates only A's instance", async () => {
    await fire(
      'instance.disconnected',
      eventWith(TENANT_A, {
        instanceId: INSTANCE_A,
        channelType: 'whatsapp-baileys',
        willReconnect: false,
        reason: 'Connection logged out',
      }),
    );

    expect(await instanceForTenant(TENANT_A, INSTANCE_A)).toEqual([{ isActive: false }]);
  });

  test("lid-mapping batch under A persists only under A; a B-envelope aiming at A's instance persists nothing", async () => {
    await fire(
      'custom.lid-mapping.batch',
      eventWith(TENANT_A, { mappings: [{ lidJid: LID, phoneJid: JID }] }, { instanceId: INSTANCE_A }),
    );

    expect((await mappingsForTenant(TENANT_A, INSTANCE_A)).map((m) => m.lidId)).toEqual([LID]);
    expect(await mappingsForTenant(TENANT_B, INSTANCE_A)).toEqual([]);

    // B's worker envelope aiming at A's instance: the derivation/WITH CHECK
    // refuses the cross-tenant insert; the handler's per-item skip swallows it.
    await fire(
      'custom.lid-mapping.batch',
      eventWith(TENANT_B, { mappings: [{ lidJid: '987654321@lid', phoneJid: JID }] }, { instanceId: INSTANCE_A }),
    );

    expect((await mappingsForTenant(TENANT_A, INSTANCE_A)).map((m) => m.lidId)).toEqual([LID]);
    expect(await mappingsForTenant(TENANT_B, INSTANCE_A)).toEqual([]);
  });

  test("contact names under A rename only A's chat; a B-envelope cannot rename A's chat", async () => {
    await fire(
      'custom.contacts.names',
      eventWith(TENANT_A, { names: [{ jid: JID, name: 'Alice' }] }, { instanceId: INSTANCE_A }),
    );

    expect((await chatForTenant(TENANT_A, CHAT_A))[0]?.name).toBe('Alice');
    expect((await chatForTenant(TENANT_B, CHAT_B))[0]?.name).toBeNull();

    // A B-envelope aiming at A's instance/chat sees no rows to update.
    await fire(
      'custom.contacts.names',
      eventWith(TENANT_B, { names: [{ jid: JID, name: 'Mallory' }] }, { instanceId: INSTANCE_A }),
    );
    expect((await chatForTenant(TENANT_A, CHAT_A))[0]?.name).toBe('Alice');
  });

  test("unread-updated under A updates A's chat; a B-envelope aiming at A's chat writes nothing", async () => {
    await fire(
      'custom.chat.unread-updated',
      eventWith(TENANT_A, { chatId: JID, unreadCount: 7 }, { instanceId: INSTANCE_A }),
    );

    expect((await chatForTenant(TENANT_A, CHAT_A))[0]?.unreadCount).toBe(7);
    expect((await chatForTenant(TENANT_B, CHAT_B))[0]?.unreadCount).toBe(0);

    await fire(
      'custom.chat.unread-updated',
      eventWith(TENANT_B, { chatId: JID, unreadCount: 99 }, { instanceId: INSTANCE_A }),
    );
    expect((await chatForTenant(TENANT_A, CHAT_A))[0]?.unreadCount).toBe(7);
  });

  test('a malformed envelope (tenant claim, no version) is refused — nothing is written', async () => {
    await fire(
      'instance.connected',
      eventWith('malformed', { instanceId: INSTANCE_A, channelType: 'whatsapp-baileys', profileName: 'X' }),
    );

    // Still inactive from the disconnect test above — the forged envelope was
    // quarantine-refused, not processed globally.
    expect(await instanceForTenant(TENANT_A, INSTANCE_A)).toEqual([{ isActive: false }]);
  });
});
