/**
 * Tenant-bound secret sealing (wish: omni-full-multitenancy, Group G5;
 * ADR-0008; WISH "Async and storage enforcement";
 * OWNERSHIP_MANIFEST `filesystem_session_state`).
 *
 * WHAT THIS IS
 * ------------
 * Channel/provider/webhook credentials and session secrets are "tenant-owned
 * secret material" (OWNERSHIP_MANIFEST line 427). ADR-0008 and the WISH require
 * them to be "non-exportable by default and encrypted with tenant-bound context
 * (for example per-tenant DEKs or tenant ID as authenticated encryption
 * context); plaintext never appears in API responses, logs, caches, migration
 * receipts, or object metadata." This module is that primitive: it seals a
 * secret so it can ONLY be opened again inside the SAME tenant's context.
 *
 * HOW THE TENANT BINDING WORKS (two independent layers)
 * -----------------------------------------------------
 *   1. **Per-tenant DEK.** The data-encryption key is `HKDF-SHA256(masterKey,
 *      salt = tenantId, info = DEK_INFO)`. A different tenant derives a
 *      different key, so it cannot even produce the right keystream.
 *   2. **Tenant as AEAD associated data.** The tenant id is also the AES-256-GCM
 *      associated data. Even if two tenants somehow shared a key, GCM
 *      authentication fails when the AAD (tenant) does not match what was sealed.
 *
 * Opening ALWAYS derives the key and AAD from the CALLER-SUPPLIED tenant, never
 * from the label stored in the envelope — so an attacker who rewrites the stored
 * `t` label still cannot open a foreign secret (proved in the test). This is the
 * manifest's verification target: "session state cannot be decrypted/exported
 * under another tenant context."
 *
 * DUAL WORLD
 * ----------
 * Sealing is active ONLY when a master key is configured (`setTenantSecretMaster
 * Key`). A flag-off / legacy deployment configures no key, so
 * `isTenantSecretSealingEnabled()` is false and callers store plaintext exactly
 * as before — byte-identical. This module never silently degrades to plaintext:
 * `sealTenantSecret` THROWS when unconfigured, so a caller must make the
 * dual-world choice explicitly (check `isTenantSecretSealingEnabled()` first).
 *
 * KEY CUSTODY — NAMED DEFERRAL
 * ----------------------------
 * The master key is injected through a module seam (mirroring
 * `setEnvelopeTenantResolver`). Repo-local/synthetic key material only. Live
 * KMS/Vault grant custody, rotation, and per-tenant DEK escrow are OUT OF SCOPE
 * for G5 (deployment/G8A + G9 credential-custody scope) and are recorded as an
 * explicit deferral in the G5 handoff — never implemented against a live secret
 * store here.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** The sealed-envelope format version. Bump when the sealed shape changes. */
export const SECRET_BOX_VERSION = 1;

/** Node cipher id for AES-256-GCM. */
const CIPHER = 'aes-256-gcm';
/** GCM standard nonce length. */
const IV_BYTES = 12;
/** Derived data-encryption-key length (AES-256). */
const DEK_BYTES = 32;
/** HKDF context string — domain-separates this DEK from any other use of the key. */
const DEK_INFO = 'omni-tenant-secret-box:v1:dek';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A sealed secret. Every field is ciphertext or public metadata — there is no
 * plaintext here, so it is safe to persist in a JSON column, log, or receipt.
 *
 *   * `t`   — the tenant this was sealed for. A convenience label and an early
 *             fail-closed check; NOT the source of truth for decryption (the
 *             caller-supplied tenant is).
 *   * `iv`  — base64 GCM nonce.
 *   * `ct`  — base64 ciphertext.
 *   * `tag` — base64 GCM authentication tag.
 */
export interface SealedSecret {
  readonly v: number;
  readonly alg: 'A256GCM';
  readonly kdf: 'HKDF-SHA256';
  readonly t: string;
  readonly iv: string;
  readonly ct: string;
  readonly tag: string;
}

/** A tenant-binding / integrity / validation failure. Fail-closed by default. */
export class TenantSecretError extends Error {
  readonly code = 'tenant_secret_denied';
  constructor(reason: string) {
    super(`tenant-secret-box: ${reason}`);
    this.name = 'TenantSecretError';
  }
}

/** Raised when sealing/opening is attempted with no master key configured. */
export class TenantSecretUnconfiguredError extends Error {
  readonly code = 'tenant_secret_unconfigured';
  constructor() {
    super('tenant-secret-box: no master key configured (sealing disabled)');
    this.name = 'TenantSecretUnconfiguredError';
  }
}

/**
 * The injected master key. `null` means sealing is disabled (dual-world
 * flag-off). Mirrors `setEnvelopeTenantResolver`: the API layer wires a
 * repo-local/synthetic key when multitenancy secret-sealing is enabled; a
 * flag-off deployment wires nothing.
 */
let masterKey: Buffer | null = null;

/**
 * Configure (or clear) the master key. Pass a >= 32-byte key. Passing `null`
 * disables sealing (flag-off / test teardown).
 *
 * @throws TenantSecretError if the key is shorter than 32 bytes — a short key
 *   would silently weaken every derived DEK.
 */
export function setTenantSecretMasterKey(key: Buffer | Uint8Array | null): void {
  if (key === null) {
    masterKey = null;
    return;
  }
  if (key.length < DEK_BYTES) {
    throw new TenantSecretError(`master key must be at least ${DEK_BYTES} bytes`);
  }
  masterKey = Buffer.from(key);
}

/** Whether a master key is configured (i.e. sealing is active). */
export function isTenantSecretSealingEnabled(): boolean {
  return masterKey !== null;
}

function requireKey(): Buffer {
  if (masterKey === null) throw new TenantSecretUnconfiguredError();
  return masterKey;
}

function requireTenant(tenantId: string): void {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
    throw new TenantSecretError(`refusing a non-UUID tenant (${String(tenantId)})`);
  }
}

/** Per-tenant DEK: HKDF-SHA256(masterKey, salt = tenantId, info = DEK_INFO). */
function deriveDek(key: Buffer, tenantId: string): Buffer {
  const derived = hkdfSync('sha256', key, Buffer.from(tenantId, 'utf8'), Buffer.from(DEK_INFO, 'utf8'), DEK_BYTES);
  return Buffer.from(derived);
}

/**
 * Seal a plaintext secret for exactly one tenant.
 *
 * @throws TenantSecretUnconfiguredError when no master key is configured — the
 *   caller must decide the dual-world path (check `isTenantSecretSealingEnabled`).
 * @throws TenantSecretError when `tenantId` is not a well-formed UUID.
 */
export function sealTenantSecret(tenantId: string, plaintext: string): SealedSecret {
  const key = requireKey();
  requireTenant(tenantId);
  const dek = deriveDek(key, tenantId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, dek, iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: SECRET_BOX_VERSION,
    alg: 'A256GCM',
    kdf: 'HKDF-SHA256',
    t: tenantId,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Open a sealed secret under a tenant context. The key AND the AAD are derived
 * from the CALLER-supplied `tenantId`, so a foreign tenant cannot open it.
 *
 * @throws TenantSecretUnconfiguredError when no master key is configured.
 * @throws TenantSecretError when the value is not a sealed envelope, the stored
 *   tenant label mismatches, or AEAD authentication fails (wrong tenant,
 *   tampering, or an unknown format version).
 */
export function openTenantSecret(tenantId: string, sealed: SealedSecret): string {
  const key = requireKey();
  requireTenant(tenantId);
  if (!isSealedSecret(sealed)) {
    throw new TenantSecretError('value is not a sealed secret');
  }
  if (sealed.v !== SECRET_BOX_VERSION) {
    throw new TenantSecretError(`unknown sealed-secret version (${String(sealed.v)})`);
  }
  // Cheap early fail-closed layer: the stored label must match the opening
  // tenant. The crypto below is the real guarantee, but this gives a clear error
  // and refuses even before touching the key.
  if (sealed.t !== tenantId) {
    throw new TenantSecretError('tenant mismatch');
  }
  const dek = deriveDek(key, tenantId);
  try {
    const decipher = createDecipheriv(CIPHER, dek, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from(tenantId, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    // GCM authentication failure — wrong tenant, tampered ciphertext/tag, or a
    // corrupt envelope. Never surface the underlying crypto error verbatim.
    throw new TenantSecretError('authentication failed (wrong tenant or tampered secret)');
  }
}

/** Seal a JSON-serializable credential blob (e.g. a session/creds object). */
export function sealTenantSecretJson(tenantId: string, value: unknown): SealedSecret {
  return sealTenantSecret(tenantId, JSON.stringify(value));
}

/** Open a sealed JSON credential blob back to its value. */
export function openTenantSecretJson(tenantId: string, sealed: SealedSecret): unknown {
  return JSON.parse(openTenantSecret(tenantId, sealed));
}

/** Structural guard: is `value` a sealed envelope (vs a legacy plaintext blob)? */
export function isSealedSecret(value: unknown): value is SealedSecret {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.v === 'number' &&
    s.alg === 'A256GCM' &&
    s.kdf === 'HKDF-SHA256' &&
    typeof s.t === 'string' &&
    typeof s.iv === 'string' &&
    typeof s.ct === 'string' &&
    typeof s.tag === 'string'
  );
}
