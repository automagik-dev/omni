/**
 * Platform credential bootstrap against real PostgreSQL (issue #980).
 *
 * Proves the operator bootstrap path end-to-end on a migrated schema:
 *   - first run creates principal + `platform_api_keys` + PLATFORM-class
 *     `auth_credentials`, and the credential resolves through the REAL
 *     `AuthBootstrapService` lookup (every class-binding invariant holds);
 *   - a second run converges (no duplicate principals/keys/credentials);
 *   - explicit rotation replaces the material and kills the old secret;
 *   - drift/tamper is blocked (fail-closed), never silently repaired;
 *   - a legacy `*` god key is NEVER auto-promoted into the auth plane;
 *   - the report carries no secret material.
 *
 * Set `OMNI_G3_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Database, apiKeys, authCredentials, createDbHandle, platformApiKeys, principals } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { generateSecret, hashSecret, secretPrefix } from '../../tenancy/hash';
import { AuthBootstrapService } from '../auth-bootstrap';
import { PlatformBootstrapService } from '../platform-bootstrap';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const SUBJECT = 'platform-operator';
const KEY_NAME = 'platform-operator';

postgresDescribe('platform credential bootstrap (real PostgreSQL)', () => {
  const dbName = `omni_980_bootstrap_${crypto.randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let service: PlatformBootstrapService;
  let authPlane: AuthBootstrapService;
  const closers: (() => Promise<void>)[] = [];

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 4 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;
    service = new PlatformBootstrapService(db);
    authPlane = new AuthBootstrapService(db);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    const admin = createDbHandle({ url: superUrl, maxConnections: 1 });
    await admin.db.execute(sql.raw(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`));
    await admin.close();
  });

  let firstSecret = '';

  test('first run creates the full platform triple and passes real auth resolution', async () => {
    const { report, secret } = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME });

    expect(report.status).toBe('created');
    expect(secret).toStartWith('omni_sk_');
    expect(report.verification).toEqual({ attempted: true, ok: true, credentialClass: 'platform' });
    expect(report.principal?.created).toBe(true);
    firstSecret = secret ?? '';

    // The credential resolves through the production auth path.
    const resolved = await authPlane.lookupBySecret(firstSecret, 'req-bootstrap-1');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('unreachable');
    expect(resolved.context.credentialClass).toBe('platform');
    expect([...resolved.context.scopes]).toEqual(['platform:*']);

    // Every resolvePlatformContext class-binding invariant holds on the rows.
    const [credential] = await db
      .select()
      .from(authCredentials)
      .where(eq(authCredentials.keyHash, await hashSecret(firstSecret)));
    expect(credential?.credentialClass).toBe('platform');
    expect(credential?.tenantId).toBeNull();
    expect(credential?.membershipId).toBeNull();
    expect(credential?.tenantKeyLineageId).toBeNull();
    expect(credential?.actorRole).toBeNull();
    expect(credential?.platformApiKeyId).not.toBeNull();
    const [key] = await db.select().from(platformApiKeys).where(eq(platformApiKeys.name, KEY_NAME));
    expect(key?.keyHash).toBe(credential?.keyHash ?? '');
    expect(key?.principalId).toBe(credential?.principalId ?? '');
    expect(key?.scopes).toEqual([...(credential?.scopes ?? [])]);
  });

  test('the report carries no secret material', async () => {
    const { report, secret } = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME });
    const serialized = JSON.stringify(report);
    expect(secret).toBeNull(); // converged run — nothing to leak anyway
    expect(serialized).not.toContain(firstSecret);
    expect(serialized).not.toContain(await hashSecret(firstSecret));
    // No full credential shape anywhere (the 8-char display prefix is allowed).
    expect(serialized).not.toMatch(/omni_sk_[A-Za-z0-9]{9,}/);
  });

  test('a second run converges: no duplicate principals, keys, or credentials', async () => {
    const { report, secret } = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME });

    expect(report.status).toBe('converged');
    expect(secret).toBeNull();
    expect(report.verification.ok).toBe(true);

    expect(await db.select().from(principals).where(eq(principals.subject, SUBJECT))).toHaveLength(1);
    expect(await db.select().from(platformApiKeys).where(eq(platformApiKeys.name, KEY_NAME))).toHaveLength(1);
    expect(await db.select().from(authCredentials).where(eq(authCredentials.credentialClass, 'platform'))).toHaveLength(
      1,
    );

    // The original secret still resolves — convergence rotated nothing.
    const resolved = await authPlane.lookupBySecret(firstSecret, 'req-bootstrap-2');
    expect(resolved.ok).toBe(true);
  });

  test('a legacy `*` god key is never promoted into the auth plane', async () => {
    const legacySecret = generateSecret();
    const legacyHash = await hashSecret(legacySecret);
    await db.insert(apiKeys).values({
      name: 'legacy-god-key',
      keyPrefix: secretPrefix(legacySecret),
      keyHash: legacyHash,
      scopes: ['*'],
    });

    const { report } = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME });
    expect(report.status).toBe('converged');

    // The legacy key did not become a platform credential.
    expect(await db.select().from(authCredentials).where(eq(authCredentials.keyHash, legacyHash))).toHaveLength(0);
    const resolved = await authPlane.lookupBySecret(legacySecret, 'req-bootstrap-legacy');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error('unreachable');
    expect(resolved.reason).toBe('not_found');
  });

  test('tampered credential state is blocked without --rotate, never silently repaired', async () => {
    await db
      .update(authCredentials)
      .set({ scopes: ['platform:tenants:read'] })
      .where(eq(authCredentials.credentialClass, 'platform'));

    const { report, secret } = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME });
    expect(report.status).toBe('blocked');
    expect(secret).toBeNull();
    expect(report.reasons.join(' ')).toContain('--rotate');

    // Nothing was repaired behind the operator's back.
    const [credential] = await db.select().from(authCredentials).where(eq(authCredentials.credentialClass, 'platform'));
    expect(credential?.scopes).toEqual(['platform:tenants:read']);
  });

  test('explicit rotation replaces the material and kills the old secret', async () => {
    const { report, secret } = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME, rotate: true });

    expect(report.status).toBe('rotated');
    expect(secret).toStartWith('omni_sk_');
    expect(secret).not.toBe(firstSecret);
    expect(report.verification.ok).toBe(true);

    const oldResolved = await authPlane.lookupBySecret(firstSecret, 'req-bootstrap-old');
    expect(oldResolved.ok).toBe(false);
    const newResolved = await authPlane.lookupBySecret(secret ?? '', 'req-bootstrap-new');
    expect(newResolved.ok).toBe(true);
    if (!newResolved.ok) throw new Error('unreachable');
    expect([...newResolved.context.scopes]).toEqual(['platform:*']);

    // Still exactly one of everything.
    expect(await db.select().from(principals).where(eq(principals.subject, SUBJECT))).toHaveLength(1);
    expect(await db.select().from(platformApiKeys).where(eq(platformApiKeys.name, KEY_NAME))).toHaveLength(1);
    expect(await db.select().from(authCredentials).where(eq(authCredentials.credentialClass, 'platform'))).toHaveLength(
      1,
    );
    firstSecret = secret ?? '';
  });

  test('a key name bound to a different principal is blocked and rolls back everything', async () => {
    const { report, secret } = await service.bootstrap({ subject: 'other-operator', keyName: KEY_NAME });
    expect(report.status).toBe('blocked');
    expect(secret).toBeNull();
    expect(report.reasons.join(' ')).toContain('different principal');

    // The blocked run wrote nothing — not even the new principal.
    expect(await db.select().from(principals).where(eq(principals.subject, 'other-operator'))).toHaveLength(0);
  });

  test('a disabled principal is blocked — re-enabling is not a bootstrap side effect', async () => {
    await db
      .insert(principals)
      .values({ type: 'service', subject: 'disabled-operator', status: 'disabled', disabledAt: new Date() });

    const { report } = await service.bootstrap({ subject: 'disabled-operator', keyName: 'disabled-operator-key' });
    expect(report.status).toBe('blocked');
    expect(report.reasons.join(' ')).toContain('disabled');
    expect(
      await db.select().from(platformApiKeys).where(eq(platformApiKeys.name, 'disabled-operator-key')),
    ).toHaveLength(0);
  });

  test('an expired key blocks convergence but rotates explicitly (expiry reset)', async () => {
    await db
      .update(platformApiKeys)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(platformApiKeys.name, KEY_NAME));

    const blocked = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME });
    expect(blocked.report.status).toBe('blocked');
    expect(blocked.report.reasons.join(' ')).toContain('expired');

    const rotated = await service.bootstrap({ subject: SUBJECT, keyName: KEY_NAME, rotate: true });
    expect(rotated.report.status).toBe('rotated');
    expect(rotated.report.verification.ok).toBe(true);
    const [key] = await db.select().from(platformApiKeys).where(eq(platformApiKeys.name, KEY_NAME));
    expect(key?.expiresAt).toBeNull();
  });
});
