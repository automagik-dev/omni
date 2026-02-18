/**
 * Database-backed session storage implementation for ClaudeCodeAgentProvider
 */

import type { SessionStorage } from '@omni/core';
import type { Database } from '@omni/db';
import { agentSessions } from '@omni/db';
import { and, eq } from 'drizzle-orm';

function scopeSessionKey(providerId: string, sessionKey: string): string {
  return `provider:${providerId}:session:${sessionKey}`;
}

export function createSessionStorage(db: Database, providerId = 'default'): SessionStorage {
  return {
    async getSession(instanceId: string, sessionKey: string) {
      const scopedSessionKey = scopeSessionKey(providerId, sessionKey);
      const [session] = await db
        .select({
          sessionId: agentSessions.providerSessionData,
          lastUsedAt: agentSessions.lastUsedAt,
          expiresAt: agentSessions.expiresAt,
        })
        .from(agentSessions)
        .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)))
        .limit(1);

      if (!session) return null;

      // Check if expired
      if (session.expiresAt && session.expiresAt < new Date()) {
        // Delete expired session
        await db
          .delete(agentSessions)
          .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, scopedSessionKey)));
        return null;
      }

      return {
        sessionId: (session.sessionId as { sessionId: string }).sessionId,
        lastUsedAt: session.lastUsedAt,
      };
    },

    async upsertSession(instanceId: string, sessionKey: string, sessionId: string, expiresAt: Date | null) {
      const scopedSessionKey = scopeSessionKey(providerId, sessionKey);
      const now = new Date();

      await db
        .insert(agentSessions)
        .values({
          instanceId,
          sessionKey: scopedSessionKey,
          providerSessionData: { sessionId },
          lastUsedAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [agentSessions.instanceId, agentSessions.sessionKey],
          set: {
            providerSessionData: { sessionId },
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
