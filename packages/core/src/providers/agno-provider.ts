/**
 * AgnoAgentProvider — wraps IAgentClient as a unified AgentProvider
 *
 * This adapter maintains backward compatibility with the existing Agno integration
 * while conforming to the new AgentProvider interface for multi-provider dispatch.
 */

import { createLogger } from '../logger';
import type { AgentTrigger, AgentTriggerResult, IAgentClient, IAgentProvider, ProviderRequest } from './types';

const log = createLogger('provider:agno');

export class AgnoAgentProvider implements IAgentProvider {
  readonly schema = 'agno' as const;
  readonly mode = 'round-trip' as const;

  constructor(
    readonly id: string,
    readonly name: string,
    private client: IAgentClient,
    private config: {
      agentId: string;
      agentType: 'agent' | 'team' | 'workflow';
      timeoutMs?: number;
      enableAutoSplit?: boolean;
      prefixSenderName?: boolean;
    },
  ) {}

  canHandle(_trigger: AgentTrigger): boolean {
    // Agno can handle all trigger types (messages, reactions, mentions, etc.)
    return true;
  }

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const startTime = Date.now();

    // Build the message from trigger content
    let message = '';
    if (context.content.text) {
      message = context.content.text;
    } else if (context.content.emoji) {
      // For reaction triggers, format as a reaction notification
      message = `[Reaction: ${context.content.emoji} on message ${context.content.referencedMessageId ?? context.source.messageId}]`;
    }

    if (!message) {
      log.debug('No content to send to agent', { traceId: context.traceId });
      return {
        parts: [],
        metadata: {
          runId: '',
          providerId: this.id,
          durationMs: Date.now() - startTime,
        },
      };
    }

    // Prefix sender name if configured
    if (this.config.prefixSenderName !== false && context.sender.displayName) {
      message = `[${context.sender.displayName}]: ${message}`;
    }

    const request: ProviderRequest = {
      message,
      agentId: this.config.agentId,
      agentType: this.config.agentType,
      stream: false,
      sessionId: context.sessionId,
      userId: context.sender.platformUserId,
      timeoutMs: this.config.timeoutMs ?? 60000,
    };

    log.info('Triggering Agno agent', {
      agentId: this.config.agentId,
      agentType: this.config.agentType,
      triggerType: context.type,
      traceId: context.traceId,
    });

    // Call the provider — client routes internally by agentType
    const response = await this.client.run(request);

    // Split response if enabled
    const parts =
      this.config.enableAutoSplit !== false
        ? response.content
            .split('\n\n')
            .map((p) => p.trim())
            .filter(Boolean)
        : [response.content.trim()].filter(Boolean);

    const durationMs = Date.now() - startTime;

    log.info('Agno agent responded', {
      agentId: this.config.agentId,
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
          ? {
              inputTokens: response.metrics.inputTokens,
              outputTokens: response.metrics.outputTokens,
            }
          : undefined,
      },
    };
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return this.client.checkHealth();
  }
}
