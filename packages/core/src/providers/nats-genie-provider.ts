/**
 * NatsGenieProvider — NATS-based agent provider for Genie integration.
 *
 * Replaces the filesystem-based GenieClient + GenieAgentProvider with
 * native NATS pub/sub transport:
 *   - Publishes inbound messages to omni.message.{instance}.{chat_id}
 *   - Subscribes to omni.reply.{instance}.* for agent responses
 *   - No filesystem. No execFile. No polling.
 *
 * Fire-and-forget: Omni publishes to NATS and returns immediately.
 * Genie's omni-bridge picks up messages and routes to agent sessions.
 * Agent replies come back via NATS subscription.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type NatsConnection, StringCodec, connect } from 'nats';
import { createLogger } from '../logger';
import type { AgentTrigger, AgentTriggerResult, IAgentProvider, ProviderFile } from './types';

const log = createLogger('provider:nats-genie');

// ============================================================================
// Types
// ============================================================================

export interface NatsGenieProviderConfig {
  /** Genie agent name (from genie directory) */
  agentName: string;
  /** NATS server URL */
  natsUrl: string;
  /** Omni instance ID (for topic routing) */
  instanceId: string;
  /** Callback to deliver agent replies to WhatsApp */
  onReply?: (chatId: string, content: string, metadata: Record<string, unknown>) => Promise<void>;
  /** Prefix sender name to messages (default: true) */
  prefixSenderName?: boolean;
  /** Execution mode: 'fire-and-forget' (default) or 'turn-based' */
  mode?: 'fire-and-forget' | 'turn-based';
}

/** NATS message payload published to omni.message.{instance}.{chat_id} */
interface NatsOutboundMessage {
  content: string;
  sender: string;
  instanceId: string;
  chatId: string;
  agent: string;
  timestamp: string;
  traceId: string;
  messageId?: string;
  files?: ProviderFile[];
  /** Environment variables for turn-based agents (OMNI_INSTANCE, OMNI_CHAT, etc.) */
  env?: Record<string, string>;
}

/** NATS reply payload received from omni.reply.{instance}.{chat_id} */
interface NatsReplyMessage {
  content: string;
  agent: string;
  chat_id: string;
  instance_id?: string;
  timestamp: string;
  auto_reply?: boolean;
}

// ============================================================================
// Provider
// ============================================================================

export class NatsGenieProvider implements IAgentProvider {
  readonly schema = 'nats-genie' as const;
  readonly mode: 'fire-and-forget' | 'turn-based';

  private nc: NatsConnection | null = null;
  private sc = StringCodec();
  private replySubscription: { unsubscribe: () => void } | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    private config: NatsGenieProviderConfig,
  ) {
    this.mode = config.mode ?? 'fire-and-forget';
  }

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

  /**
   * Publish inbound message to NATS for Genie to pick up.
   * Fire-and-forget: returns immediately with empty parts.
   */
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

    const topic = `omni.message.${this.config.instanceId}.${context.source.chatId}`;
    const payload: NatsOutboundMessage = {
      content: message,
      sender: context.sender.displayName ?? context.sender.platformUserId,
      instanceId: this.config.instanceId,
      chatId: context.source.chatId,
      agent: this.config.agentName,
      timestamp: new Date().toISOString(),
      traceId: context.traceId,
      messageId: context.source.messageId,
      files: context.content.files,
      env: context.env,
    };

    try {
      await this.ensureConnected();
      this.nc?.publish(topic, this.sc.encode(JSON.stringify(payload)));

      log.info('Published to NATS', {
        topic,
        agent: this.config.agentName,
        chatId: context.source.chatId,
        traceId: context.traceId,
      });
    } catch (error) {
      log.error('Failed to publish to NATS, writing to dead-letter queue', {
        topic,
        error: error instanceof Error ? error.message : String(error),
        traceId: context.traceId,
      });
      // Dead-letter: log the failed message for manual recovery
      await this.writeDeadLetter(payload, error);
    }

    const durationMs = Date.now() - startTime;

    return {
      parts: [],
      metadata: {
        runId: `nats-genie-${Date.now()}`,
        providerId: this.id,
        durationMs,
      },
    };
  }

  /**
   * Start the reply subscription for this instance.
   * Listens on omni.reply.{instance}.* and forwards to the onReply callback.
   */
  async startReplySubscription(): Promise<void> {
    if (!this.config.onReply) return;
    if (this.replySubscription) return;

    await this.ensureConnected();
    if (!this.nc) return;

    const topic = `omni.reply.${this.config.instanceId}.*`;
    const sub = this.nc.subscribe(topic);
    this.replySubscription = sub;

    log.info('Subscribed to agent replies', { topic });

    // Process replies in background
    (async () => {
      for await (const msg of sub) {
        try {
          const data: NatsReplyMessage = JSON.parse(this.sc.decode(msg.data));
          const chatId = data.chat_id || msg.subject.split('.').pop() || '';

          if (data.content && this.config.onReply) {
            await this.config.onReply(chatId, data.content, {
              agent: data.agent,
              auto_reply: data.auto_reply,
              timestamp: data.timestamp,
            });
          }
        } catch (error) {
          log.error('Error processing reply', {
            subject: msg.subject,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const startMs = Date.now();
    try {
      await this.ensureConnected();
      return { healthy: this.nc !== null, latencyMs: Date.now() - startMs };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startMs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async dispose(): Promise<void> {
    if (this.replySubscription) {
      this.replySubscription.unsubscribe();
      this.replySubscription = null;
    }
    if (this.nc) {
      try {
        await this.nc.drain();
      } catch {
        // Connection may already be closed
      }
      this.nc = null;
    }
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private async ensureConnected(): Promise<void> {
    if (this.nc) return;

    this.nc = await connect({
      servers: this.config.natsUrl,
      name: `omni-nats-genie-${this.config.instanceId}`,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    });

    log.info('Connected to NATS', { url: this.config.natsUrl });
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

  private async writeDeadLetter(payload: NatsOutboundMessage, error: unknown): Promise<void> {
    try {
      const dlDir = join(homedir(), '.omni', 'dead-letters');
      await mkdir(dlDir, { recursive: true });

      const filename = `nats-genie-${Date.now()}-${payload.chatId}.json`;
      await writeFile(
        join(dlDir, filename),
        JSON.stringify(
          {
            payload,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      log.warn('Dead letter written', { filename });
    } catch (dlError) {
      log.error('Failed to write dead letter', {
        error: dlError instanceof Error ? dlError.message : String(dlError),
      });
    }
  }
}
