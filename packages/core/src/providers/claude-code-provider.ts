/**
 * ClaudeCodeAgentProvider — IAgentProvider wrapper for the Claude Code SDK
 *
 * Wraps ClaudeCodeClient for use in the agent dispatcher.
 * Unlike Agno, Claude Code IS the agent — there's no agent discovery.
 */

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

  /** Maps internal session keys (e.g. "userId:chatId") → Claude Code session UUIDs + timestamp */
  private sessionMap = new Map<string, { uuid: string; lastUsed: number }>();

  /** Session TTL in milliseconds (default: Infinity = never expire) - sessions older than this are discarded */
  private readonly sessionTtlMs: number;

  constructor(
    readonly id: string,
    readonly name: string,
    config: ClaudeCodeConfig,
    private options: ClaudeCodeProviderOptions = {},
  ) {
    this.client = createClaudeCodeClient(config);
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
      hasSessionMap: this.sessionMap.size > 0,
      sessionMapSize: this.sessionMap.size,
    });

    if (internalSessionKey) {
      const sessionData = this.sessionMap.get(internalSessionKey);
      if (sessionData) {
        const age = Date.now() - sessionData.lastUsed;
        if (age < this.sessionTtlMs) {
          resolvedSessionId = sessionData.uuid;
          log.debug('Resuming session', { internalKey: internalSessionKey, age: `${Math.round(age / 1000)}s` });
        } else {
          log.debug('Session expired', { internalKey: internalSessionKey, age: `${Math.round(age / 1000)}s` });
          this.sessionMap.delete(internalSessionKey);
        }
      } else {
        log.debug('No session found in map', { internalKey: internalSessionKey });
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

    // Store session UUID for future continuity (with timestamp for TTL)
    if (internalSessionKey && response.sessionId) {
      this.sessionMap.set(internalSessionKey, { uuid: response.sessionId, lastUsed: Date.now() });
      log.debug('Session stored', {
        internalKey: internalSessionKey,
        claudeSessionId: response.sessionId,
        mapSize: this.sessionMap.size,
        allKeys: Array.from(this.sessionMap.keys()),
      });
    } else {
      log.warn('Session not stored', {
        hasInternalKey: !!internalSessionKey,
        hasResponseSessionId: !!response.sessionId,
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
