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
 * DUAL WORLD. Sealing is entirely opt-in and gated twice: the caller passes no
 * `resolveTenantId` (the default), or no master key is configured. In either
 * case the blob is stored and read as legacy plaintext `{ sessionId }` —
 * byte-identical to pre-G5. Reads are transitional: a legacy plaintext row and a
 * sealed row can coexist, and each is handled on its own shape. The single
 * production caller (`agent-dispatcher`) passes no resolver today, so runtime
 * behavior is unchanged until the API layer wires a tenant resolver + key.
 */

import type { SessionStorage } from '@omni/core';
import { isSealedSecret, isTenantSecretSealingEnabled, openTenantSecretJson, sealTenantSecretJson } from '@omni/core';
import type { Database } from '@omni/db';
import { agentSessions } from '@omni/db';
import { and, eq } from 'drizzle-orm';

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
   * Resolve the tenant for `instanceId` only when sealing could apply. Returns
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
      const [session] = await db
        .select({
          providerSessionData: agentSessions.providerSessionData,
          lastUsedAt: agentSessions.lastUsedAt,
          expiresAt: agentSessions.expiresAt,
        })
        .from(agentSessions)
        .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)))
        .limit(1);

      if (!session) return null;

      const now = new Date();

      // Check hard expiry
      if (session.expiresAt && session.expiresAt < now) {
        await db
          .delete(agentSessions)
          .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)));
        return null;
      }

      // Check max age — sessions older than the threshold are likely zombie/stale.
      // Resuming a killed or terminal-owned session causes agents to stop mid-reply.
      if (session.lastUsedAt && now.getTime() - session.lastUsedAt.getTime() > maxSessionAgeMs) {
        await db
          .delete(agentSessions)
          .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)));
        return null;
      }

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
      const providerSessionData = await buildSessionData(instanceId, sessionId);

      await db
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
        });
    },

    async deleteSession(instanceId: string, sessionKey: string) {
      const scopedSessionKey = scopeSessionKey(providerId, sessionKey);
      await db
        .delete(agentSessions)
        .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)));
    },
  };
}
