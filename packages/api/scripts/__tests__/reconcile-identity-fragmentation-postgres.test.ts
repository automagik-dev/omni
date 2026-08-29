/**
 * Reconciliation script DRY-RUN safety over real PostgreSQL
 * (omni identity rework, P0 — reconciliation deliverable).
 *
 * Seeds a fragmented identity graph (the same WhatsApp number under two handle
 * spellings pointing at two different persons) plus a phone-less `@lid` person
 * with a known `chat_id_mappings` phone, then runs the reconciliation script's
 * `reconcile()` in its DEFAULT DRY-RUN mode. Proves two things:
 *
 *   1. dry run DETECTS the work (non-zero counts in the returned stats), and
 *   2. dry run MUTATES NOTHING — identity/person row counts and field values are
 *      byte-identical before and after.
 *
 * The script is only ever run with `--apply` by a human against a real DB; this
 * test never passes that flag. Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE
 * superuser URL (`scripts/pg-gate.ts` does that for you). No ambient
 * `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Database, createDbHandle, persons, platformIdentities } from '@omni/db';
import { reconcile } from '../reconcile-identity-fragmentation';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', 'db', 'drizzle');

const INSTANCE = '55555555-5555-4555-8555-5555555555b1';
const PERSON_BARE = '99999999-9999-4999-8999-9999999999b1';
const PERSON_SUFFIXED = '99999999-9999-4999-8999-9999999999b2';
const PERSON_LID = '99999999-9999-4999-8999-9999999999b3';
const PERSON_PHONE = '99999999-9999-4999-8999-9999999999b4';

/** Every migration SQL file concatenated, applied to a fresh database. */
function loadMigrations(): string {
  return readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
    .join('\n');
}

/**
 * Create + migrate a fresh disposable database, returning a handle and a
 * cleanup that closes the pool and drops the database. Each apply-mode scenario
 * gets its own database so a write in one never bleeds into another.
 */
async function provisionDatabase(): Promise<{
  db: Database;
  seed: (script: string) => void;
  cleanup: () => Promise<void>;
}> {
  const dbName = `omni_p0_recon_${crypto.randomUUID().replaceAll('-', '')}`;
  const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
  if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);
  const dbUrl = urlFor(superUrl, dbName);
  const migrated = runSqlOn(dbUrl, loadMigrations());
  if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);
  const handle = createDbHandle({ url: dbUrl, maxConnections: 2 });
  return {
    db: handle.db,
    seed: (script: string) => {
      const res = runSqlOn(dbUrl, script);
      if (res.exitCode !== 0) throw new Error(`seed failed: ${res.stderr}`);
    },
    cleanup: async () => {
      await handle.close().catch(() => undefined);
      runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
    },
  };
}

/**
 * Wrap a database handle so a `DELETE FROM platform_identities` throws — a fault
 * injected into the SECOND phase of a group's mutation (`absorbIdentity`), i.e.
 * AFTER the first phase (`mergePersons`, which deletes the merged-away person)
 * has already run to completion. That placement is deliberate: it proves the
 * whole per-group sequence is atomic, not merely each helper in isolation —
 * without the group-level transaction the committed person merge survives the
 * later failure, leaving the group half-processed. The wrapper re-wraps the
 * transaction handle drizzle hands to `db.transaction`, so the fault lands
 * whether the mutation runs on the pool (buggy) or inside a transaction (fixed).
 */
function wrapWithDeleteFault(handle: object): object {
  return new Proxy(handle, {
    get(target, prop, receiver) {
      if (prop === 'delete') {
        const del = Reflect.get(target, prop, receiver) as (table: unknown) => unknown;
        return (table: unknown) => {
          if (table === platformIdentities) {
            throw new Error('injected fault: platform_identities delete disabled mid-reconcile');
          }
          return del.call(target, table);
        };
      }
      if (prop === 'transaction') {
        const tx = Reflect.get(target, prop, receiver) as (
          fn: (t: object) => Promise<unknown>,
          config?: unknown,
        ) => Promise<unknown>;
        return (fn: (t: object) => Promise<unknown>, config?: unknown) =>
          tx.call(target, (inner: object) => fn(wrapWithDeleteFault(inner)), config);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-p0-recon-${crypto.randomUUID()}.sql`);
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

postgresDescribe('reconciliation script dry-run mutates nothing (real PostgreSQL)', () => {
  const dbName = `omni_p0_recon_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;

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

    // Seed: a fragmented number (bare + suffixed → two persons) and a phone-less
    // @lid person whose phone is derivable from chat_id_mappings. The instance is
    // tenant-less so the derivation trigger leaves the seeded identities'
    // tenant_id NULL, matching the tenant-less persons (composite-FK safe); this
    // suite tests reconciliation, not tenancy.
    const seeded = runSqlOn(
      dbUrl,
      `
      INSERT INTO instances (id, name, channel, created_at)
        VALUES ('${INSTANCE}', 'inst-recon', 'whatsapp-baileys', now());

      INSERT INTO persons (id, primary_phone, created_at) VALUES
        ('${PERSON_BARE}',     '+5511777770000', '2026-01-01 00:00:00+00'),
        ('${PERSON_SUFFIXED}', NULL,             '2026-01-02 00:00:00+00'),
        ('${PERSON_LID}',      NULL,             '2026-01-03 00:00:00+00');

      INSERT INTO platform_identities (channel, instance_id, platform_user_id, person_id, created_at) VALUES
        ('whatsapp-baileys', '${INSTANCE}', '5511777770000',                  '${PERSON_BARE}',     '2026-01-01 00:00:00+00'),
        ('whatsapp-baileys', '${INSTANCE}', '5511777770000@s.whatsapp.net',   '${PERSON_SUFFIXED}', '2026-01-02 00:00:00+00'),
        ('whatsapp-baileys', '${INSTANCE}', '54958418317348@lid',             '${PERSON_LID}',      '2026-01-03 00:00:00+00');

      INSERT INTO chat_id_mappings (instance_id, lid_id, phone_id) VALUES
        ('${INSTANCE}', '54958418317348@lid', '5511666660000@s.whatsapp.net');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const handle = createDbHandle({ url: dbUrl, maxConnections: 2 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('dry run detects the fragmentation but writes nothing', async () => {
    const identitiesBefore = await db.select().from(platformIdentities);
    const personsBefore = await db.select().from(persons);

    const stats = await reconcile(db);

    // Detected: one fragmented group (bare + suffixed), a person merge, and the
    // @lid phone backfill are all seen.
    expect(stats.fragmentGroups).toBeGreaterThanOrEqual(1);
    expect(stats.identitiesMerged).toBeGreaterThanOrEqual(1);
    expect(stats.personsMerged).toBeGreaterThanOrEqual(1);
    expect(stats.phonesBackfilled + stats.phonelessMergedIntoPhonePerson).toBeGreaterThanOrEqual(1);

    // Mutated NOTHING: same rows, same fields.
    const identitiesAfter = await db.select().from(platformIdentities);
    const personsAfter = await db.select().from(persons);

    expect(identitiesAfter.length).toBe(identitiesBefore.length);
    expect(personsAfter.length).toBe(personsBefore.length);

    // The phone-less persons are still phone-less; the survivor still bare/suffixed.
    const phones = personsAfter.map((p) => p.primaryPhone);
    expect(phones.filter((p): p is string => p !== null).sort()).toEqual(['+5511777770000']);
    expect(phones.filter((p) => p === null).length).toBe(2);
    const userIds = identitiesAfter.map((i) => i.platformUserId).sort();
    expect(userIds).toEqual(['5511777770000', '5511777770000@s.whatsapp.net', '54958418317348@lid'].sort());
  }, 60_000);
});

/** A stable, order-independent snapshot of the rows a group mutation touches. */
async function snapshot(db: Database): Promise<string> {
  const ids = (await db.select().from(platformIdentities))
    .map((i) => `${i.id}|${i.platformUserId}|${i.personId}|${i.updatedAt?.toISOString() ?? ''}`)
    .sort();
  const ps = (await db.select().from(persons))
    .map((p) => `${p.id}|${p.primaryPhone}|${p.displayName}|${p.updatedAt?.toISOString() ?? ''}`)
    .sort();
  return JSON.stringify({ ids, ps });
}

postgresDescribe('reconciliation script --apply write-path safety (real PostgreSQL)', () => {
  // Bug #1: a mid-group failure must roll back the WHOLE group, all-or-nothing.
  test('group reconciliation is atomic: a mid-mutation failure leaves the group unchanged', async () => {
    const { db, seed, cleanup } = await provisionDatabase();
    try {
      // A fragmented number: bare (older) + suffixed (younger), two persons.
      seed(`
        INSERT INTO instances (id, name, channel, created_at)
          VALUES ('${INSTANCE}', 'inst-recon', 'whatsapp-baileys', now());
        INSERT INTO persons (id, primary_phone, created_at) VALUES
          ('${PERSON_BARE}',     '+5511777770000', '2026-01-01 00:00:00+00'),
          ('${PERSON_SUFFIXED}', NULL,             '2026-01-02 00:00:00+00');
        INSERT INTO platform_identities (channel, instance_id, platform_user_id, person_id, created_at) VALUES
          ('whatsapp-baileys', '${INSTANCE}', '5511777770000',                '${PERSON_BARE}',     '2026-01-01 00:00:00+00'),
          ('whatsapp-baileys', '${INSTANCE}', '5511777770000@s.whatsapp.net', '${PERSON_SUFFIXED}', '2026-01-02 00:00:00+00');
      `);

      const before = await snapshot(db);

      // Run apply-mode with a fault injected into the group's SECOND phase
      // (absorbIdentity's platform_identities DELETE), after the person merge
      // has already committed. Only a group-level transaction can undo that.
      const faulted = wrapWithDeleteFault(db) as unknown as Database;
      await expect(reconcile(faulted, { apply: true })).rejects.toThrow('injected fault');

      // All-or-nothing: the failed group must be byte-identical to before.
      // Without a transaction the pre-DELETE UPDATEs (person coalesce + identity
      // re-point) have already committed, so this snapshot differs.
      const after = await snapshot(db);
      expect(after).toBe(before);
    } finally {
      await cleanup();
    }
  }, 120_000);

  // Bug #2: Step-2 backfill must keep the OLDEST person (oldest-survives),
  // even when the older person is the phone-less @lid one.
  test('step-2 backfill keeps the OLDER @lid person as survivor', async () => {
    const { db, seed, cleanup } = await provisionDatabase();
    try {
      // @lid person is OLDER than the existing phone-person it will merge with.
      seed(`
        INSERT INTO instances (id, name, channel, created_at)
          VALUES ('${INSTANCE}', 'inst-recon', 'whatsapp-baileys', now());
        INSERT INTO persons (id, primary_phone, created_at) VALUES
          ('${PERSON_LID}',   NULL,             '2026-01-01 00:00:00+00'),  -- older
          ('${PERSON_PHONE}', '+5511666660000', '2026-01-02 00:00:00+00');  -- younger
        INSERT INTO platform_identities (channel, instance_id, platform_user_id, person_id, created_at) VALUES
          ('whatsapp-baileys', '${INSTANCE}', '54958418317348@lid', '${PERSON_LID}', '2026-01-01 00:00:00+00');
        INSERT INTO chat_id_mappings (instance_id, lid_id, phone_id) VALUES
          ('${INSTANCE}', '54958418317348@lid', '5511666660000@s.whatsapp.net');
      `);

      await reconcile(db, { apply: true });

      const survivors = await db.select().from(persons);
      const survivorIds = survivors.map((p) => p.id).sort();

      // Oldest survives: the @lid person stays, the younger phone-person is merged
      // away. The buggy version keeps the phone-person and DELETES the older @lid.
      expect(survivorIds).toEqual([PERSON_LID]);
      const [survivor] = survivors;
      expect(survivor?.id).toBe(PERSON_LID);
      expect(survivor?.primaryPhone).toBe('+5511666660000');
    } finally {
      await cleanup();
    }
  }, 120_000);
});
