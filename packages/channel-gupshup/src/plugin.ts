/**
 * Gupshup channel plugin
 *
 * Full implementation of GupshupPlugin extends BaseChannelPlugin.
 * Stateless REST API outbound + webhook-based inbound.
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
import { sendMedia } from './senders/media';
import { sendTemplate } from './senders/template';
import { sendText } from './senders/text';
import type { GupshupConfig } from './types';
import { GupshupError, GupshupErrorCode, isRetryable } from './utils/errors';
import { toGupshupPhone } from './utils/identity';

/** Dispatch outgoing content to the appropriate Gupshup sender */
async function dispatchContent(
  client: GupshupClient,
  dest: string,
  message: OutgoingMessage,
): Promise<{ messageId?: string }> {
  const { content } = message;
  const mediaTypes = new Set(['image', 'audio', 'video', 'document']);

  if (content.type === 'text') {
    return sendText(client, dest, content.text ?? '');
  }
  if (mediaTypes.has(content.type)) {
    return sendMedia(client, dest, content.mediaUrl ?? '', content.mimeType, content.caption ?? content.text);
  }
  if (content.type === 'location') {
    const loc = content.location;
    return client.sendLocation(dest, loc?.latitude ?? 0, loc?.longitude ?? 0, loc?.name, loc?.address);
  }
  if (content.type === 'contact') {
    const contact = content.contact;
    return client.sendContact(dest, {
      name: contact?.name ?? '',
      phone: toGupshupPhone(contact?.phone ?? ''),
    });
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
  readonly name = 'Gupshup WhatsApp BSP';
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

    const apiKey = (creds.gupshupApiKey ?? opts.gupshupApiKey) as string | undefined;
    const appName = (creds.gupshupAppName ?? opts.gupshupAppName) as string | undefined;
    const sourcePhone = (creds.gupshupSourcePhone ?? opts.gupshupSourcePhone) as string | undefined;
    const webhookVerifyToken = (creds.webhookVerifyToken ?? opts.webhookVerifyToken ?? '') as string;

    if (!apiKey) throw new GupshupError(GupshupErrorCode.AUTH_FAILED, 'gupshupApiKey is required');
    if (!appName) throw new GupshupError(GupshupErrorCode.BAD_REQUEST, 'gupshupAppName is required');
    if (!sourcePhone) throw new GupshupError(GupshupErrorCode.BAD_REQUEST, 'gupshupSourcePhone is required');

    this.logger.info('Connecting Gupshup instance', { instanceId, appName, sourcePhone });

    const client = new GupshupClient(apiKey, appName, toGupshupPhone(sourcePhone));

    // Validate credentials (lightweight balance check)
    const valid = await client.validateCredentials();
    if (!valid) {
      throw new GupshupError(GupshupErrorCode.AUTH_FAILED, 'Gupshup API key validation failed — check gupshupApiKey');
    }

    const gupshupConfig: GupshupConfig = {
      gupshupApiKey: apiKey,
      gupshupAppName: appName,
      gupshupSourcePhone: sourcePhone,
      webhookVerifyToken,
    };
    const dedupeCache = createInboundDedupeCache();

    this.gupshupInstances.set(instanceId, { client, config: gupshupConfig, dedupeCache });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: `Connected via Gupshup app ${appName}`,
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: appName,
      ownerIdentifier: sourcePhone,
    });

    this.logger.info('Gupshup instance connected', { instanceId, appName, sourcePhone });
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

      // Journey timing: T11 (platformDeliveredAt) after API responds
      if (correlationId) this.captureT11(correlationId);

      await this.emitMessageSent({
        instanceId,
        externalId: response.messageId ?? '',
        chatId: to,
        to,
        content: {
          type: content.type as import('@omni/core/types').ContentType,
          text: content.text,
          mediaUrl: content.mediaUrl,
        },
        replyToId: message.replyTo,
      });

      return { success: true, messageId: response.messageId, timestamp: Date.now() };
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

  // ─────────────────────────────────────────────────────────────
  // Template sending (public, for direct use)
  // ─────────────────────────────────────────────────────────────

  async sendTemplateMessage(
    instanceId: string,
    to: string,
    templateId: string,
    params: Record<string, string>,
  ): Promise<SendResult> {
    const state = this.gupshupInstances.get(instanceId);
    if (!state) {
      return { success: false, error: 'Gupshup instance not connected', retryable: false, timestamp: Date.now() };
    }
    try {
      const dest = toGupshupPhone(to);
      const response = await sendTemplate(state.client, dest, templateId, params);
      return { success: true, messageId: response.messageId, timestamp: Date.now() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        retryable: isRetryable(error),
        timestamp: Date.now(),
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported by Gupshup BSP)
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }
}
