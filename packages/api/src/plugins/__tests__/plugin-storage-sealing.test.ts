/**
 * Deliverable (g) — `plugin_storage.value` sealed at rest (G5; ADR-0008;
 * OWNERSHIP_MANIFEST `filesystem_session_state`).
 *
 * WHAT IS IN THIS COLUMN
 * ----------------------
 * The WhatsApp channel keeps its whole Baileys authentication state here:
 * `auth:<instanceId>:creds` is the credential blob that IS the WhatsApp session
 * (registration identity, noise key, signed identity key), and
 * `auth:<instanceId>:keys:<type>:<id>` are the Signal protocol keys. Whoever
 * reads those rows can impersonate the instance. ADR-0008 puts them squarely in
 * the tenant-owned secret-material class.
 *
 * WHERE THE TENANT COMES FROM
 * ---------------------------
 * `plugin_storage` is a G0-`split` table with no `tenant_id`, but every one of
 * these keys NAMES its instance, and `instances` is the ownership root. So the
 * binding is: parse the instance id out of the storage key, then ask the
 * instance-owner registry — the same trusted, DB-loaded derivation the publish
 * path uses. No payload, no header, no caller hint. A key that names no known
 * instance seals nothing and reads through as plaintext.
 *
 * The registry is empty flag-off (every `instances.tenant_id` is NULL), so this
 * whole surface is inert there without a single flag check, exactly like
 * `instance-owner-registry.ts` itself.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { __resetInstanceOwnerRegistry, rememberInstanceOwner } from '../../tenancy/instance-owner-registry';
import { isSealedCredentialField } from '../../tenancy/sealed-credentials';
import { __createPluginStorageForTest } from '../storage';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const INSTANCE_A = '33333333-3333-4333-8333-33333333333a';
const INSTANCE_B = '44444444-4444-4444-8444-44444444444b';
const MASTER_KEY = Buffer.alloc(32, 3);

beforeEach(() => __resetInstanceOwnerRegistry());
afterEach(() => {
  setTenantSecretMasterKey(null);
  __resetInstanceOwnerRegistry();
});

/** One-table stand-in for `plugin_storage`, keyed exactly as the real one. */
function makeStorageDb() {
  const rows = new Map<string, { pluginId: string; key: string; value: string; expiresAt: Date | null }>();
  let pending: { pluginId: string; key: string; value: string; expiresAt: Date | null } | null = null;
  let lastWhereKey: string | null = null;
  const db: Record<string, unknown> = {
    insert: () => ({
      values: (v: { pluginId: string; key: string; value: string; expiresAt: Date | null }) => {
        pending = v;
        return {
          onConflictDoUpdate: async () => {
            if (pending) rows.set(pending.key, pending);
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const row = lastWhereKey ? rows.get(lastWhereKey) : [...rows.values()][0];
            return row ? [row] : [];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => rows.clear() }),
  };
  return {
    db: db as unknown as Database,
    rows,
    /** The fake `where` is opaque, so tests name the row they expect back. */
    expectKey(key: string) {
      lastWhereKey = key;
    },
  };
}

describe('(g) plugin_storage.value — dual world', () => {
  test('no master key: Baileys creds are stored exactly as before (plaintext JSON)', async () => {
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    const { db, rows } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    await storage.set(`auth:${INSTANCE_A}:creds`, { noiseKey: 'nk-secret', registered: true });

    const stored = [...rows.values()][0];
    expect(stored?.value).toContain('nk-secret');
    expect(isSealedCredentialField(stored?.value)).toBe(false);
  });

  test('key configured but the instance has no known tenant: still plaintext', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    await storage.set(`auth:${INSTANCE_A}:creds`, { noiseKey: 'nk-secret' });

    expect([...rows.values()][0]?.value).toContain('nk-secret');
  });

  test('a key that names no instance at all is never sealed', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    const { db, rows } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    await storage.set('global:feature-cache', { some: 'value' });

    expect([...rows.values()][0]?.value).toContain('value');
  });
});

describe('(g) plugin_storage.value — sealed at rest', () => {
  test('owned instance + key: creds are sealed, and the same store reads them back', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    const { db, rows, expectKey } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    await storage.set(`auth:${INSTANCE_A}:creds`, { noiseKey: 'nk-secret', registered: true });

    const stored = [...rows.values()][0];
    expect(isSealedCredentialField(stored?.value)).toBe(true);
    expect(stored?.value).not.toContain('nk-secret');

    expectKey(`plugin:whatsapp-baileys:auth:${INSTANCE_A}:creds`);
    const read = await storage.get<{ noiseKey: string; registered: boolean }>(`auth:${INSTANCE_A}:creds`);
    expect(read).toEqual({ noiseKey: 'nk-secret', registered: true });
  });

  test('a string value (not an object) round-trips through the seal unchanged', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    const { db, expectKey } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    await storage.set(`auth:${INSTANCE_A}:keys:session:abc`, 'raw-signal-key');
    expectKey(`plugin:whatsapp-baileys:auth:${INSTANCE_A}:keys:session:abc`);
    expect(await storage.get<string>(`auth:${INSTANCE_A}:keys:session:abc`)).toBe('raw-signal-key');
  });
});

describe('(g) plugin_storage.value — cross-tenant refusal', () => {
  test('an instance owned by tenant B cannot open a blob sealed for tenant A', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    const { db, rows, expectKey } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    await storage.set(`auth:${INSTANCE_A}:creds`, { noiseKey: 'nk-secret' });

    // Re-file the sealed row under an instance owned by tenant B — the storage
    // key is the only thing an attacker controls here, and it must not help.
    const sealed = [...rows.values()][0];
    if (!sealed) throw new Error('expected a sealed row');
    const foreignKey = `plugin:whatsapp-baileys:auth:${INSTANCE_B}:creds`;
    rows.set(foreignKey, { ...sealed, key: foreignKey });
    rememberInstanceOwner({ id: INSTANCE_B, tenantId: TENANT_B });

    expectKey(foreignKey);
    expect(await storage.get(`auth:${INSTANCE_B}:creds`)).toBeNull();
  });

  test('a sealed blob is unreadable once the master key is withdrawn (fails closed to null)', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    const { db, expectKey } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    await storage.set(`auth:${INSTANCE_A}:creds`, { noiseKey: 'nk-secret' });
    setTenantSecretMasterKey(null);

    expectKey(`plugin:whatsapp-baileys:auth:${INSTANCE_A}:creds`);
    expect(await storage.get(`auth:${INSTANCE_A}:creds`)).toBeNull();
  });
});

describe('(g) plugin_storage.value — transitional reads', () => {
  test('a legacy plaintext row still reads while sealing is enabled', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    const { db, rows, expectKey } = makeStorageDb();
    const storage = __createPluginStorageForTest(db, 'whatsapp-baileys');

    const legacyKey = `plugin:whatsapp-baileys:auth:${INSTANCE_A}:creds`;
    rows.set(legacyKey, {
      pluginId: 'whatsapp-baileys',
      key: legacyKey,
      value: JSON.stringify({ noiseKey: 'legacy-plain' }),
      expiresAt: null,
    });

    expectKey(legacyKey);
    expect(await storage.get<{ noiseKey: string }>(`auth:${INSTANCE_A}:creds`)).toEqual({ noiseKey: 'legacy-plain' });
  });
});
