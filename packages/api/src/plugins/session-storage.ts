/**
 * Database-backed session storage implementation for ClaudeCodeAgentProvider.
 *
 * TENANT-BOUND SECRET SEALING (G5; ADR-0008; OWNERSHIP_MANIFEST
 * `filesystem_session_state`)
 * ----------------------------------------------------------------
 * `agent_sessions.provider_session_data` holds session-secret material (a
 * provider session id/token). ADR-0008 requires session secrets to be
 * "non-exportable by default and encrypted with tenant-bound context; plaintext
 * never appears in ... caches ...". When a caller supplies a tenant resolver AND
 * a master key is configured (`@omni/core` `setTenantSecretMasterKey`), this
 * store SEALS the blob with the resolved tenant's key before writing it and
 * OPENS it under that tenant on read — a session sealed for tenant A cannot be
 * decrypted under tenant B.
 *
 * TENANT-SCOPED DB ACCESS
 * -----------------------
 * The store is constructed inside the agent dispatcher and reached only from a
 * NATS consumer, so it has no request scope to inherit — that is why its
 * `agent_sessions` site was `pending-G5-conversion`. When a `resolveTenantId` is
 * supplied, every discrete DB block now runs inside its own short worker tenant
 * scope (`runTenantWorkDb`) and reads through `scopedHandle`, so RLS decides
 * visibility: a session key that exists under two tenants resolves to each
 * tenant's OWN row, and a write aimed at another tenant's instance is refused by
 * the `agent_sessions` WITH CHECK (its tenant derives from the required
 * `instances` parent).
 *
 * The DB scope is deliberately independent of the sealing key — see `scopeFor`.
 *
 * DUAL WORLD. Both behaviors are opt-in on the SAME switch, `resolveTenantId`.
 * With no resolver (the legacy shape) no scope opens, `scopedHandle` returns the
 * ambient pool, and the blob is stored and read as legacy plaintext
 * `{ sessionId }` — byte-identical to pre-G5. Sealing is gated once more, on a
 * configured master key. Reads are transitional: a legacy plaintext row and a
 * sealed row can coexist, and each is handled on its own shape.
 *
 * The production caller (`agent-dispatcher`) supplies the resolver from the
 * DISPATCH INSTANCE's persisted `tenantId` — the ownership root G2 defined,
 * loaded from the database, never a payload claim — which is null in the
 * flag-off world and therefore changes nothing there.
 */

import type { SessionStorage } from '@omni/core';
import { isSealedSecret, isTenantSecretSealingEnabled, openTenantSecretJson, sealTenantSecretJson } from '@omni/core';
import type { Database } from '@omni/db';
import { agentSessions } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';

function scopeSessionKey(providerId: string, sessionKey: string): string {
  return `provider:${providerId}:session:${sessionKey}`;
}

/** Default max session age: 4 hours. Sessions older than this are considered stale and cleared. */
const DEFAULT_MAX_SESSION_AGE_MS = 4 * 60 * 60 * 1000;

export interface SessionStorageOptions {
  /**
   * Optional tenant resolver. When present AND secret-sealing is enabled (a
   * master key is configured), the session blob is sealed with the resolved
   * tenant's key before it is written and opened under that tenant on read.
   * When absent — or when it returns null, or when no master key is configured —
   * the blob is stored/read as legacy plaintext, byte-identical to pre-G5.
   *
   * The tenant MUST be derived from the instance's persisted ownership (the same
   * trusted derivation G2 defined), never from a caller/payload claim.
   */
  resolveTenantId?: (instanceId: string) => string | null | Promise<string | null>;
}

/** The shape a legacy (unsealed) session blob has always had. */
interface LegacySessionData {
  readonly sessionId: string;
}

export function createSessionStorage(
  db: Database,
  providerId = 'default',
  maxSessionAgeMs = DEFAULT_MAX_SESSION_AGE_MS,
  options: SessionStorageOptions = {},
): SessionStorage {
  const { resolveTenantId } = options;

  /**
   * The tenant this store's DB work runs under (G5, ADR-0008) — the store is
   * constructed inside the agent dispatcher and reached only from a consumer, so
   * it has no request scope to inherit and must establish its own.
   *
   * Deliberately NOT gated on `isTenantSecretSealingEnabled()`: the DB boundary
   * and the secret-sealing boundary are independent decisions. A deployment that
   * has multitenancy but no session-secret master key still needs its
   * `agent_sessions` reads scoped; conflating the two would make the tenant
   * boundary depend on whether a key happens to be configured.
   *
   * Returns null when no resolver was supplied — the legacy shape, where no
   * scope opens and every query runs on the ambient pool byte-identically.
   */
  async function scopeFor(instanceId: string): Promise<string | null> {
    if (!resolveTenantId) return null;
    return (await resolveTenantId(instanceId)) ?? null;
  }

  /**
   * Resolve the tenant for `instanceId` only when SEALING could apply. Returns
   * null (→ legacy plaintext path) when there is no resolver or no key.
   */
  async function tenantFor(instanceId: string): Promise<string | null> {
    if (!resolveTenantId || !isTenantSecretSealingEnabled()) return null;
    return (await resolveTenantId(instanceId)) ?? null;
  }

  /**
   * Turn a stored blob (legacy plaintext OR a sealed envelope) into the session
   * id. A sealed blob requires the owning tenant; if it cannot be opened
   * (missing tenant, wrong tenant, or tampering) the session is treated as
   * absent — fail-closed, never a plaintext leak or a crash.
   */
  async function readSessionId(instanceId: string, blob: unknown): Promise<string | null> {
    if (isSealedSecret(blob)) {
      const tenantId = await tenantFor(instanceId);
      if (!tenantId) return null;
      try {
        return (openTenantSecretJson(tenantId, blob) as LegacySessionData).sessionId;
      } catch {
        return null;
      }
    }
    const legacy = blob as LegacySessionData | null;
    return legacy?.sessionId ?? null;
  }

  /** Build the blob to persist: sealed when a tenant is available, else legacy. */
  async function buildSessionData(instanceId: string, sessionId: string): Promise<Record<string, unknown>> {
    const tenantId = await tenantFor(instanceId);
    if (tenantId) {
      return { ...sealTenantSecretJson(tenantId, { sessionId } satisfies LegacySessionData) };
    }
    return { sessionId } satisfies LegacySessionData;
  }

  return {
    async getSession(instanceId: string, sessionKey: string) {
      const scopedSessionKey = scopeSessionKey(providerId, sessionKey);
      const scopeTenant = await scopeFor(instanceId);

      // ONE discrete DB block: the lookup plus the two staleness deletes it may
      // trigger are a single work item, and the transaction closes before the
      // (pure, non-DB) unsealing below.
      const session = await runTenantWorkDb(db, scopeTenant, async () => {
        const [row] = await scopedHandle(db)
          .select({
            providerSessionData: agentSessions.providerSessionData,
            lastUsedAt: agentSessions.lastUsedAt,
            expiresAt: agentSessions.expiresAt,
          })
          .from(agentSessions)
          .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)))
          .limit(1);

        if (!row) return null;

        const now = new Date();
        const hardExpired = !!row.expiresAt && row.expiresAt < now;
        // Sessions older than the threshold are likely zombie/stale. Resuming a
        // killed or terminal-owned session causes agents to stop mid-reply.
        const tooOld = !!row.lastUsedAt && now.getTime() - row.lastUsedAt.getTime() > maxSessionAgeMs;

        if (hardExpired || tooOld) {
          await scopedHandle(db)
            .delete(agentSessions)
            .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)));
          return null;
        }

        return row;
      });

      if (!session) return null;

      const sessionId = await readSessionId(instanceId, session.providerSessionData);
      if (!sessionId) return null;

      return {
        sessionId,
        lastUsedAt: session.lastUsedAt,
      };
    },

    async upsertSession(instanceId: string, sessionKey: string, sessionId: string, expiresAt: Date | null) {
      const scopedSessionKey = scopeSessionKey(providerId, sessionKey);
      const now = new Date();
      // Sealing is pure crypto — kept OUTSIDE the transaction so the worker scope
      // spans nothing but the write itself.
      const providerSessionData = await buildSessionData(instanceId, sessionId);
      const scopeTenant = await scopeFor(instanceId);

      await runTenantWorkDb(db, scopeTenant, () =>
        scopedHandle(db)
          .insert(agentSessions)
          .values({
            instanceId,
            sessionKey: scopedSessionKey,
            providerSessionData,
            lastUsedAt: now,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [agentSessions.instanceId, agentSessions.sessionKey],
            set: {
              providerSessionData,
              lastUsedAt: now,
              expiresAt,
              updatedAt: now,
            },
          }),
      );
    },

    async deleteSession(instanceId: string, sessionKey: string) {
      const scopedSessionKey = scopeSessionKey(providerId, sessionKey);
      const scopeTenant = await scopeFor(instanceId);
      await runTenantWorkDb(db, scopeTenant, () =>
        scopedHandle(db)
          .delete(agentSessions)
          .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey))),
      );
    },
  };
}
