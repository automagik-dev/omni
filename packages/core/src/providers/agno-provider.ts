/**
 * AgnoAgentProvider — wraps IAgentClient as a unified AgentProvider
 *
 * This adapter maintains backward compatibility with the existing Agno integration
 * while conforming to the new AgentProvider interface for multi-provider dispatch.
 */

import { createLogger } from '../logger';
import { SAFE_PROVIDER_ERROR_MESSAGE, toSafeCustomerFallback } from './customer-safe-errors';
import { buildProviderRequestContext } from './execution-context';
import { createTraceContextFromTraceId } from './trace-context';
import type {
  AgentTrigger,
  AgentTriggerResult,
  IAgentClient,
  IAgentProvider,
  ProviderRequest,
  StreamDelta,
} from './types';

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

    const message = this.buildMessage(context);

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

    const request = this.buildRequest(context, message, false);

    log.info('Triggering Agno agent', {
      agentId: this.config.agentId,
      agentType: this.config.agentType,
      triggerType: context.type,
      traceId: context.traceId,
    });

    // Call the provider — client routes internally by agentType
    const response = await this.client.run(request);

    const customerContent = toSafeCustomerFallback(response.content);

    if (customerContent !== response.content) {
      log.error('Blocked provider error from customer-facing Agno response', {
        agentId: this.config.agentId,
        runId: response.runId,
        traceId: context.traceId,
      });
    }

    // Split response if enabled
    const parts =
      this.config.enableAutoSplit !== false
        ? customerContent
            .split('\n\n')
            .map((p) => p.trim())
            .filter(Boolean)
        : [customerContent.trim()].filter(Boolean);

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

  async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
    const message = this.buildMessage(context);

    if (!message) {
      log.debug('No content to send to Agno agent (stream)', { traceId: context.traceId });
      return;
    }

    const request = this.buildRequest(context, message, true);

    log.info('Streaming Agno agent', {
      agentId: this.config.agentId,
      agentType: this.config.agentType,
      triggerType: context.type,
      traceId: context.traceId,
    });

    try {
      for await (const chunk of this.client.stream(request)) {
        if (chunk.content) {
          const safeContent = toSafeCustomerFallback(chunk.content);
          if (safeContent !== chunk.content) {
            log.error('Blocked provider error from customer-facing Agno stream chunk', {
              agentId: this.config.agentId,
              traceId: context.traceId,
            });
            yield { phase: 'content', content: safeContent };
            continue;
          }
          yield { phase: 'content', content: safeContent };
        }

        if (chunk.isComplete) {
          const finalContent = chunk.fullContent ?? chunk.content ?? '';
          yield { phase: 'final', content: toSafeCustomerFallback(finalContent) };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Error in Agno agent stream', {
        agentId: this.config.agentId,
        traceId: context.traceId,
        error: message,
      });
      yield { phase: 'error', error: SAFE_PROVIDER_ERROR_MESSAGE };
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return this.client.checkHealth();
  }

  private buildMessage(context: AgentTrigger): string {
    let message = '';
    if (context.content.text) {
      message = context.content.text;
    } else if (context.content.emoji) {
      // For reaction triggers, format as a reaction notification
      message = `[Reaction: ${context.content.emoji} on message ${context.content.referencedMessageId ?? context.source.messageId}]`;
    }

    // Prefix sender name if configured
    if (message && this.config.prefixSenderName !== false && context.sender.displayName) {
      message = `[${context.sender.displayName}]: ${message}`;
    }

    return message;
  }

  private buildRequest(context: AgentTrigger, message: string, stream: boolean): ProviderRequest {
    const traceContext =
      context.traceContext ??
      createTraceContextFromTraceId(
        context.traceId,
        `${context.source.instanceId}:${context.source.chatId}:${context.source.messageId}:agno`,
      );

    return {
      ...buildProviderRequestContext(context),
      message,
      agentId: this.config.agentId,
      agentType: this.config.agentType,
      stream,
      timeoutMs: this.config.timeoutMs ?? 60000,
      files: context.content.files,
      traceContext,
      khalSessionId: context.sessionId,
      omni: {
        instanceId: context.source.instanceId,
        chatId: context.source.chatId,
        messageId: context.source.messageId,
        channel: context.source.channelType,
      },
      ...(context.source.chatId ? { mcpUrlParams: { chat_id: context.source.chatId } } : {}),
    };
  }
}
