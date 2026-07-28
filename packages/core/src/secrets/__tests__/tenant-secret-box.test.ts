/**
 * Tenant-bound secret sealing — the credential/session-secret encryption
 * contract (wish: omni-full-multitenancy, Group G5; ADR-0008;
 * OWNERSHIP_MANIFEST `filesystem_session_state`).
 *
 * These are the RED-before-implement probes for deliverable (g):
 *
 *   * channel/provider/webhook credentials and session secrets are encrypted
 *     with a TENANT-BOUND context — the tenant id is both the per-tenant key
 *     salt and the AEAD associated data, so a secret sealed for tenant A CANNOT
 *     be decrypted under tenant B's context (the manifest's verification target,
 *     "session state cannot be decrypted/exported under another tenant");
 *   * plaintext never appears in the serialized sealed form (never in logs,
 *     caches, migration receipts, or object metadata);
 *   * DUAL WORLD: with no master key configured (flag-off/legacy) sealing is
 *     disabled and the wiring layer stores plaintext byte-identically — this
 *     module simply refuses to seal, it does not silently no-op into plaintext.
 *
 * Key material here is a synthetic, repo-local 32-byte constant. Live KMS/Vault
 * key custody is a NAMED DEFERRAL (see the module header).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  SECRET_BOX_VERSION,
  TenantSecretError,
  TenantSecretUnconfiguredError,
  isSealedSecret,
  isTenantSecretSealingEnabled,
  openTenantSecret,
  openTenantSecretJson,
  sealTenantSecret,
  sealTenantSecretJson,
  setTenantSecretMasterKey,
} from '../tenant-secret-box';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
// Synthetic, repo-local master key — never a real/production secret.
const MASTER_KEY = Buffer.alloc(32, 7);

function withKey(): void {
  setTenantSecretMasterKey(MASTER_KEY);
}

afterEach(() => {
  // Reset the module seam so one test's key cannot leak into another.
  setTenantSecretMasterKey(null);
});

describe('tenant-secret-box — sealing enablement (dual world)', () => {
  test('with no master key, sealing is disabled and seal refuses (not a silent plaintext no-op)', () => {
    setTenantSecretMasterKey(null);
    expect(isTenantSecretSealingEnabled()).toBe(false);
    expect(() => sealTenantSecret(TENANT_A, 'the-secret')).toThrow(TenantSecretUnconfiguredError);
  });

  test('with a master key configured, sealing is enabled', () => {
    withKey();
    expect(isTenantSecretSealingEnabled()).toBe(true);
  });
});

describe('tenant-secret-box — round trip within a tenant', () => {
  test('seal then open under the SAME tenant recovers the plaintext', () => {
    withKey();
    const sealed = sealTenantSecret(TENANT_A, 'baileys-session-creds');
    expect(isSealedSecret(sealed)).toBe(true);
    expect(sealed.v).toBe(SECRET_BOX_VERSION);
    expect(openTenantSecret(TENANT_A, sealed)).toBe('baileys-session-creds');
  });

  test('JSON helper round-trips an object credential blob', () => {
    withKey();
    const creds = { apiKey: 'sk-live-xyz', refreshToken: 'rt-abc', nested: { n: 1 } };
    const sealed = sealTenantSecretJson(TENANT_A, creds);
    expect(openTenantSecretJson(TENANT_A, sealed)).toEqual(creds);
  });

  test('two seals of the same plaintext differ (fresh nonce — no deterministic leak)', () => {
    withKey();
    const a = sealTenantSecret(TENANT_A, 'same');
    const b = sealTenantSecret(TENANT_A, 'same');
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });
});

describe('tenant-secret-box — cross-tenant refusal (the manifest verification target)', () => {
  test('a secret sealed for tenant A cannot be opened under tenant B', () => {
    withKey();
    const sealed = sealTenantSecret(TENANT_A, 'tenant-a-only');
    expect(() => openTenantSecret(TENANT_B, sealed)).toThrow(TenantSecretError);
  });

  test('rewriting the tenant tag to the attacker tenant still fails (crypto binds, not just the label)', () => {
    withKey();
    const sealed = sealTenantSecret(TENANT_A, 'tenant-a-only');
    // Forge the stored tenant label to tenant B and try to open as B: the
    // per-tenant DEK and AAD are both derived from B, so decryption fails.
    const forged = { ...sealed, t: TENANT_B };
    expect(() => openTenantSecret(TENANT_B, forged)).toThrow(TenantSecretError);
  });

  test('a tampered ciphertext is rejected (AEAD integrity)', () => {
    withKey();
    const sealed = sealTenantSecret(TENANT_A, 'tenant-a-only');
    const tampered = { ...sealed, ct: Buffer.from('deadbeef', 'utf8').toString('base64') };
    expect(() => openTenantSecret(TENANT_A, tampered)).toThrow(TenantSecretError);
  });
});

describe('tenant-secret-box — non-exportable / no plaintext leak', () => {
  test('the serialized sealed form contains no plaintext substring', () => {
    withKey();
    const secret = 'super-secret-refresh-token';
    const sealed = sealTenantSecret(TENANT_A, secret);
    expect(JSON.stringify(sealed)).not.toContain(secret);
  });

  test('isSealedSecret discriminates a sealed envelope from a legacy plaintext object', () => {
    withKey();
    const sealed = sealTenantSecret(TENANT_A, 's');
    expect(isSealedSecret(sealed)).toBe(true);
    expect(isSealedSecret({ sessionId: 'legacy-plaintext' })).toBe(false);
    expect(isSealedSecret(null)).toBe(false);
    expect(isSealedSecret('a-string')).toBe(false);
  });
});

describe('tenant-secret-box — fail-closed input validation', () => {
  test('seal refuses a non-UUID tenant', () => {
    withKey();
    expect(() => sealTenantSecret('not-a-uuid', 's')).toThrow(TenantSecretError);
  });

  test('open refuses a non-sealed value', () => {
    withKey();
    expect(() => openTenantSecret(TENANT_A, { sessionId: 'legacy' } as any)).toThrow(TenantSecretError);
  });

  test('open without a configured key throws Unconfigured', () => {
    withKey();
    const sealed = sealTenantSecret(TENANT_A, 's');
    setTenantSecretMasterKey(null);
    expect(() => openTenantSecret(TENANT_A, sealed)).toThrow(TenantSecretUnconfiguredError);
  });
});
