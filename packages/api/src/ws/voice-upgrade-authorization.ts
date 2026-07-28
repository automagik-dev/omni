/**
 * Voice WebSocket upgrade authorization — G5 deliverable (e)
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0003;
 * WISH "Streaming and long-lived state").
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * The voice stream upgrade lives in `Bun.serve`'s raw `fetch`, BEFORE Hono — so
 * it never passes through the tenancy middleware G1–G4 installed on the HTTP
 * edge. Its pre-G5 authorization was, in full:
 *
 *     globalChannelRegistry.getAll().find(p => isVoiceCapable(p) && p.voiceSession(id))
 *
 * "does ANY loaded plugin, for ANY tenant's instance, hold a session with this
 * id?" That is a resource-UUID-only check: naming a session IS permission to
 * join its audio. This module replaces it with a tenant-authorized decision.
 *
 * THE DERIVATION CHAIN (all trusted, none caller-supplied)
 * -------------------------------------------------------
 *   credential  → tenant       — from the authenticated `api_key` via the auth
 *                                plane, the same index the HTTP edge uses. The
 *                                URL has no tenant parameter, and
 *                                `parseVoiceStreamParams` cannot produce one.
 *   sessionId   → instanceId   — from the plugin's live `VoiceSession`, which
 *                                carries the instance it was opened for.
 *   instanceId  → tenantId     — from `instances`, THE ownership root (G0/G2),
 *                                read INSIDE the credential tenant's scope so
 *                                RLS itself decides visibility. A foreign
 *                                instance simply does not resolve.
 *
 * The two tenants are then compared by {@link authorizeStreamSubscription}, the
 * same decision table every other long-lived surface uses.
 *
 * FAIL-CLOSED
 * -----------
 * Every unresolvable step refuses. A credential lookup or ownership read that
 * THROWS also refuses: an auth plane or a database we cannot consult is not
 * evidence of permission. This is the opposite of the pre-G5 handler, which
 * swallowed a lookup failure and continued.
 *
 * DUAL WORLD
 * ----------
 * Flag-off, this performs the pre-G5 decision EXACTLY — session exists or not —
 * with no credential-tenant resolution, no ownership read, and no tenant on the
 * resulting connection. The new lookups bind only to the multitenancy world.
 *
 * KNOWN LEGACY-WORLD GAP (not changed here, reported in the G5 handoff): the
 * pre-G5 handler calls `ApiKeyService.validate` and inspects only THROWN errors,
 * while an invalid key resolves to `null` — so flag-off, an unrecognised key is
 * admitted. Fixing that alters default legacy runtime behaviour, which G5 is not
 * authorized to do; flag-on, `resolveCredentialTenant` returning null refuses,
 * so the multitenancy world is closed.
 */

import { isMultitenancyEnabled } from '../tenancy/feature-flag';
import { authorizeStreamSubscription } from '../tenancy/tenant-stream-subscriptions';

/** The trusted tenancy of an authenticated voice credential. */
export interface VoiceCredentialTenant {
  tenantId: string;
  /** The tenant revocation epoch the credential was validated against. */
  revocationEpoch: number;
}

export interface VoiceUpgradeDeps {
  /**
   * Resolve the api key to its tenant via the auth plane. Returns null when the
   * key is unknown, revoked, expired, or platform-class (a platform credential
   * has no tenant of its own to bind a stream to).
   */
  resolveCredentialTenant: (apiKey: string) => Promise<VoiceCredentialTenant | null>;
  /** The instance a live voice session was opened for, or null if unknown. */
  resolveSessionInstanceId: (sessionId: string) => string | null;
  /**
   * The instance's PERSISTED owner, read inside `tenantId`'s scope so RLS
   * decides visibility. Returns null when the instance is not visible/owned.
   */
  resolveInstanceTenantId: (instanceId: string, tenantId: string) => Promise<string | null>;
}

export type VoiceUpgradeRefusal =
  | 'unauthenticated'
  | 'session_not_found'
  | 'cross_tenant_resource'
  | 'unowned_resource'
  | 'tenant_context_required'
  | 'malformed_tenant';

export type VoiceUpgradeDecision =
  | { ok: true; tenantId: string | null; revocationEpoch: number }
  | { ok: false; reason: VoiceUpgradeRefusal };

export async function authorizeVoiceUpgrade(
  request: { apiKey: string; sessionId: string },
  deps: VoiceUpgradeDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoiceUpgradeDecision> {
  // Flag-off: the pre-G5 decision, unchanged — the session must exist, and the
  // connection carries no tenant. No tenancy lookup is performed at all.
  if (!isMultitenancyEnabled(env)) {
    return deps.resolveSessionInstanceId(request.sessionId) === null
      ? { ok: false, reason: 'session_not_found' }
      : { ok: true, tenantId: null, revocationEpoch: 0 };
  }

  let credential: VoiceCredentialTenant | null;
  try {
    credential = await deps.resolveCredentialTenant(request.apiKey);
  } catch {
    // An auth plane we cannot consult is not evidence of authority.
    return { ok: false, reason: 'unauthenticated' };
  }
  if (!credential) return { ok: false, reason: 'unauthenticated' };

  const instanceId = deps.resolveSessionInstanceId(request.sessionId);
  if (instanceId === null) return { ok: false, reason: 'session_not_found' };

  let resourceTenantId: string | null;
  try {
    resourceTenantId = await deps.resolveInstanceTenantId(instanceId, credential.tenantId);
  } catch {
    // An ownership read that failed (RLS denial included) resolves to "not
    // owned", never to "owned".
    resourceTenantId = null;
  }

  const decision = authorizeStreamSubscription({
    authenticatedTenantId: credential.tenantId,
    resourceTenantId,
  });
  if (!decision.ok) return { ok: false, reason: decision.reason };

  return { ok: true, tenantId: credential.tenantId, revocationEpoch: credential.revocationEpoch };
}
