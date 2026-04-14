/**
 * Gupshup channel plugin
 *
 * Full implementation of GupshupPlugin extends BaseChannelPlugin.
 * Stateless REST API outbound (Custom Integration) + Meta/WA Business API inbound.
 */

import { BaseChannelPlugin, createInboundDedupeCache } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  FetchHistoryOptions,
  FetchHistoryResult,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import type { Logger } from '@omni/core';
import type { ChannelType } from '@omni/core/types';

import { GUPSHUP_CAPABILITIES } from './capabilities';
import { GupshupClient } from './client';
import { handleGupshupWebhook } from './handlers/webhooks';
import { sendLocation } from './senders/location';
import { sendMedia } from './senders/media';
import { sendText } from './senders/text';
import type { GupshupConfig, GupshupSendResponse } from './types';
import { GupshupError, GupshupErrorCode, isRetryable } from './utils/errors';
import { toGupshupPhone } from './utils/identity';

/** Dispatch outgoing content to the appropriate Gupshup sender */
async function dispatchContent(
  client: GupshupClient,
  dest: string,
  message: OutgoingMessage,
): Promise<GupshupSendResponse> {
  const { content } = message;
  const mediaTypes = new Set(['image', 'audio', 'video', 'document', 'sticker']);

  if (content.type === 'text') {
    return sendText(client, dest, content.text ?? '');
  }
  if (mediaTypes.has(content.type)) {
    return sendMedia(client, dest, content.mediaUrl ?? '', content.mimeType, content.caption ?? content.text);
  }
  if (content.type === 'location') {
    const loc = content.location;
    return sendLocation(client, dest, loc?.latitude ?? 0, loc?.longitude ?? 0, loc?.name, loc?.address);
  }
  // Fallback: send as text
  return sendText(client, dest, content.text ?? '[Unsupported content]');
}

interface GupshupInstanceState {
  client: GupshupClient;
  config: GupshupConfig;
  dedupeCache: DedupeCache;
}

export class GupshupPlugin extends BaseChannelPlugin {
  readonly id = 'gupshup' as ChannelType;
  readonly name = 'Gupshup WhatsApp';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = GUPSHUP_CAPABILITIES;

  private gupshupInstances = new Map<string, GupshupInstanceState>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('Gupshup plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.gupshupInstances) {
      state.dedupeCache.dispose();
    }
    this.gupshupInstances.clear();
    this.logger.info('Gupshup plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const creds = config.credentials ?? {};
    const opts = config.options ?? {};

    const callbackUrl = (creds.gupshupCallbackUrl ?? opts.gupshupCallbackUrl) as string | undefined;
    const authToken = (creds.gupshupAuthToken ?? opts.gupshupAuthToken) as string | undefined;
    const eventId = ((creds.gupshupEventId ?? opts.gupshupEventId) as string | undefined) ?? 'nx_omni_agent_reply';
    const webhookVerifyToken = (creds.webhookVerifyToken ?? opts.webhookVerifyToken) as string | undefined;

    if (!callbackUrl) throw new GupshupError(GupshupErrorCode.AUTH_FAILED, 'gupshupCallbackUrl is required');
    if (!authToken) throw new GupshupError(GupshupErrorCode.AUTH_FAILED, 'gupshupAuthToken is required');

    this.logger.info('Connecting Gupshup instance', { instanceId, callbackUrl });

    const client = new GupshupClient(callbackUrl, authToken, eventId);

    // Validate credentials
    const valid = await client.validateCredentials();
    if (!valid) {
      throw new GupshupError(
        GupshupErrorCode.AUTH_FAILED,
        'Gupshup auth token validation failed — check gupshupAuthToken',
      );
    }

    const gupshupConfig: GupshupConfig = {
      gupshupCallbackUrl: callbackUrl,
      gupshupAuthToken: authToken,
      gupshupEventId: eventId,
      webhookVerifyToken,
    };
    const dedupeCache = createInboundDedupeCache();

    this.gupshupInstances.set(instanceId, { client, config: gupshupConfig, dedupeCache });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Connected via Gupshup Custom Integration',
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: 'Gupshup',
      ownerIdentifier: callbackUrl,
    });

    this.logger.info('Gupshup instance connected', { instanceId, callbackUrl });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting Gupshup instance', { instanceId });

    const state = this.gupshupInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.gupshupInstances.delete(instanceId);
    }

    this.instances.setInstance(instanceId, {} as InstanceConfig, {
      state: 'disconnected',
      since: new Date(),
      message: 'Disconnected',
    });

    await this.emitInstanceDisconnected(instanceId, 'Manual disconnect');
  }

  // ─────────────────────────────────────────────────────────────
  // Outbound
  // ─────────────────────────────────────────────────────────────

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.gupshupInstances.get(instanceId);
    if (!state) {
      return { success: false, error: 'Gupshup instance not connected', retryable: false, timestamp: Date.now() };
    }

    const { client } = state;
    const { content, to } = message;
    const dest = toGupshupPhone(to);

    // Journey timing: T10 (pluginSentAt) before API call
    const correlationId = message.metadata?.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const response = await dispatchContent(client, dest, message);
      const messageId = typeof response.messageId === 'string' ? response.messageId : undefined;

      // Journey timing: T11 (platformDeliveredAt) after API responds
      if (correlationId) this.captureT11(correlationId);

      await this.emitMessageSent({
        instanceId,
        externalId: messageId ?? '',
        chatId: to,
        to,
        content: {
          type: content.type as import('@omni/core/types').ContentType,
          text: content.text,
          mediaUrl: content.mediaUrl,
        },
        replyToId: message.replyTo,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const retryable = isRetryable(error);

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      return { success: false, error: errorMessage, retryable, timestamp: Date.now() };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook
  // ─────────────────────────────────────────────────────────────

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract instanceId from path: /api/v2/channels/gupshup/{instanceId}/webhook
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.indexOf('gupshup') + 1] ?? '';

    const state = this.gupshupInstances.get(instanceId);
    if (!state) {
      return new Response('Instance not found', { status: 404 });
    }

    return handleGupshupWebhook(request, this, instanceId, state.config.webhookVerifyToken, state.dedupeCache);
  }

  // ─────────────────────────────────────────────────────────────
  // Internal helpers (used by webhook handler)
  // ─────────────────────────────────────────────────────────────

  getLogger(): Logger {
    return this.logger;
  }

  async handleMessageReceived(params: {
    instanceId: string;
    externalId: string;
    chatId: string;
    from: string;
    content: { type: string; text?: string; mediaUrl?: string; mimeType?: string; caption?: string; filename?: string };
    rawPayload?: Record<string, unknown>;
    platformTimestamp?: number;
  }): Promise<void> {
    const timings = params.platformTimestamp ? this.captureInboundTimings(params.platformTimestamp) : undefined;

    const correlationId = await this.emitMessageReceived({
      instanceId: params.instanceId,
      externalId: params.externalId,
      chatId: params.chatId,
      from: params.from,
      content: {
        type: params.content.type as import('@omni/core/types').ContentType,
        text: params.content.text,
        mediaUrl: params.content.mediaUrl,
        mimeType: params.content.mimeType,
      },
      rawPayload: params.rawPayload,
      timings,
    });

    if (timings) {
      this.captureT2(correlationId, timings);
    }
  }

  async handleMessageDelivered(params: { instanceId: string; externalId: string; to: string }): Promise<void> {
    await this.emitMessageDelivered({
      instanceId: params.instanceId,
      externalId: params.externalId,
      chatId: params.to,
      deliveredAt: Date.now(),
    });
  }

  async handleMessageRead(params: { instanceId: string; externalId: string; to: string }): Promise<void> {
    await this.emitMessageRead({
      instanceId: params.instanceId,
      externalId: params.externalId,
      chatId: params.to,
      readAt: Date.now(),
    });
  }

  async handleMessageFailed(params: {
    instanceId: string;
    externalId: string;
    to: string;
    reason?: string;
  }): Promise<void> {
    await this.emitMessageFailed({
      instanceId: params.instanceId,
      externalId: params.externalId,
      chatId: params.to,
      error: params.reason ?? 'Delivery failed',
      retryable: false,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported)
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }
}
