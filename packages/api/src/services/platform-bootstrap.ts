/**
 * Platform credential bootstrap (issue #980; split from #908 acceptance
 * criterion 1: "a fresh supported deployment can bootstrap one platform
 * operator without direct SQL").
 *
 * The ONLY production code path that mints a PLATFORM-class credential. It is
 * a server-side operator action (`scripts/bootstrap-platform-credential.ts`),
 * never an HTTP surface: it must be runnable before any API credential exists,
 * and no HTTP route may ever mint platform authority (mirrors the CLI's
 * god-key refusal under enforcement).
 *
 * Contract:
 *   - Idempotent. A re-run with the same subject + key name CONVERGES: it
 *     validates the existing principal / `platform_api_keys` / `auth_credentials`
 *     triple against every invariant `AuthBootstrapService.resolvePlatformContext`
 *     checks and reports `converged` without touching anything.
 *   - Explicit rotation only. `rotate: true` replaces the credential material
 *     for the SAME principal + key row; nothing rotates implicitly.
 *   - Fail-closed on drift. A mismatched or tampered triple is reported as
 *     `blocked` with redacted reasons — never silently repaired, rebound to a
 *     different principal, or un-revoked.
 *   - Secret-once. The plaintext is returned separately from the report and is
 *     never logged or embedded in the report; only the display prefix is.
 *   - Never touches legacy `api_keys`. Legacy god-key handling is a REPORT-ONLY
 *     concern of the operator entrypoint (G6 classifier); nothing here converts
 *     or revokes a legacy key.
 *
 * Verification is in-process: after any write (and on convergence) the
 * credential is resolved through the real `AuthBootstrapService` lookup, so a
 * bootstrap only reports success when the exact production auth path accepts
 * the credential. No running API is required.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type AuthCredential,
  type PlatformApiKey,
  type Principal,
  authCredentials,
  platformApiKeys,
  principals,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { generateSecret, hashSecret, secretPrefix } from '../tenancy/hash';
import { AuthBootstrapService } from './auth-bootstrap';

const log = createLogger('platform-bootstrap');

// ============================================================================
// Options (Zod-validated boundary — the script passes raw CLI input through)
// ============================================================================

export const PlatformBootstrapOptionsSchema = z.object({
  /** Stable principal subject (unique). E.g. `platform-operator`. */
  subject: z.string().min(1).max(255),
  /** Unique `platform_api_keys.name` for this credential. */
  keyName: z.string().min(1).max(255),
  /** Display name applied when the principal is created. */
  displayName: z.string().min(1).max(255).optional(),
  /** Principal type when created. Operator bootstrap defaults to `service`. */
  principalType: z.enum(['human', 'service']).default('service'),
  /**
   * Platform scopes carried by the credential. `platform:*` covers every
   * current platform control-plane route without granting the data-plane `*`.
   */
  scopes: z.array(z.string().min(1)).nonempty().default(['platform:*']),
  /** Replace the credential material for the same principal + key row. */
  rotate: z.boolean().default(false),
  /** Optional `platform_api_keys.description`. */
  description: z.string().max(2000).optional(),
});

export type PlatformBootstrapOptions = z.input<typeof PlatformBootstrapOptionsSchema>;
type ResolvedOptions = z.output<typeof PlatformBootstrapOptionsSchema>;

// ============================================================================
// Report — NEVER carries secret material (the entrypoint redaction-scans it)
// ============================================================================

export type PlatformBootstrapStatus = 'created' | 'converged' | 'rotated' | 'blocked';

export interface PlatformBootstrapReport {
  status: PlatformBootstrapStatus;
  /** Redacted, human-readable reasons. Populated only when `blocked`. */
  reasons: string[];
  principal: { id: string; subject: string; type: string; status: string; created: boolean } | null;
  platformApiKey: { id: string; name: string; keyPrefix: string; scopes: string[]; status: string } | null;
  credentialId: string | null;
  /** In-process resolution through the real AuthBootstrapService lookup. */
  verification: { attempted: boolean; ok: boolean; credentialClass?: string; failureReason?: string };
}

export interface PlatformBootstrapResult {
  report: PlatformBootstrapReport;
  /**
   * Plaintext credential — present ONLY for `created` / `rotated`. The caller
   * prints it exactly once and must never log or persist it.
   */
  secret: string | null;
}

/** Internal: aborts the transaction so a blocked run writes NOTHING. */
class BootstrapBlocked extends Error {
  constructor(readonly reasons: string[]) {
    super(`platform bootstrap blocked: ${reasons.join('; ')}`);
    this.name = 'BootstrapBlocked';
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface WriteOutcome {
  status: 'created' | 'converged' | 'rotated';
  principal: Principal;
  principalCreated: boolean;
  key: PlatformApiKey;
  credentialId: string;
  /** Only for created/rotated. */
  secret: string | null;
  /** Hash to verify with when no plaintext exists (converged). */
  keyHash: string;
}

// ============================================================================
// Drift checks — every invariant resolvePlatformContext enforces, plus intent
// ============================================================================

function sameScopeSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** Redacted drift reasons between the key row, the credential row, and intent. */
function credentialDriftReasons(
  key: PlatformApiKey,
  credential: AuthCredential | undefined,
  options: ResolvedOptions,
): string[] {
  const reasons: string[] = [];
  if (!sameScopeSet(key.scopes, options.scopes)) {
    reasons.push('platform_api_keys.scopes differ from the requested scopes');
  }
  if (!credential) {
    reasons.push('no auth_credentials row is bound to this platform key');
    return reasons;
  }
  if (credential.credentialClass !== 'platform') reasons.push('auth_credentials row is not platform-class');
  if (credential.keyHash !== key.keyHash) {
    reasons.push('auth_credentials.key_hash does not match platform_api_keys.key_hash');
  }
  if (credential.keyPrefix !== key.keyPrefix) {
    reasons.push('auth_credentials.key_prefix does not match platform_api_keys.key_prefix');
  }
  if (credential.principalId !== key.principalId) {
    reasons.push('auth_credentials.principal_id does not match platform_api_keys.principal_id');
  }
  if (!sameScopeSet(credential.scopes, key.scopes)) {
    reasons.push('auth_credentials.scopes do not match platform_api_keys.scopes');
  }
  if (credential.tenantId || credential.membershipId || credential.tenantKeyLineageId || credential.actorRole) {
    reasons.push('auth_credentials row carries tenant-class bindings');
  }
  if (credential.status !== 'active' || credential.revokedAt) {
    reasons.push('auth_credentials row is not active');
  }
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
    reasons.push('auth_credentials row is expired');
  }
  return reasons;
}

// ============================================================================
// Service
// ============================================================================

export class PlatformBootstrapService {
  constructor(private db: Database) {}

  /**
   * Create, validate, or rotate the platform operator credential. See the
   * module contract above. All writes happen in ONE transaction; a blocked
   * outcome rolls back everything (including a just-created principal).
   */
  async bootstrap(rawOptions: PlatformBootstrapOptions): Promise<PlatformBootstrapResult> {
    const options = PlatformBootstrapOptionsSchema.parse(rawOptions);

    let outcome: WriteOutcome;
    try {
      outcome = await this.db.transaction(async (tx) => this.converge(tx, options));
    } catch (error) {
      if (error instanceof BootstrapBlocked) {
        return {
          report: {
            status: 'blocked',
            reasons: error.reasons,
            principal: null,
            platformApiKey: null,
            credentialId: null,
            verification: { attempted: false, ok: false },
          },
          secret: null,
        };
      }
      throw error;
    }

    const verification = await this.verify(outcome);
    log.info('platform bootstrap finished', {
      status: outcome.status,
      subject: options.subject,
      keyName: options.keyName,
      verified: verification.ok,
    });

    return {
      report: {
        status: outcome.status,
        reasons: [],
        principal: {
          id: outcome.principal.id,
          subject: outcome.principal.subject,
          type: outcome.principal.type,
          status: outcome.principal.status,
          created: outcome.principalCreated,
        },
        platformApiKey: {
          id: outcome.key.id,
          name: outcome.key.name,
          keyPrefix: outcome.key.keyPrefix,
          scopes: [...outcome.key.scopes],
          status: outcome.key.status,
        },
        credentialId: outcome.credentialId,
        verification,
      },
      secret: outcome.secret,
    };
  }

  /** Resolve the credential through the REAL auth path (in-process). */
  private async verify(outcome: WriteOutcome): Promise<PlatformBootstrapReport['verification']> {
    const bootstrap = new AuthBootstrapService(this.db);
    const requestId = `platform-bootstrap-${crypto.randomUUID()}`;
    const result = outcome.secret
      ? await bootstrap.lookupBySecret(outcome.secret, requestId)
      : await bootstrap.lookupBySecretHash(outcome.keyHash, requestId);
    if (!result.ok) return { attempted: true, ok: false, failureReason: result.reason };
    if (result.context.credentialClass !== 'platform') {
      return { attempted: true, ok: false, failureReason: 'resolved_non_platform_class' };
    }
    return { attempted: true, ok: true, credentialClass: result.context.credentialClass };
  }

  private async converge(tx: Tx, options: ResolvedOptions): Promise<WriteOutcome> {
    const { principal, created: principalCreated } = await this.ensurePrincipal(tx, options);

    const [existingKey] = await tx
      .select()
      .from(platformApiKeys)
      .where(eq(platformApiKeys.name, options.keyName))
      .limit(1)
      .for('update');

    if (!existingKey) {
      const fresh = await this.createCredential(tx, principal, options);
      return { ...fresh, principal, principalCreated, status: 'created' };
    }

    // Fail-closed identity checks — never rebind, never resurrect.
    if (existingKey.principalId !== principal.id) {
      throw new BootstrapBlocked([
        `platform key name '${options.keyName}' is already bound to a different principal — choose a different --key-name; bootstrap never rebinds credentials`,
      ]);
    }
    if (existingKey.status !== 'active' || existingKey.revokedAt) {
      throw new BootstrapBlocked([
        `platform key '${options.keyName}' is revoked — revocation is permanent; issue a new key under a new name`,
      ]);
    }
    const [credential] = await tx
      .select()
      .from(authCredentials)
      .where(eq(authCredentials.platformApiKeyId, existingKey.id))
      .limit(1);

    // Explicit rotation is the sanctioned recovery path: it replaces the
    // material (and resets expiry) for the same principal + key row.
    if (options.rotate) {
      const rotated = await this.rotateCredential(tx, existingKey, credential, principal, options);
      return { ...rotated, principal, principalCreated, status: 'rotated' };
    }

    if (existingKey.expiresAt && existingKey.expiresAt.getTime() <= Date.now()) {
      throw new BootstrapBlocked([`platform key '${options.keyName}' is expired — rotate it explicitly with --rotate`]);
    }

    const drift = credentialDriftReasons(existingKey, credential, options);
    if (drift.length > 0 || !credential) {
      throw new BootstrapBlocked([
        ...drift,
        'existing credential state does not converge — re-run with --rotate to replace the credential material',
      ]);
    }

    return {
      status: 'converged',
      principal,
      principalCreated,
      key: existingKey,
      credentialId: credential.id,
      secret: null,
      keyHash: existingKey.keyHash,
    };
  }

  private async ensurePrincipal(tx: Tx, options: ResolvedOptions): Promise<{ principal: Principal; created: boolean }> {
    const [existing] = await tx
      .select()
      .from(principals)
      .where(eq(principals.subject, options.subject))
      .limit(1)
      .for('update');
    if (existing) {
      if (existing.status !== 'active') {
        throw new BootstrapBlocked([
          `principal '${options.subject}' exists but is disabled — re-enabling is a deliberate operator action, not a bootstrap side effect`,
        ]);
      }
      return { principal: existing, created: false };
    }
    const [inserted] = await tx
      .insert(principals)
      .values({
        type: options.principalType,
        subject: options.subject,
        displayName: options.displayName ?? options.subject,
        status: 'active',
      })
      .returning();
    if (!inserted) throw new Error('failed to create platform principal');
    return { principal: inserted, created: true };
  }

  private async createCredential(
    tx: Tx,
    principal: Principal,
    options: ResolvedOptions,
  ): Promise<Pick<WriteOutcome, 'key' | 'credentialId' | 'secret' | 'keyHash'>> {
    const secret = generateSecret();
    const keyHash = await hashSecret(secret);
    const keyPrefix = secretPrefix(secret);

    const [key] = await tx
      .insert(platformApiKeys)
      .values({
        name: options.keyName,
        description: options.description ?? null,
        keyPrefix,
        keyHash,
        scopes: options.scopes,
        status: 'active',
        principalId: principal.id,
      })
      .returning();
    if (!key) throw new Error('failed to create platform_api_keys row');

    const [credential] = await tx
      .insert(authCredentials)
      .values({
        credentialClass: 'platform',
        keyHash,
        keyPrefix,
        tenantId: null,
        principalId: principal.id,
        membershipId: null,
        actorRole: null,
        scopes: options.scopes,
        status: 'active',
        tenantKeyLineageId: null,
        platformApiKeyId: key.id,
      })
      .returning();
    if (!credential) throw new Error('failed to create platform auth_credentials row');

    return { key, credentialId: credential.id, secret, keyHash };
  }

  private async rotateCredential(
    tx: Tx,
    existingKey: PlatformApiKey,
    credential: AuthCredential | undefined,
    principal: Principal,
    options: ResolvedOptions,
  ): Promise<Pick<WriteOutcome, 'key' | 'credentialId' | 'secret' | 'keyHash'>> {
    const secret = generateSecret();
    const keyHash = await hashSecret(secret);
    const keyPrefix = secretPrefix(secret);
    const now = new Date();

    const [key] = await tx
      .update(platformApiKeys)
      .set({ keyHash, keyPrefix, scopes: options.scopes, expiresAt: null, updatedAt: now })
      .where(eq(platformApiKeys.id, existingKey.id))
      .returning();
    if (!key) throw new Error('failed to rotate platform_api_keys row');

    if (credential) {
      const [updated] = await tx
        .update(authCredentials)
        .set({
          keyHash,
          keyPrefix,
          scopes: options.scopes,
          status: 'active',
          expiresAt: null,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(authCredentials.id, credential.id))
        .returning();
      if (!updated) throw new Error('failed to rotate platform auth_credentials row');
      return { key, credentialId: updated.id, secret, keyHash };
    }

    // Recovery: the index row was lost/never written — recreate it bound to the
    // same key + principal, with the freshly rotated material.
    const [inserted] = await tx
      .insert(authCredentials)
      .values({
        credentialClass: 'platform',
        keyHash,
        keyPrefix,
        tenantId: null,
        principalId: principal.id,
        membershipId: null,
        actorRole: null,
        scopes: options.scopes,
        status: 'active',
        tenantKeyLineageId: null,
        platformApiKeyId: key.id,
      })
      .returning();
    if (!inserted) throw new Error('failed to recreate platform auth_credentials row');
    return { key, credentialId: inserted.id, secret, keyHash };
  }
}
