/**
 * A2A Agent Provider
 *
 * IAgentProvider wrapper around A2AClient.
 * Enables Omni to call external A2A-compatible agents as providers.
 */

import type { ProviderSchema } from '../types/agent';
import { A2AClient, type A2AClientConfig } from './a2a-client';
import type { AgentTrigger, AgentTriggerResult, IAgentProvider, StreamDelta } from './types';

export interface A2AProviderConfig extends A2AClientConfig {
  id: string;
  name: string;
}

export class A2AAgentProvider implements IAgentProvider {
  readonly id: string;
  readonly name: string;
  readonly schema: ProviderSchema = 'a2a';
  readonly mode: 'round-trip' | 'fire-and-forget' = 'round-trip';

  private readonly client: A2AClient;

  constructor(config: A2AProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.client = new A2AClient(config);
  }

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult | null> {
    const startMs = Date.now();

    const request = {
      message: context.content.text ?? '',
      agentId: this.id,
      agentType: 'agent' as const,
      sessionId: context.sessionId,
      userId: context.sender.personId ?? context.sender.platformUserId,
      stream: false,
    };

    const response = await this.client.run(request);

    return {
      parts: response.content ? [response.content] : [],
      metadata: {
        runId: response.runId,
        providerId: this.id,
        durationMs: Date.now() - startMs,
        cost: {
          inputTokens: response.metrics?.inputTokens,
          outputTokens: response.metrics?.outputTokens,
        },
      },
    };
  }

  async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
    const request = {
      message: context.content.text ?? '',
      agentId: this.id,
      agentType: 'agent' as const,
      sessionId: context.sessionId,
      userId: context.sender.personId ?? context.sender.platformUserId,
      stream: true,
    };

    let accumulated = '';

    for await (const chunk of this.client.stream(request)) {
      if (chunk.isComplete) {
        if (accumulated) {
          yield { phase: 'final', content: accumulated };
        }
        return;
      }

      if (chunk.content) {
        accumulated += chunk.content;
        yield { phase: 'content', content: chunk.content };
      }
    }

    if (accumulated) {
      yield { phase: 'final', content: accumulated };
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    return this.client.checkHealth();
  }
}

export function createA2AProvider(config: A2AProviderConfig): A2AAgentProvider {
  return new A2AAgentProvider(config);
}
