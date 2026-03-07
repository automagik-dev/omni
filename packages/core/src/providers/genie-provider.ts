/**
 * GenieAgentProvider — delivers messages to Claude Code's native team inbox
 *
 * Fire-and-forget: writes to the team member's inbox file.
 * The agent receives natively and replies via omni send.
 */

import { createLogger } from '../logger';
import type { GenieClient } from './genie-client';
import type { AgentTrigger, AgentTriggerResult, IAgentProvider, ProviderRequest } from './types';

const log = createLogger('provider:genie');

export interface GenieProviderConfig {
  /** Prefix sender name to messages (default: true) */
  prefixSenderName?: boolean;
}

export class GenieAgentProvider implements IAgentProvider {
  readonly schema = 'genie' as const;
  readonly mode = 'fire-and-forget' as const;

  constructor(
    readonly id: string,
    readonly name: string,
    private client: GenieClient,
    private config: GenieProviderConfig = {},
  ) {}

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const startTime = Date.now();

    const message = this.buildMessage(context);
    if (!message) {
      log.debug('No content to send', { traceId: context.traceId });
      return {
        parts: [],
        metadata: { runId: '', providerId: this.id, durationMs: Date.now() - startTime },
      };
    }

    const request: ProviderRequest = {
      message,
      agentId: 'genie',
      stream: false,
      sessionId: context.sessionId,
      userId: context.sender.personId ?? context.sender.platformUserId,
      messageId: context.source.messageId || undefined,
      replyToMessageId: context.content.referencedMessageId || undefined,
      sender: {
        displayName: context.sender.displayName,
        platformUsername: context.sender.platformUserId,
      },
      platform: {
        id: context.sender.platformUserId,
        channel: context.source.channelType,
        instanceId: context.source.instanceId,
      },
      chat: {
        type: context.type === 'dm' ? 'dm' : 'group',
        id: context.source.chatId,
        threadId: context.source.threadId,
      },
      files: context.content.files,
    };

    log.info('Delivering to team inbox', {
      triggerType: context.type,
      traceId: context.traceId,
    });

    const response = await this.client.run(request);

    const durationMs = Date.now() - startTime;

    log.info('Delivered to team inbox', {
      runId: response.runId,
      durationMs,
      traceId: context.traceId,
    });

    // Fire-and-forget: return empty parts (agent replies independently via omni send)
    return {
      parts: [],
      metadata: {
        runId: response.runId,
        providerId: this.id,
        durationMs,
      },
    };
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
