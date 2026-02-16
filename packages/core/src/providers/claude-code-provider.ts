/**
 * ClaudeCodeAgentProvider — IAgentProvider wrapper for the Claude Code SDK
 *
 * Wraps ClaudeCodeClient for use in the agent dispatcher.
 * Unlike Agno, Claude Code IS the agent — there's no agent discovery.
 */

import type { Database } from '@omni/db';
import { agentSessions } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { createLogger } from '../logger';
import type { ClaudeCodeClient, ClaudeCodeConfig } from './claude-code-client';
import { createClaudeCodeClient } from './claude-code-client';
import type { AgentTrigger, AgentTriggerResult, IAgentProvider, ProviderRequest } from './types';

const log = createLogger('provider:claude-code');

export interface ClaudeCodeProviderOptions {
  /** Timeout in ms (default: 120000 — Claude Code agents can run longer than simple LLMs) */
  timeoutMs?: number;
  /** Split response on double newlines (default: true) */
  enableAutoSplit?: boolean;
  /** Prefix sender name to messages (default: true) */
  prefixSenderName?: boolean;
  /** Session TTL in ms (default: 3600000 = 1 hour) - sessions older than this are discarded */
  sessionTtlMs?: number;
}

export class ClaudeCodeAgentProvider implements IAgentProvider {
  readonly schema = 'claude-code' as const;
  readonly mode = 'round-trip' as const;
  private client: ClaudeCodeClient;
  private db: Database;

  /** Session TTL in milliseconds (default: Infinity = never expire) - sessions older than this are discarded */
  private readonly sessionTtlMs: number;

  constructor(
    readonly id: string,
    readonly name: string,
    config: ClaudeCodeConfig,
    db: Database,
    private options: ClaudeCodeProviderOptions = {},
  ) {
    this.client = createClaudeCodeClient(config);
    this.db = db;
    // Default: no TTL (sessions never expire unless explicitly configured)
    this.sessionTtlMs = this.options.sessionTtlMs ?? Number.POSITIVE_INFINITY;
  }

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Provider orchestration requires multiple content type checks
  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const startTime = Date.now();

    let message = '';
    if (context.content.text) {
      message = context.content.text;
    } else if (context.content.emoji) {
      message = `[Reaction: ${context.content.emoji} on message ${context.content.referencedMessageId ?? context.source.messageId}]`;
    }

    if (!message) {
      log.debug('No content to send to Claude Code', { traceId: context.traceId });
      return {
        parts: [],
        metadata: { runId: '', providerId: this.id, durationMs: Date.now() - startTime },
      };
    }

    if (this.options.prefixSenderName !== false && context.sender.displayName) {
      message = `[${context.sender.displayName}]: ${message}`;
    }

    // Prepend context messages (message history since last bot response)
    if (context.contextMessages && context.contextMessages.length > 0) {
      const contextBlock = [
        '--- Recent conversation context ---',
        ...context.contextMessages,
        '--- Current message ---',
        '',
      ].join('\n');
      message = `${contextBlock}${message}`;
    }

    // Resolve session: map internal session key → Claude Code session UUID
    // Check TTL and discard expired sessions
    const internalSessionKey = context.sessionId;
    let resolvedSessionId: string | undefined;

    log.debug('Session lookup', {
      internalKey: internalSessionKey,
      instanceId: context.source.instanceId,
    });

    if (internalSessionKey && context.source.instanceId) {
      // Query database for existing session
      const [existingSession] = await this.db
        .select()
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.instanceId, context.source.instanceId),
            eq(agentSessions.sessionKey, internalSessionKey),
          ),
        )
        .limit(1);

      if (existingSession) {
        // Check if session has expired
        const now = new Date();
        const isExpired = existingSession.expiresAt && existingSession.expiresAt < now;

        if (!isExpired) {
          const providerData = existingSession.providerSessionData as { sessionId?: string };
          resolvedSessionId = providerData.sessionId;
          const age = Date.now() - existingSession.lastUsedAt.getTime();
          log.debug('Resuming session from DB', {
            internalKey: internalSessionKey,
            claudeSessionId: resolvedSessionId,
            age: `${Math.round(age / 1000)}s`,
          });
        } else {
          log.debug('Session expired', {
            internalKey: internalSessionKey,
            expiresAt: existingSession.expiresAt,
          });
          // Delete expired session
          await this.db.delete(agentSessions).where(eq(agentSessions.id, existingSession.id));
        }
      } else {
        log.debug('No session found in DB', { internalKey: internalSessionKey });
      }
    }

    log.debug('Session resolution', {
      internalKey: internalSessionKey,
      resolvedUuid: resolvedSessionId ?? '(new session)',
    });

    const request: ProviderRequest = {
      message,
      agentId: 'claude-code', // Claude Code IS the agent
      stream: false,
      sessionId: resolvedSessionId,
      userId: context.sender.personId ?? context.sender.platformUserId,
      timeoutMs: this.options.timeoutMs ?? 120_000,
    };

    log.info('Triggering Claude Code agent', {
      triggerType: context.type,
      traceId: context.traceId,
    });

    const response = await this.client.run(request);

    // Store session UUID in database for future continuity
    if (internalSessionKey && response.sessionId && context.source.instanceId) {
      const now = new Date();
      const expiresAt =
        this.sessionTtlMs < Number.POSITIVE_INFINITY ? new Date(now.getTime() + this.sessionTtlMs) : null;

      // Insert or update session in database
      await this.db
        .insert(agentSessions)
        .values({
          instanceId: context.source.instanceId,
          sessionKey: internalSessionKey,
          providerSessionData: { sessionId: response.sessionId },
          lastUsedAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [agentSessions.instanceId, agentSessions.sessionKey],
          set: {
            providerSessionData: { sessionId: response.sessionId },
            lastUsedAt: now,
            expiresAt,
            updatedAt: now,
          },
        });

      log.debug('Session stored in DB', {
        internalKey: internalSessionKey,
        claudeSessionId: response.sessionId,
        expiresAt: expiresAt?.toISOString() ?? 'never',
      });
    } else {
      log.warn('Session not stored', {
        hasInternalKey: !!internalSessionKey,
        hasResponseSessionId: !!response.sessionId,
        hasInstanceId: !!context.source.instanceId,
        internalKey: internalSessionKey,
        responseSessionId: response.sessionId,
      });
    }

    const parts =
      this.options.enableAutoSplit !== false
        ? response.content
            .split('\n\n')
            .map((p) => p.trim())
            .filter(Boolean)
        : [response.content.trim()].filter(Boolean);

    const durationMs = Date.now() - startTime;

    log.info('Claude Code agent responded', {
      runId: response.runId,
      parts: parts.length,
      durationMs,
      traceId: context.traceId,
    });

    return {
      parts,
      metadata: {
        runId: response.runId,
        providerId: this.id,
        durationMs,
        cost: response.metrics
          ? { inputTokens: response.metrics.inputTokens, outputTokens: response.metrics.outputTokens }
          : undefined,
      },
    };
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return this.client.checkHealth();
  }
}
