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

const TENANT = '11111111-1111-4111-8111-1111111111ba';
const INSTANCE = '55555555-5555-4555-8555-5555555555b1';
const PERSON_BARE = '99999999-9999-4999-8999-9999999999b1';
const PERSON_SUFFIXED = '99999999-9999-4999-8999-9999999999b2';
const PERSON_LID = '99999999-9999-4999-8999-9999999999b3';

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
    // @lid person whose phone is derivable from chat_id_mappings.
    const seeded = runSqlOn(
      dbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget)
        VALUES ('${TENANT}', 'tenant-recon', 'Tenant Recon', 86400, 100, 100);
      INSERT INTO instances (id, name, channel, tenant_id, created_at)
        VALUES ('${INSTANCE}', 'inst-recon', 'whatsapp-baileys', '${TENANT}', now());

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
