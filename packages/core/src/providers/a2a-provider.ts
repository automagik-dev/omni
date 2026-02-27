/**
 * A2AAgentProvider — IAgentProvider wrapper for the A2A JSON-RPC protocol
 *
 * Enables the dispatcher to use external A2A-compatible agents via both the
 * round-trip trigger() path and the streaming triggerStream() path. Without
 * this wrapper the dispatcher falls through to the legacy agentRunner path
 * which loses A2A streaming (message/stream).
 */

import { createLogger } from '../logger';
import { createA2AClient } from './a2a-client';
import type {
  AgentTrigger,
  AgentTriggerResult,
  IAgentClient,
  IAgentProvider,
  ProviderRequest,
  StreamDelta,
} from './types';

const log = createLogger('provider:a2a');

export class A2AAgentProvider implements IAgentProvider {
  readonly schema = 'a2a' as const;
  readonly mode = 'round-trip' as const;

  constructor(
    readonly id: string,
    readonly name: string,
    private client: IAgentClient,
    private config: {
      agentId: string;
      timeoutMs?: number;
      enableAutoSplit?: boolean;
      prefixSenderName?: boolean;
    },
  ) {}

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const startTime = Date.now();
    const message = this.buildMessage(context);

    if (!message) {
      log.debug('No content to send to A2A agent', { traceId: context.traceId });
      return { parts: [], metadata: { runId: '', providerId: this.id, durationMs: 0 } };
    }

    const request: ProviderRequest = {
      message,
      agentId: this.config.agentId,
      sessionId: context.sessionId,
      userId: context.sender.platformUserId,
      timeoutMs: this.config.timeoutMs ?? 60_000,
    };

    log.info('Triggering A2A agent', { agentId: this.config.agentId, traceId: context.traceId });

    const response = await this.client.run(request);
    const durationMs = Date.now() - startTime;

    const parts =
      this.config.enableAutoSplit !== false
        ? response.content
            .split('\n\n')
            .map((p) => p.trim())
            .filter(Boolean)
        : [response.content.trim()].filter(Boolean);

    log.info('A2A agent responded', {
      runId: response.runId,
      parts: parts.length,
      durationMs,
      traceId: context.traceId,
    });

    return {
      parts,
      metadata: { runId: response.runId, providerId: this.id, durationMs },
    };
  }

  async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
    const message = this.buildMessage(context);

    if (!message) {
      log.debug('No content to send to A2A agent (stream)', { traceId: context.traceId });
      return;
    }

    const request: ProviderRequest = {
      message,
      agentId: this.config.agentId,
      sessionId: context.sessionId,
      userId: context.sender.platformUserId,
      timeoutMs: this.config.timeoutMs ?? 60_000,
    };

    log.info('Streaming A2A agent', { agentId: this.config.agentId, traceId: context.traceId });

    for await (const chunk of this.client.stream(request)) {
      if (chunk.event === 'artifact' && chunk.content) {
        yield { phase: 'content', content: chunk.content };
      } else if (chunk.event === 'delta' && chunk.content) {
        yield { phase: 'content', content: chunk.content };
      } else if (chunk.event === 'final') {
        yield { phase: 'final', content: chunk.fullContent ?? '' };
      } else if (chunk.event === 'error') {
        yield { phase: 'error', error: chunk.content ?? 'A2A agent error' };
      }
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
      message = `[Reaction: ${context.content.emoji} on message ${context.content.referencedMessageId ?? context.source.messageId}]`;
    }

    if (message && this.config.prefixSenderName !== false && context.sender.displayName) {
      message = `[${context.sender.displayName}]: ${message}`;
    }

    return message;
  }
}

export function createA2AProvider(
  id: string,
  name: string,
  config: {
    baseUrl: string;
    apiKey?: string;
    agentId: string;
    timeoutMs?: number;
    enableAutoSplit?: boolean;
    prefixSenderName?: boolean;
  },
): A2AAgentProvider {
  const client = createA2AClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    defaultTimeoutMs: config.timeoutMs,
  });
  return new A2AAgentProvider(id, name, client, {
    agentId: config.agentId,
    timeoutMs: config.timeoutMs,
    enableAutoSplit: config.enableAutoSplit,
    prefixSenderName: config.prefixSenderName,
  });
}
