/**
 * AgUiAgentProvider — IAgentProvider wrapper for the CopilotKit AG-UI SSE protocol
 *
 * Enables the dispatcher to use AG-UI agents via both the round-trip trigger()
 * path and the streaming triggerStream() path. Without this wrapper the dispatcher
 * falls through to the legacy agentRunner path which loses streaming.
 */

import { createLogger } from '../logger';
import { createAgUiClient } from './ag-ui-client';
import { buildProviderRequestContext } from './execution-context';
import type {
  AgentTrigger,
  AgentTriggerResult,
  IAgentClient,
  IAgentProvider,
  ProviderRequest,
  StreamDelta,
} from './types';

const log = createLogger('provider:ag-ui');

export class AgUiAgentProvider implements IAgentProvider {
  readonly schema = 'ag-ui' as const;
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
      log.debug('No content to send to AG-UI agent', { traceId: context.traceId });
      return { parts: [], metadata: { runId: '', providerId: this.id, durationMs: 0 } };
    }

    const request: ProviderRequest = {
      ...buildProviderRequestContext(context),
      message,
      agentId: this.config.agentId,
      timeoutMs: this.config.timeoutMs ?? 60_000,
    };

    log.info('Triggering AG-UI agent', { agentId: this.config.agentId, traceId: context.traceId });

    const response = await this.client.run(request);
    const durationMs = Date.now() - startTime;

    const parts =
      this.config.enableAutoSplit !== false
        ? response.content
            .split('\n\n')
            .map((p) => p.trim())
            .filter(Boolean)
        : [response.content.trim()].filter(Boolean);

    log.info('AG-UI agent responded', {
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
      log.debug('No content to send to AG-UI agent (stream)', { traceId: context.traceId });
      return;
    }

    const request: ProviderRequest = {
      ...buildProviderRequestContext(context),
      message,
      agentId: this.config.agentId,
      timeoutMs: this.config.timeoutMs ?? 60_000,
    };

    log.info('Streaming AG-UI agent', { agentId: this.config.agentId, traceId: context.traceId });

    for await (const chunk of this.client.stream(request)) {
      if (chunk.event === 'delta' && chunk.content) {
        yield { phase: 'content', content: chunk.content };
      } else if (chunk.event === 'final') {
        yield { phase: 'final', content: chunk.fullContent ?? '' };
      } else if (chunk.event === 'error') {
        yield { phase: 'error', error: chunk.content ?? 'AG-UI agent error' };
      }
      // 'start' and unknown events are skipped
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

export function createAgUiProvider(
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
): AgUiAgentProvider {
  const client = createAgUiClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    defaultTimeoutMs: config.timeoutMs,
  });
  return new AgUiAgentProvider(id, name, client, {
    agentId: config.agentId,
    timeoutMs: config.timeoutMs,
    enableAutoSplit: config.enableAutoSplit,
    prefixSenderName: config.prefixSenderName,
  });
}
