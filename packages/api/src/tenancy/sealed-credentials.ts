/**
 * Tenant-bound sealing for credential COLUMNS (wish: omni-full-multitenancy,
 * Group G5, deliverable (g); ADR-0008; WISH "Async and storage enforcement").
 *
 * WHY THIS EXISTS ALONGSIDE `tenant-secret-box`
 * ---------------------------------------------
 * `@omni/core`'s `tenant-secret-box` is the primitive: AES-256-GCM under a
 * per-tenant HKDF DEK with the tenant id as AEAD associated data, so a secret
 * sealed for tenant A cannot be opened under tenant B even by someone who
 * rewrites the stored tenant label. `session-storage.ts` uses it directly
 * because `agent_sessions.provider_session_data` is a JSONB column that can hold
 * the envelope OBJECT.
 *
 * The remaining credential surfaces cannot: they store their secret in a `text`
 * column — `instances.discord_bot_token` and its seven siblings,
 * `agent_providers.api_key`, `plugin_storage.value`, `global_settings.value`.
 * They need the envelope flattened to a string, and they need a read that still
 * accepts the LEGACY PLAINTEXT already sitting in those columns, because there
 * is no backfill in G5 (object/credential migration is a named separate pass).
 * This module is that codec, and it is the only place the two shapes meet.
 *
 * THE DUAL-WORLD CONTRACT, BY CONSTRUCTION
 * ----------------------------------------
 * `sealCredentialField` is the IDENTITY function whenever there is no tenant or
 * no master key. Not "a plaintext branch that happens to match" — the same
 * string object flows through, so a flag-off deployment writes the exact bytes
 * it wrote before G5 and no caller can observe that this module was consulted.
 * Sealing therefore binds to exactly one situation: a tenant-context write in a
 * deployment that has explicitly configured a master key
 * (`setTenantSecretMasterKey`, wired only from repo-local/synthetic material —
 * live KMS/Vault custody is a named G5 deferral). With no key configured the
 * whole deliverable is INERT.
 *
 * FAIL-CLOSED, AND WHY IT IS NULL RATHER THAN A THROW
 * ---------------------------------------------------
 * Opening a sealed field under the wrong tenant, with no tenant, or with the key
 * withdrawn returns `null` — the same posture `session-storage.ts` takes. The
 * alternative that must NEVER happen is returning the envelope string itself: a
 * caller would hand that to Discord/Slack/Twilio as a bot token, leaking
 * ciphertext into third-party logs and producing an authentication failure whose
 * cause is invisible. `null` means "this credential is not available to you",
 * which every one of these call sites already models (the columns are nullable).
 * A throw was rejected because these reads sit on hot paths (`getById` on every
 * message) where one unopenable row must not take down an unrelated request.
 *
 * NOTE ON THE DETECTION PREFIX
 * ----------------------------
 * `JSON.stringify` of a `SealedSecret` always begins `{"v":` because the
 * literal's key order is fixed in `tenant-secret-box.ts`. The prefix check is a
 * cheap pre-filter so a hot read path does not JSON-parse every plaintext token;
 * the authority is still `isSealedSecret`, and a plaintext value that happens to
 * start with the prefix but is not a sealed envelope is passed through
 * unchanged.
 */

import {
  type SealedSecret,
  isSealedSecret,
  isTenantSecretSealingEnabled,
  openTenantSecret,
  sealTenantSecret,
} from '@omni/core';

/** Cheap pre-filter — see the module header. */
const SEALED_PREFIX = '{"v":';

/**
 * Is `value` a sealed credential-field string (as opposed to legacy plaintext)?
 *
 * Never throws: malformed JSON that merely starts with the prefix is "not
 * sealed", which routes it to the transitional plaintext path.
 */
export function isSealedCredentialField(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(SEALED_PREFIX)) return false;
  try {
    return isSealedSecret(JSON.parse(value));
  } catch {
    return false;
  }
}

/**
 * Seal `plaintext` for `tenantId`, or return it UNCHANGED.
 *
 * Unchanged when: no tenant (legacy/worker/control-plane write), no master key
 * (the deliverable is inert), or the value is null/undefined/empty (nothing to
 * protect, and every caller treats empty as absent).
 *
 * Overloads keep the caller's nullability: a service spreading a partial update
 * must be able to write `{ ...data, discordBotToken: sealCredentialField(t,
 * data.discordBotToken) }` without widening the column's type.
 */
export function sealCredentialField(tenantId: string | null | undefined, plaintext: string): string;
export function sealCredentialField(
  tenantId: string | null | undefined,
  plaintext: string | null | undefined,
): string | null | undefined;
export function sealCredentialField(
  tenantId: string | null | undefined,
  plaintext: string | null | undefined,
): string | null | undefined {
  if (plaintext == null || plaintext === '') return plaintext;
  if (!tenantId || !isTenantSecretSealingEnabled()) return plaintext;
  return JSON.stringify(sealTenantSecret(tenantId, plaintext));
}

/**
 * Would `sealCredentialField` actually reshape a value for `tenantId`?
 *
 * The codec is deliberately branch-free at its call sites, so a caller normally
 * never needs this. The exception is a caller that must SPEND SOMETHING (an
 * extra query) to learn the tenant a write may seal under: asking first keeps
 * the inert world byte-identical down to the statements issued, instead of
 * paying for a lookup whose answer the identity function would discard.
 */
export function credentialSealingEngages(tenantId: string | null | undefined): boolean {
  return !!tenantId && isTenantSecretSealingEnabled();
}

/**
 * Open a stored credential field under `tenantId`.
 *
 *   * legacy plaintext (including null/undefined/empty) → returned UNCHANGED,
 *     which is what makes the rollout incremental: sealed and unsealed rows
 *     coexist and each is handled on its own shape;
 *   * sealed + right tenant + key → the plaintext secret;
 *   * sealed + wrong/absent tenant, no key, or tampering → `null`, fail-closed.
 */
export function openCredentialField(
  tenantId: string | null | undefined,
  stored: string | null | undefined,
): string | null | undefined {
  if (stored == null || stored === '') return stored;
  if (!isSealedCredentialField(stored)) return stored;
  if (!tenantId || !isTenantSecretSealingEnabled()) return null;
  try {
    return openTenantSecret(tenantId, JSON.parse(stored) as SealedSecret);
  } catch {
    return null;
  }
}
