/**
 * ClaudeCodeAgentProvider — IAgentProvider wrapper for the Claude Code SDK
 *
 * Wraps ClaudeCodeClient for use in the agent dispatcher.
 * Unlike Agno, Claude Code IS the agent — there's no agent discovery.
 */

import { createLogger } from '../logger';
import type { ClaudeCodeClient, ClaudeCodeConfig, ClaudeCodeStreamConfig } from './claude-code-client';
import { createClaudeCodeClient } from './claude-code-client';
import type { AgentTrigger, AgentTriggerResult, IAgentProvider, ProviderRequest, StreamDelta } from './types';

/**
 * Session storage adapter interface - allows core to be database-agnostic
 */
export interface SessionStorage {
  getSession(instanceId: string, sessionKey: string): Promise<{ sessionId: string; lastUsedAt: Date } | null>;
  upsertSession(instanceId: string, sessionKey: string, sessionId: string, expiresAt: Date | null): Promise<void>;
  deleteSession(instanceId: string, sessionKey: string): Promise<void>;
}

const log = createLogger('provider:claude-code');

export interface ClaudeCodeProviderOptions {
  /** Timeout in ms (default: 120000 — Claude Code agents can run longer than simple LLMs) */
  timeoutMs?: number;
  /** Split response on double newlines (default: true) */
  enableAutoSplit?: boolean;
  /** Prefix sender name to messages (default: true) */
  prefixSenderName?: boolean;
  /** Session TTL in ms (default: Infinity = never expire) - sessions older than this are discarded */
  sessionTtlMs?: number;
  /** Streaming configuration — controls what's visible in streamed responses */
  streamConfig?: ClaudeCodeStreamConfig;
}

const MAX_CONTEXT_MESSAGES = 20;
const MAX_CONTEXT_CHARS = 4000;

function boundContextMessages(contextMessages: string[]): string[] {
  const bounded = contextMessages.slice(-MAX_CONTEXT_MESSAGES);

  while (bounded.length > 1 && bounded.join('\n').length > MAX_CONTEXT_CHARS) {
    bounded.shift();
  }

  if (bounded.length === 1 && bounded[0] && bounded[0].length > MAX_CONTEXT_CHARS) {
    bounded[0] = bounded[0].slice(bounded[0].length - MAX_CONTEXT_CHARS);
  }

  return bounded;
}

/** Prepared request data shared between trigger() and triggerStream(). */
interface PreparedRequest {
  message: string;
  resolvedSessionId: string | undefined;
  internalSessionKey: string;
}

export class ClaudeCodeAgentProvider implements IAgentProvider {
  readonly schema = 'claude-code' as const;
  readonly mode = 'round-trip' as const;
  private client: ClaudeCodeClient;
  private sessionStorage: SessionStorage;

  /** Session TTL in milliseconds (default: Infinity = never expire) - sessions older than this are discarded */
  private readonly sessionTtlMs: number;

  constructor(
    readonly id: string,
    readonly name: string,
    config: ClaudeCodeConfig,
    sessionStorage: SessionStorage,
    private options: ClaudeCodeProviderOptions = {},
  ) {
    this.client = createClaudeCodeClient(config);
    this.sessionStorage = sessionStorage;
    // Default: no TTL (sessions never expire unless explicitly configured)
    this.sessionTtlMs = this.options.sessionTtlMs ?? Number.POSITIVE_INFINITY;
  }

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

  /**
   * Extract and format the message text from trigger content.
   * Returns empty string if there's no sendable content.
   */
  private buildMessage(context: AgentTrigger): string {
    let message = '';
    if (context.content.text) {
      message = context.content.text;
    } else if (context.content.emoji) {
      message = `[Reaction: ${context.content.emoji} on message ${context.content.referencedMessageId ?? context.source.messageId}]`;
    }

    if (!message) return '';

    if (this.options.prefixSenderName !== false && context.sender.displayName) {
      message = `[${context.sender.displayName}]: ${message}`;
    }

    // Append file path references so Claude Code can read images and documents via its tools.
    // Claude Sonnet/Haiku support vision — the Read tool can handle image files directly.
    if (context.content.files && context.content.files.length > 0) {
      const fileList = context.content.files.map((f) => `- ${f.path} [${f.mimeType}]`).join('\n');
      message += `\n\nAttached files:\n${fileList}`;
    }

    // Prepend context messages (message history since last bot response)
    if (context.contextMessages && context.contextMessages.length > 0) {
      const boundedContext = boundContextMessages(context.contextMessages);
      const contextBlock = [
        '--- Recent conversation context ---',
        ...boundedContext,
        '--- Current message ---',
        '',
      ].join('\n');
      message = `${contextBlock}${message}`;
    }

    return message;
  }

  /**
   * Resolve the Claude Code session UUID for an internal session key.
   * Checks TTL and discards expired sessions.
   */
  private async resolveSession(instanceId: string, internalSessionKey: string): Promise<string | undefined> {
    if (!internalSessionKey || !instanceId) return undefined;

    log.debug('Session lookup', { internalKey: internalSessionKey, instanceId });

    const existing = await this.sessionStorage.getSession(instanceId, internalSessionKey);
    if (!existing) {
      log.debug('No session found in DB', { internalKey: internalSessionKey });
      return undefined;
    }

    const age = Date.now() - existing.lastUsedAt.getTime();

    // Check if session has expired based on TTL
    if (this.sessionTtlMs < Number.POSITIVE_INFINITY && age >= this.sessionTtlMs) {
      log.debug('Session expired', {
        internalKey: internalSessionKey,
        age: `${Math.round(age / 1000)}s`,
        ttl: `${Math.round(this.sessionTtlMs / 1000)}s`,
      });
      await this.sessionStorage.deleteSession(instanceId, internalSessionKey);
      return undefined;
    }

    log.debug('Resuming session from DB', {
      internalKey: internalSessionKey,
      claudeSessionId: existing.sessionId,
      age: `${Math.round(age / 1000)}s`,
    });
    return existing.sessionId;
  }

  /**
   * Prepare the message and resolve the session for a trigger.
   * Shared between trigger() and triggerStream() to avoid duplication.
   *
   * Returns null if there's no content to send (caller should return empty result).
   */
  private async prepareRequest(context: AgentTrigger): Promise<PreparedRequest | null> {
    const message = this.buildMessage(context);
    if (!message) return null;

    const internalSessionKey = context.sessionId;
    const resolvedSessionId = await this.resolveSession(context.source.instanceId, internalSessionKey);

    log.debug('Session resolution', {
      internalKey: internalSessionKey,
      resolvedUuid: resolvedSessionId ?? '(new session)',
    });

    return { message, resolvedSessionId, internalSessionKey };
  }

  /**
   * Persist the session UUID returned by Claude Code for future continuity.
   */
  private async persistSession(instanceId: string, internalSessionKey: string, claudeSessionId: string): Promise<void> {
    if (!internalSessionKey || !claudeSessionId || !instanceId) {
      log.warn('Session not stored', {
        hasInternalKey: !!internalSessionKey,
        hasResponseSessionId: !!claudeSessionId,
        hasInstanceId: !!instanceId,
        internalKey: internalSessionKey,
        responseSessionId: claudeSessionId,
      });
      return;
    }

    const expiresAt = this.sessionTtlMs < Number.POSITIVE_INFINITY ? new Date(Date.now() + this.sessionTtlMs) : null;

    await this.sessionStorage.upsertSession(instanceId, internalSessionKey, claudeSessionId, expiresAt);

    log.debug('Session stored in DB', {
      internalKey: internalSessionKey,
      claudeSessionId,
      expiresAt: expiresAt?.toISOString() ?? 'never',
    });
  }

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const startTime = Date.now();

    const prepared = await this.prepareRequest(context);
    if (!prepared) {
      log.debug('No content to send to Claude Code', { traceId: context.traceId });
      return {
        parts: [],
        metadata: { runId: '', providerId: this.id, durationMs: Date.now() - startTime },
      };
    }

    const { message, resolvedSessionId, internalSessionKey } = prepared;

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

    // Store session UUID for future continuity
    await this.persistSession(context.source.instanceId, internalSessionKey, response.sessionId);

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

  /**
   * Stream a Claude Code agent response as cumulative StreamDelta values.
   *
   * Uses ClaudeCodeClient.streamRun() to iterate SDK messages with
   * includePartialMessages enabled. After the stream completes, persists
   * the session for future continuity.
   */
  async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
    const prepared = await this.prepareRequest(context);
    if (!prepared) {
      log.debug('No content to send to Claude Code (stream)', { traceId: context.traceId });
      return;
    }

    const { message, resolvedSessionId, internalSessionKey } = prepared;

    const request: ProviderRequest = {
      message,
      agentId: 'claude-code',
      stream: true,
      sessionId: resolvedSessionId,
      userId: context.sender.personId ?? context.sender.platformUserId,
      timeoutMs: this.options.timeoutMs ?? 120_000,
    };

    log.info('Triggering Claude Code agent (stream)', {
      triggerType: context.type,
      traceId: context.traceId,
    });

    const streamConfig = this.options.streamConfig;
    const result = this.client.streamRun(request, streamConfig, context.abortSignal);

    try {
      for await (const delta of result.stream) {
        yield delta;
      }
    } finally {
      // Persist session after stream completes (success or error)
      const claudeSessionId = result.getSessionId();
      if (claudeSessionId) {
        await this.persistSession(context.source.instanceId, internalSessionKey, claudeSessionId);
      }

      const streamMetrics = result.getMetrics();
      if (streamMetrics) {
        log.info('Claude Code agent stream completed', {
          traceId: context.traceId,
          sessionId: claudeSessionId,
          durationMs: streamMetrics.durationMs,
          costUsd: streamMetrics.costUsd,
          inputTokens: streamMetrics.inputTokens,
          outputTokens: streamMetrics.outputTokens,
        });
      }
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return this.client.checkHealth();
  }

  /** Clear persisted Claude session mapping for a strategy-computed session key. */
  async resetSession(sessionKey: string, _chatId?: string, instanceId?: string): Promise<void> {
    if (!instanceId) {
      log.warn('Claude session reset skipped: missing instanceId', {
        providerId: this.id,
        sessionKey,
      });
      throw new Error('instanceId is required to reset Claude Code session');
    }

    await this.sessionStorage.deleteSession(instanceId, sessionKey);
    log.info('Claude session reset', {
      providerId: this.id,
      instanceId,
      sessionKey,
    });
  }
}
