/**
 * Twilio WhatsApp channel plugin.
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

import { TWILIO_WHATSAPP_CAPABILITIES } from './capabilities';
import { TwilioWhatsAppClient } from './client';
import { handleTwilioWhatsAppWebhook } from './handlers/webhooks';
import type { TwilioMessageResponse, TwilioWhatsAppConfig } from './types';
import { TwilioWhatsAppError, TwilioWhatsAppErrorCode, isRetryable } from './utils/errors';
import { normalizeTwilioWhatsAppAddress } from './utils/identity';

interface TwilioWhatsAppInstanceState {
  client: TwilioWhatsAppClient;
  config: TwilioWhatsAppConfig;
  dedupeCache: DedupeCache;
  lastInboundMessageByChat: Map<string, string>;
}

const LAST_INBOUND_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

function boolFromOption(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  return Boolean(value);
}

function optionString(creds: Record<string, unknown>, opts: Record<string, unknown>, key: string): string | undefined {
  const value = creds[key] ?? opts[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildConfig(config: InstanceConfig): TwilioWhatsAppConfig {
  const creds = config.credentials ?? {};
  const opts = config.options ?? {};

  const twilioAccountSid = optionString(creds, opts, 'twilioAccountSid');
  const twilioAuthToken = optionString(creds, opts, 'twilioAuthToken');
  const twilioFrom = optionString(creds, opts, 'twilioFrom');
  const twilioMessagingServiceSid = optionString(creds, opts, 'twilioMessagingServiceSid');

  if (!twilioAccountSid) {
    throw new TwilioWhatsAppError(TwilioWhatsAppErrorCode.AUTH_FAILED, 'twilioAccountSid is required');
  }
  if (!twilioAuthToken) {
    throw new TwilioWhatsAppError(TwilioWhatsAppErrorCode.AUTH_FAILED, 'twilioAuthToken is required');
  }
  if (!twilioFrom && !twilioMessagingServiceSid) {
    throw new TwilioWhatsAppError(
      TwilioWhatsAppErrorCode.AUTH_FAILED,
      'Either twilioFrom or twilioMessagingServiceSid is required',
    );
  }

  return {
    twilioAccountSid,
    twilioAuthToken,
    twilioFrom,
    twilioMessagingServiceSid,
    twilioStatusCallbackUrl: optionString(creds, opts, 'twilioStatusCallbackUrl'),
    twilioWebhookUrl: optionString(creds, opts, 'twilioWebhookUrl'),
    twilioValidateSignature: boolFromOption(creds.twilioValidateSignature ?? opts.twilioValidateSignature, true),
  };
}

function canAttachBodyWithMedia(contentType: string | undefined): boolean {
  return contentType === 'image' || contentType === undefined;
}

function lastInboundMessageStorageKey(instanceId: string, chatId: string): string {
  return `last-inbound-message:${instanceId}:${chatId}`;
}

async function dispatchContent(
  client: TwilioWhatsAppClient,
  config: TwilioWhatsAppConfig,
  message: OutgoingMessage,
): Promise<TwilioMessageResponse> {
  const { content } = message;
  const mediaTypes = new Set(['image', 'audio', 'video', 'document', 'sticker']);

  if (content.type === 'text') {
    return client.sendMessage({
      to: message.to,
      body: content.text ?? '',
      statusCallbackUrl: config.twilioStatusCallbackUrl,
    });
  }

  if (mediaTypes.has(content.type)) {
    if (!content.mediaUrl) {
      throw new TwilioWhatsAppError(TwilioWhatsAppErrorCode.BAD_REQUEST, 'mediaUrl is required for media messages');
    }
    const caption = content.caption ?? content.text;
    return client.sendMessage({
      to: message.to,
      body: caption && canAttachBodyWithMedia(content.type) ? caption : undefined,
      mediaUrl: content.mediaUrl,
      statusCallbackUrl: config.twilioStatusCallbackUrl,
    });
  }

  if (content.type === 'location' && content.location) {
    const { latitude, longitude, name, address } = content.location;
    const locationText = [name, address, `${latitude},${longitude}`].filter(Boolean).join('\n');
    return client.sendMessage({
      to: message.to,
      body: locationText,
      statusCallbackUrl: config.twilioStatusCallbackUrl,
    });
  }

  return client.sendMessage({
    to: message.to,
    body: content.text ?? '[Unsupported content]',
    statusCallbackUrl: config.twilioStatusCallbackUrl,
  });
}

export class TwilioWhatsAppPlugin extends BaseChannelPlugin {
  readonly id = 'twilio-whatsapp' as ChannelType;
  readonly name = 'Twilio WhatsApp';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = TWILIO_WHATSAPP_CAPABILITIES;

  private twilioInstances = new Map<string, TwilioWhatsAppInstanceState>();

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('Twilio WhatsApp plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.twilioInstances) {
      state.dedupeCache.dispose();
    }
    this.twilioInstances.clear();
    this.logger.info('Twilio WhatsApp plugin destroyed');
  }

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const twilioConfig = buildConfig(config);
    const client = new TwilioWhatsAppClient(twilioConfig);
    const dedupeCache = createInboundDedupeCache();

    this.twilioInstances.set(instanceId, {
      client,
      config: twilioConfig,
      dedupeCache,
      lastInboundMessageByChat: new Map(),
    });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Configured for Twilio WhatsApp',
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: 'Twilio WhatsApp',
      ownerIdentifier: twilioConfig.twilioFrom ?? twilioConfig.twilioMessagingServiceSid,
    });

    this.logger.info('Twilio WhatsApp instance connected', {
      instanceId,
      from: twilioConfig.twilioFrom,
      messagingServiceSid: twilioConfig.twilioMessagingServiceSid,
    });
  }

  async disconnect(instanceId: string): Promise<void> {
    const state = this.twilioInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.twilioInstances.delete(instanceId);
    }

    this.instances.setInstance(instanceId, {} as InstanceConfig, {
      state: 'disconnected',
      since: new Date(),
      message: 'Disconnected',
    });

    await this.emitInstanceDisconnected(instanceId, 'Manual disconnect');
  }

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.twilioInstances.get(instanceId);
    if (!state) {
      return {
        success: false,
        error: 'Twilio WhatsApp instance not connected',
        retryable: false,
        timestamp: Date.now(),
      };
    }

    const { content } = message;
    const chatId = normalizeTwilioWhatsAppAddress(message.to);
    const correlationId = message.metadata?.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const response = await dispatchContent(state.client, state.config, { ...message, to: chatId });
      const messageId = response.sid ?? crypto.randomUUID();
      if (correlationId) this.captureT11(correlationId);

      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId,
        to: chatId,
        content: {
          type: content.type as import('@omni/core/types').ContentType,
          text: content.text,
          mediaUrl: content.mediaUrl,
        },
        replyToId: message.replyTo,
        senderAgentId: message.metadata?.senderAgentId as string | undefined,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const retryable = isRetryable(error);
      await this.emitMessageFailed({ instanceId, chatId, error: errorMessage, retryable });
      return { success: false, error: errorMessage, retryable, timestamp: Date.now() };
    }
  }

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.indexOf('twilio-whatsapp') + 1] ?? '';

    const state = this.twilioInstances.get(instanceId);
    if (!state) {
      return new Response('Instance not found', { status: 404 });
    }

    return handleTwilioWhatsAppWebhook(request, this, instanceId, state.config, state.dedupeCache);
  }

  getLogger(): Logger {
    return this.logger;
  }

  private async rememberLastInboundMessage(instanceId: string, chatId: string, externalId: string): Promise<void> {
    const state = this.twilioInstances.get(instanceId);
    const normalizedChatId = normalizeTwilioWhatsAppAddress(chatId);
    state?.lastInboundMessageByChat.set(normalizedChatId, externalId);

    try {
      await this.storage.set(
        lastInboundMessageStorageKey(instanceId, normalizedChatId),
        externalId,
        LAST_INBOUND_MESSAGE_TTL_MS,
      );
    } catch (error) {
      this.logger.debug('Failed to persist Twilio WhatsApp last inbound message id', {
        instanceId,
        chatId: normalizedChatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async resolveLastInboundMessageId(instanceId: string, chatId: string): Promise<string | null> {
    const normalizedChatId = normalizeTwilioWhatsAppAddress(chatId);
    const state = this.twilioInstances.get(instanceId);
    const cached = state?.lastInboundMessageByChat.get(normalizedChatId);
    if (cached) return cached;

    try {
      const stored = await this.storage.get<string>(lastInboundMessageStorageKey(instanceId, normalizedChatId));
      if (stored && state) state.lastInboundMessageByChat.set(normalizedChatId, stored);
      return stored ?? null;
    } catch (error) {
      this.logger.debug('Failed to load Twilio WhatsApp last inbound message id', {
        instanceId,
        chatId: normalizedChatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    if (duration === 0) return;

    const state = this.twilioInstances.get(instanceId);
    if (!state) {
      throw new TwilioWhatsAppError(TwilioWhatsAppErrorCode.NOT_CONNECTED, 'Twilio WhatsApp instance not connected');
    }

    const normalizedChatId = normalizeTwilioWhatsAppAddress(chatId);
    const messageId = await this.resolveLastInboundMessageId(instanceId, normalizedChatId);
    if (!messageId) {
      this.logger.debug('Skipping Twilio WhatsApp typing indicator without inbound message id', {
        instanceId,
        chatId: normalizedChatId,
      });
      return;
    }

    await state.client.sendTypingIndicator(messageId);
  }

  async markAsRead(
    instanceId: string,
    chatId: string,
    messageIds: string[],
    messageData?: Array<{ externalId: string; rawPayload?: Record<string, unknown> | null }>,
    readReceiptMode?: 'on' | 'off' | 'exclude-self',
  ): Promise<void> {
    if (readReceiptMode === 'off') return;

    const state = this.twilioInstances.get(instanceId);
    if (!state) {
      throw new TwilioWhatsAppError(TwilioWhatsAppErrorCode.NOT_CONNECTED, 'Twilio WhatsApp instance not connected');
    }

    const normalizedChatId = normalizeTwilioWhatsAppAddress(chatId);
    const owner = state.config.twilioFrom ? normalizeTwilioWhatsAppAddress(state.config.twilioFrom) : undefined;
    if (readReceiptMode === 'exclude-self' && owner === normalizedChatId) return;

    const messageIdsToMark =
      messageIds.length === 1 && messageIds[0] === 'all'
        ? [await this.resolveLastInboundMessageId(instanceId, normalizedChatId)]
        : (messageData?.map((message) => message.externalId) ?? messageIds);

    const uniqueMessageIds = Array.from(
      new Set(messageIdsToMark.filter((messageId): messageId is string => Boolean(messageId))),
    );

    for (const messageId of uniqueMessageIds) {
      await state.client.sendTypingIndicator(messageId);
    }
  }

  async markChatAsRead(
    instanceId: string,
    chatId: string,
    readReceiptMode?: 'on' | 'off' | 'exclude-self',
  ): Promise<void> {
    await this.markAsRead(instanceId, chatId, ['all'], undefined, readReceiptMode);
  }

  async handleMessageReceived(params: {
    instanceId: string;
    externalId: string;
    chatId: string;
    from: string;
    content: {
      type: string;
      text?: string;
      mediaUrl?: string;
      mimeType?: string;
      caption?: string;
      filename?: string;
      location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
      };
    };
    rawPayload?: Record<string, unknown>;
    platformTimestamp?: number;
    replyTo?: string;
  }): Promise<void> {
    const timings = params.platformTimestamp ? this.captureInboundTimings(params.platformTimestamp) : undefined;
    await this.rememberLastInboundMessage(params.instanceId, params.chatId, params.externalId);

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
      replyToId: params.replyTo,
      timings,
    });

    if (timings) this.captureT2(correlationId, timings);
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

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }
}
