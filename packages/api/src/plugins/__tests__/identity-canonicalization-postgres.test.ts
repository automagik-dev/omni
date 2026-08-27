/**
 * Identity canonicalization + system/agent exclusion over real PostgreSQL
 * (omni identity rework, P0 — anti-fragmentation).
 *
 * Drives the REAL registered `message.received` handler (through a capture bus
 * and a real `Services` container) against a real database, in the LEGACY world
 * (unversioned, tenant-less envelopes → ambient pool, no RLS applied). It proves
 * the P0 guarantees on the exact code the inbound consumer runs:
 *
 *   1. bare `5511…` and `5511…@s.whatsapp.net` (and a device-suffixed JID) from
 *      the same instance resolve to ONE identity and ONE person;
 *   2. a Twilio `whatsapp:+E164` sender phone-matches an existing person that a
 *      Baileys number already created (cross-channel link, no fork);
 *   3. `internal` (from = an instance UUID) creates NO human person or identity;
 *   4. `a2a` (from = an agent subject) creates NO human person or identity.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read. RLS is deliberately NOT
 * enforced here: this suite tests handle canonicalization, not tenant isolation
 * (that is covered by `message-persistence-two-tenant-postgres.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventBus } from '@omni/core';
import { type Database, createDbHandle, persons, platformIdentities } from '@omni/db';
import { eq } from 'drizzle-orm';
import { createServices } from '../../services';
import { setupMessagePersistence } from '../message-persistence';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const INSTANCE_WA = '55555555-5555-4555-8555-5555555555c1';
const INSTANCE_TWILIO = '55555555-5555-4555-8555-5555555555c2';
const INSTANCE_INTERNAL = '55555555-5555-4555-8555-5555555555c3';
const INSTANCE_A2A = '55555555-5555-4555-8555-5555555555c4';

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-p0-canon-${crypto.randomUUID()}.sql`);
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

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
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

/** A LEGACY `message.received` envelope: no version, no tenant → ambient pool. */
function receivedEvent(opts: {
  instanceId: string;
  channelType: string;
  from: string;
  chatId?: string;
  externalId?: string;
  text?: string;
  rawPayload?: Record<string, unknown>;
}): unknown {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.parse('2026-01-01T00:00:00Z'),
    payload: {
      externalId: opts.externalId ?? crypto.randomUUID(),
      chatId: opts.chatId ?? opts.from,
      from: opts.from,
      senderName: 'Sender',
      content: { type: 'text', text: opts.text ?? 'hello' },
      rawPayload: opts.rawPayload ?? {},
    },
    metadata: {
      instanceId: opts.instanceId,
      channelType: opts.channelType,
    },
  };
}

/** Let the handler's fire-and-forget continuations settle. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

postgresDescribe('identity canonicalization + exclusion (real PostgreSQL)', () => {
  const dbName = `omni_p0_canon_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let fire: (type: string, event: unknown) => Promise<void>;

  beforeAll(async () => {
    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    const dbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(dbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    // Instances are seeded WITHOUT a tenant. This suite runs the legacy world
    // (no RLS): a non-null instance tenant would make the derivation trigger
    // stamp platform_identities.tenant_id while the handler-created persons row
    // stays tenant-less, breaking the composite FK
    // platform_identities_person_id_tenant_fk. Tenant isolation is not under
    // test here — message-persistence-two-tenant-postgres.test.ts covers it.
    const seeded = runSqlOn(
      dbUrl,
      `
      INSERT INTO instances (id, name, channel, created_at) VALUES
        ('${INSTANCE_WA}',       'inst-wa',       'whatsapp-baileys', now()),
        ('${INSTANCE_TWILIO}',   'inst-twilio',   'twilio-whatsapp',  now()),
        ('${INSTANCE_INTERNAL}', 'inst-internal', 'internal',         now()),
        ('${INSTANCE_A2A}',      'inst-a2a',      'a2a',              now());
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const handle = createDbHandle({ url: dbUrl, maxConnections: 4 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;

    const captured = captureBus();
    fire = captured.fire;
    await setupMessagePersistence(captured.bus, createServices(db, null));
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  const identitiesForInstance = (instanceId: string) =>
    db
      .select({
        id: platformIdentities.id,
        platformUserId: platformIdentities.platformUserId,
        personId: platformIdentities.personId,
      })
      .from(platformIdentities)
      .where(eq(platformIdentities.instanceId, instanceId));

  const personByPhone = (phone: string) =>
    db.select({ id: persons.id }).from(persons).where(eq(persons.primaryPhone, phone));

  test('bare + suffixed + device-suffixed WhatsApp forms → ONE identity, ONE person', async () => {
    const number = '5511999990000';
    await fire(
      'message.received',
      receivedEvent({ instanceId: INSTANCE_WA, channelType: 'whatsapp-baileys', from: number, externalId: 'm-bare' }),
    );
    await drain();
    await fire(
      'message.received',
      receivedEvent({
        instanceId: INSTANCE_WA,
        channelType: 'whatsapp-baileys',
        from: `${number}@s.whatsapp.net`,
        externalId: 'm-suffixed',
      }),
    );
    await drain();
    await fire(
      'message.received',
      receivedEvent({
        instanceId: INSTANCE_WA,
        channelType: 'whatsapp-baileys',
        from: `${number}:7@s.whatsapp.net`,
        externalId: 'm-device',
      }),
    );
    await drain();

    const identities = await identitiesForInstance(INSTANCE_WA);
    expect(identities.length).toBe(1);
    expect(identities[0]?.platformUserId).toBe(`${number}@s.whatsapp.net`);
    expect(identities[0]?.personId).toBeTruthy();

    // Exactly one person carries this phone.
    expect((await personByPhone(`+${number}`)).length).toBe(1);
  }, 30_000);

  test('a Twilio whatsapp:+E164 sender phone-matches the existing person (no fork)', async () => {
    const number = '5511888880000';
    // Baileys first-contact creates the person with +E164.
    await fire(
      'message.received',
      receivedEvent({ instanceId: INSTANCE_WA, channelType: 'whatsapp-baileys', from: number, externalId: 't-wa' }),
    );
    await drain();
    const waPerson = await personByPhone(`+${number}`);
    expect(waPerson.length).toBe(1);
    const personId = waPerson[0]?.id;

    // Twilio sends the SAME human as whatsapp:+E164 — must link to that person.
    await fire(
      'message.received',
      receivedEvent({
        instanceId: INSTANCE_TWILIO,
        channelType: 'twilio-whatsapp',
        from: `whatsapp:+${number}`,
        externalId: 't-twilio',
      }),
    );
    await drain();

    const twilioIdentities = await identitiesForInstance(INSTANCE_TWILIO);
    expect(twilioIdentities.length).toBe(1);
    expect(twilioIdentities[0]?.platformUserId).toBe(`${number}@s.whatsapp.net`);
    expect(twilioIdentities[0]?.personId).toBe(personId);

    // Still exactly one person for this phone — the contact did not fork.
    expect((await personByPhone(`+${number}`)).length).toBe(1);
  }, 30_000);

  test('internal channel (from = instance UUID) creates NO person and NO identity', async () => {
    const before = (await db.select({ id: persons.id }).from(persons)).length;
    await fire(
      'message.received',
      receivedEvent({
        instanceId: INSTANCE_INTERNAL,
        channelType: 'internal',
        from: INSTANCE_WA,
        chatId: INSTANCE_WA,
        externalId: 'i-1',
      }),
    );
    await drain();

    expect((await identitiesForInstance(INSTANCE_INTERNAL)).length).toBe(0);
    expect((await db.select({ id: persons.id }).from(persons)).length).toBe(before);
  }, 30_000);

  test('a2a channel (from = agent subject) creates NO person and NO identity', async () => {
    const before = (await db.select({ id: persons.id }).from(persons)).length;
    await fire(
      'message.received',
      receivedEvent({
        instanceId: INSTANCE_A2A,
        channelType: 'a2a',
        from: 'a2a:ctx-123',
        chatId: 'task-123',
        externalId: 'a-1',
      }),
    );
    await drain();

    expect((await identitiesForInstance(INSTANCE_A2A)).length).toBe(0);
    expect((await db.select({ id: persons.id }).from(persons)).length).toBe(before);
  }, 30_000);
});
