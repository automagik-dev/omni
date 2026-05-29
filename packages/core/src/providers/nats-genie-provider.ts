/**
 * NatsGenieProvider — NATS-based agent provider for Genie integration.
 *
 * Replaces the filesystem-based GenieClient + GenieAgentProvider with
 * native NATS pub/sub transport:
 *   - Publishes inbound messages to omni.message.{instance}.{chat_id}
 *   - Subscribes to omni.reply.{instance}.> for agent responses (recursive
 *     wildcard is mandatory — WhatsApp chat IDs contain dots, e.g.
 *     5511999999999@s.whatsapp.net, which tokenize as multiple NATS segments)
 *   - Publishes session-reset intents to omni.session.reset.{instance}.{chat_id}
 *   - No filesystem. No execFile. No polling.
 *
 * Fire-and-forget: Omni publishes to NATS and returns immediately.
 * Genie's omni-bridge picks up messages and routes to agent sessions.
 * Agent replies come back via NATS subscription.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type NatsConnection, StringCodec, connect, headers as createNatsHeaders } from 'nats';
import { createLogger } from '../logger';
import { buildOmniEnv, buildOmniExecutionContext } from './execution-context';
import { buildTraceHeaders } from './trace-context';
import type {
  AgentTrigger,
  AgentTriggerResult,
  IAgentProvider,
  OmniExecutionContext,
  ProviderFile,
  TraceContext,
} from './types';

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
  contextMessages?: string[];
  files?: ProviderFile[];
  traceContext?: TraceContext;
  metadata?: Record<string, string>;
  /** Environment variables for turn-based agents (OMNI_INSTANCE, OMNI_CHAT, etc.) */
  env?: Record<string, string>;
  executionContext?: OmniExecutionContext;
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

/** NATS session-reset payload published to omni.session.reset.{instance}.{chat_id} */
interface NatsSessionResetMessage {
  action: 'kill';
  sessionKey: string;
  agent: string;
  instance_id: string;
  chat_id: string;
  timestamp: string;
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
    const propagationHeaders = this.buildPropagationHeaders(context);
    const payload: NatsOutboundMessage = {
      content: message,
      sender: context.sender.displayName ?? context.sender.platformUserId,
      instanceId: this.config.instanceId,
      chatId: context.source.chatId,
      agent: this.config.agentName,
      timestamp: new Date().toISOString(),
      traceId: context.traceId,
      messageId: context.source.messageId,
      contextMessages: context.contextMessages,
      files: context.content.files,
      traceContext: context.traceContext,
      metadata: this.buildSafePayloadMetadata(propagationHeaders),
      env: buildOmniEnv(context),
      executionContext: buildOmniExecutionContext(context),
    };

    try {
      await this.ensureConnected();
      this.nc?.publish(topic, this.sc.encode(JSON.stringify(payload)), this.buildPublishOptions(propagationHeaders));

      log.info('Published to NATS', {
        subject: 'omni.message.<instance>.<chat_hash>',
        agent: this.config.agentName,
        instanceId: this.config.instanceId,
        chatHash: this.safeHash(context.source.chatId),
        traceId: context.traceId,
      });
    } catch (error) {
      log.error('Failed to publish to NATS, writing to dead-letter queue', {
        subject: 'omni.message.<instance>.<chat_hash>',
        instanceId: this.config.instanceId,
        chatHash: this.safeHash(context.source.chatId),
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
   * Listens on omni.reply.{instance}.> and forwards to the onReply callback.
   *
   * NOTE: The recursive wildcard `>` is mandatory here. WhatsApp chat_ids
   * contain dots (e.g. `5511999999999@s.whatsapp.net`), which NATS tokenizes
   * as multiple subject segments. A single-token wildcard `*` would silently
   * miss every WhatsApp reply — historically masked in production by the
   * external `nats-reply-sidecar.mjs` which used `omni.reply.>`.
   * See automagik-dev/omni#361.
   */
  async startReplySubscription(): Promise<void> {
    if (!this.config.onReply) return;
    if (this.replySubscription) return;

    await this.ensureConnected();
    if (!this.nc) return;

    const topic = `omni.reply.${this.config.instanceId}.>`;
    const sub = this.nc.subscribe(topic);
    this.replySubscription = sub;

    log.info('Subscribed to agent replies', { topic });

    // Process replies in background
    const subjectPrefix = `omni.reply.${this.config.instanceId}.`;
    (async () => {
      for await (const msg of sub) {
        try {
          const data: NatsReplyMessage = JSON.parse(this.sc.decode(msg.data));
          // Prefer the explicit chat_id in the payload; fall back to the
          // subject suffix (which may itself contain dots for WhatsApp).
          const chatId =
            data.chat_id ||
            (msg.subject.startsWith(subjectPrefix)
              ? msg.subject.slice(subjectPrefix.length)
              : msg.subject.split('.').pop() || '');

          if (data.content && this.config.onReply) {
            await this.config.onReply(chatId, data.content, {
              agent: data.agent,
              auto_reply: data.auto_reply,
              timestamp: data.timestamp,
            });
          }
        } catch (error) {
          log.error('Error processing reply', {
            subject: 'omni.reply.<instance>.<chat_hash>',
            subjectHash: this.safeHash(msg.subject),
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

  /**
   * Propagate a session reset to the genie-side bridge.
   *
   * Publishes `{ action: 'kill' }` on
   * `omni.session.reset.{instanceId}.{chatId}` so the genie omni-bridge can
   * tear down the corresponding agent session (mirror of
   * `executeProviderSessionReset()` in agent-dispatcher.ts).
   *
   * Cross-repo dependency: requires the genie omni-bridge to subscribe to
   * this subject. Tracked in automagik-dev/genie#1089 — until that ships,
   * this publish is a durable no-op (fire-and-forget, no subscriber error).
   */
  async resetSession(sessionKey: string, chatId?: string, instanceId?: string): Promise<void> {
    const resolvedInstanceId = instanceId ?? this.config.instanceId;
    if (!chatId) {
      log.warn('NATS session reset skipped: missing chatId', {
        providerId: this.id,
        sessionKeyHash: this.safeHash(sessionKey),
      });
      throw new Error('chatId is required to reset NATS Genie session');
    }

    const topic = `omni.session.reset.${resolvedInstanceId}.${chatId}`;
    const payload: NatsSessionResetMessage = {
      action: 'kill',
      sessionKey,
      agent: this.config.agentName,
      instance_id: resolvedInstanceId,
      chat_id: chatId,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.ensureConnected();
      this.nc?.publish(topic, this.sc.encode(JSON.stringify(payload)));
      log.info('Published session reset to NATS', {
        subject: 'omni.session.reset.<instance>.<chat_hash>',
        providerId: this.id,
        instanceId: resolvedInstanceId,
        sessionKeyHash: this.safeHash(sessionKey),
        chatHash: this.safeHash(chatId),
      });
    } catch (error) {
      log.error('Failed to publish NATS session reset', {
        subject: 'omni.session.reset.<instance>.<chat_hash>',
        instanceId: resolvedInstanceId,
        chatHash: this.safeHash(chatId),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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

  private buildPropagationHeaders(context: AgentTrigger): Record<string, string> {
    return buildTraceHeaders(context.traceContext, {
      khalSessionId: context.sessionId,
      userId: context.sender.personId ?? context.sender.platformUserId,
      messageId: context.source.messageId,
      omni: {
        instanceId: context.source.instanceId,
        chatId: context.source.chatId,
        channel: context.source.channelType,
      },
    });
  }

  private buildPublishOptions(
    traceHeaders: Record<string, string>,
  ): { headers?: ReturnType<typeof createNatsHeaders> } | undefined {
    if (Object.keys(traceHeaders).length === 0) return undefined;

    const natsHeaders = createNatsHeaders();
    for (const [key, value] of Object.entries(traceHeaders)) {
      natsHeaders.set(key, value);
    }

    return { headers: natsHeaders };
  }

  private buildSafePayloadMetadata(traceHeaders: Record<string, string>): Record<string, string> {
    const metadata: Record<string, string> = {};

    for (const [key, value] of Object.entries(traceHeaders)) {
      if (key === 'x-khal-user-id') {
        metadata['x-khal-user-hash'] = this.safeHash(value);
        continue;
      }
      if (key === 'x-omni-chat-id') {
        metadata['x-omni-chat-hash'] = this.safeHash(value);
        continue;
      }
      metadata[key] = value;
    }

    return metadata;
  }

  private safeHash(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
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
