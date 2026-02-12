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
}

export class ClaudeCodeAgentProvider implements IAgentProvider {
  readonly schema = 'claude-code' as const;
  readonly mode = 'round-trip' as const;
  private client: ClaudeCodeClient;

  constructor(
    readonly id: string,
    readonly name: string,
    config: ClaudeCodeConfig,
    private options: ClaudeCodeProviderOptions = {},
  ) {
    this.client = createClaudeCodeClient(config);
  }

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

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

    const request: ProviderRequest = {
      message,
      agentId: 'claude-code', // Claude Code IS the agent
      stream: false,
      sessionId: context.sessionId,
      userId: context.sender.personId ?? context.sender.platformUserId,
      timeoutMs: this.options.timeoutMs ?? 120_000,
    };

    log.info('Triggering Claude Code agent', {
      triggerType: context.type,
      traceId: context.traceId,
    });

    const response = await this.client.run(request);

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
