import {
  BaseChannelPlugin,
  type InstanceConfig,
  type OutgoingMessage,
  type SendResult,
  sanitizeMessage,
} from '@omni/channel-sdk';
import { type ZapiConfig, ZapiConfigSchema } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import { z } from 'zod';
import { zapiCapabilities } from './capabilities';
import { ZapiClient, ZapiError, canonicalChatId, recipient } from './client';
import { equalSecret, readBody, verifyOmniSignature } from './signature';
import { type NormalizedContent, type NormalizedEvent, normalizeOmni, normalizeWeb } from './webhook';

export class ZapiWebPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'zapi-web';
  readonly name: string = 'Z-API Web';
  readonly version = '2.261006.2';
  readonly capabilities = zapiCapabilities(false);
  protected readonly connections = new Map<
    string,
    { client: ZapiClient; config: InstanceConfig; vendor: ZapiConfig; ownerIdentifier?: string }
  >();
  protected expectedDriver(): 'web' | 'omni' {
    return 'web';
  }
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const vendor = ZapiConfigSchema.parse(config.options?.zapiConfig ?? config.credentials.zapiConfig);
    if (vendor.driver !== this.expectedDriver()) throw new Error('Z-API configuration driver mismatch');
    const client = new ZapiClient(vendor);
    const connected = await client.status();
    this.connections.set(instanceId, { client, config, vendor });
    await this.updateInstanceStatus(instanceId, config, {
      state: connected ? 'connected' : 'connecting',
      since: new Date(),
    });
    if (connected) {
      const profile = vendor.driver === 'web' ? await client.request('device').catch(() => null) : null;
      const parsed = z
        .object({ phone: z.string().optional(), name: z.string().optional(), imgUrl: z.string().optional() })
        .safeParse(profile);
      const connection = this.connections.get(instanceId);
      if (parsed.success && connection) connection.ownerIdentifier = parsed.data.phone;
      await this.emitInstanceConnected(
        instanceId,
        parsed.success
          ? {
              ownerIdentifier: parsed.data.phone,
              profileName: parsed.data.name,
              profilePicUrl: parsed.data.imgUrl,
            }
          : undefined,
      );
    } else if (vendor.driver === 'web') await this.getQrCode(instanceId);
  }
  /** Unload the local binding; never log out or delete the vendor session implicitly. */
  async disconnect(instanceId: string): Promise<void> {
    this.connections.delete(instanceId);
    await this.updateInstanceStatus(
      instanceId,
      { instanceId, credentials: {} },
      { state: 'disconnected', since: new Date() },
    );
    await this.emitInstanceDisconnected(instanceId, 'Local binding disconnected');
  }
  protected override async onDestroy(): Promise<void> {
    this.connections.clear();
  }
  async getQrCode(instanceId: string): Promise<string> {
    const connection = this.connections.get(instanceId);
    if (!connection || connection.vendor.driver !== 'web')
      throw new ZapiError('ZAPI_UNSUPPORTED', 'QR available only for configured Web instance');
    const data = await connection.client.request('qr-code/image');
    const parsed = z.object({ value: z.string().min(1) }).safeParse(data);
    if (!parsed.success)
      throw new ZapiError('ZAPI_PAIRING_REQUIRED', 'Vendor requires external pairing/passkey challenge');
    await this.updateInstanceStatus(instanceId, connection.config, { state: 'qr', since: new Date() });
    await this.emitQrCode(instanceId, parsed.data.value, new Date(Date.now() + 30_000));
    return parsed.data.value;
  }
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const connection = this.connections.get(instanceId);
    if (!connection)
      return { success: false, error: 'Z-API instance not configured', retryable: false, timestamp: Date.now() };
    const correlationId =
      typeof message.metadata?.correlationId === 'string' ? message.metadata.correlationId : undefined;
    let accepted = false;
    try {
      if (correlationId) this.captureT10(correlationId);
      const response = await connection.client.send(message);
      accepted = true;
      // T11 is the provider response checkpoint; recipient delivery uses a separate event.
      if (correlationId) this.captureT11(correlationId);
      await this.emitMessageSent({
        instanceId,
        externalId: response.messageId,
        chatId: canonicalChatId(recipient(message.to, connection.vendor.driver === 'omni')),
        to: message.to,
        content: message.content,
        replyToId: message.replyTo,
        rawPayload: { zapiAccepted: true, zaapId: response.zaapId },
        senderAgentId: message.metadata?.senderAgentId as string | undefined,
        systemNotice: message.metadata?.systemNotice as boolean | undefined,
      });
      return { success: true, messageId: response.messageId, timestamp: Date.now() };
    } catch (error) {
      // Publication failure after acceptance must not invite a duplicate vendor send.
      const code = accepted
        ? 'ZAPI_DELIVERY_UNKNOWN'
        : error instanceof ZapiError
          ? error.channelCode
          : 'ZAPI_INVALID_CONTENT';
      return {
        success: false,
        error: code,
        retryable: !accepted && error instanceof ZapiError && error.retryable,
        timestamp: Date.now(),
      };
    }
  }
  async markAsRead(
    instanceId: string,
    chatId: string,
    messageIds: string[],
    _messageData?: unknown[],
    readReceiptMode: 'on' | 'off' | 'exclude-self' = 'on',
  ): Promise<void> {
    if (readReceiptMode === 'off') return;
    const c = this.connections.get(instanceId);
    if (!c || c.vendor.driver !== 'web') throw new ZapiError('ZAPI_UNSUPPORTED', 'Read command supported only by Web');
    if (
      readReceiptMode === 'exclude-self' &&
      (!c.ownerIdentifier || recipient(chatId) === recipient(c.ownerIdentifier))
    )
      return;
    if (messageIds.includes('all')) throw new ZapiError('ZAPI_UNSUPPORTED', 'Explicit message IDs are required');
    for (const messageId of messageIds)
      await c.client.request('read-message', 'POST', { phone: recipient(chatId), messageId });
  }
  async handleWebhook(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);
    const segments = url.pathname.split('/');
    const instanceId = segments[segments.indexOf(this.id) + 1] ?? '';
    const connection = this.connections.get(instanceId);
    if (!connection) return new Response('Not found', { status: 404 });
    const c = connection.vendor;
    if (
      c.driver === 'web' &&
      !equalSecret(
        url.searchParams.get('token') ?? request.headers.get('authorization')?.replace(/^Bearer /, '') ?? null,
        c.webhookToken,
      )
    )
      return new Response('Unauthorized', { status: 401 });
    let body: Buffer;
    try {
      body = await readBody(request);
    } catch {
      return new Response('Invalid or oversized body', { status: 413 });
    }
    if (c.driver === 'omni' && !verifyOmniSignature(body, request.headers, c.signingSecret))
      return new Response('Unauthorized', { status: 401 });
    let events: NormalizedEvent[];
    try {
      const raw: unknown = JSON.parse(body.toString('utf8'));
      events = c.driver === 'web' ? normalizeWeb(raw, c.instanceId) : normalizeOmni(raw, c.channelId);
    } catch {
      return new Response('Invalid payload or connection mismatch', { status: 400 });
    }
    try {
      for (const event of events) await this.ingest(instanceId, event);
    } catch {
      return new Response('Event persistence unavailable', { status: 503 });
    }
    return Response.json({ ok: true });
  }
  private async ingest(instanceId: string, e: NormalizedEvent): Promise<void> {
    if (e.type === 'connected' || e.type === 'disconnected') {
      const connection = this.connections.get(instanceId);
      if (!connection) return;
      await this.updateInstanceStatus(instanceId, connection.config, { state: e.type, since: new Date() });
      if (e.type === 'connected') await this.emitInstanceConnected(instanceId, { ownerIdentifier: e.owner });
      else await this.emitInstanceDisconnected(instanceId, 'Vendor disconnected');
    } else if (e.type === 'reaction') {
      await this.ingestReaction(instanceId, e);
    } else if (e.type === 'received') {
      await this.ingestReceived(instanceId, e);
    } else if (e.type === 'sent') {
      await this.emitMessageSent({
        instanceId,
        externalId: e.id,
        chatId: e.chatId,
        to: e.chatId,
        content: e.content,
        rawPayload: { ...e.raw, zapiEcho: true },
      });
    } else if (e.type === 'delivered')
      await this.emitMessageDelivered({ instanceId, externalId: e.id, chatId: e.chatId, deliveredAt: e.timestamp });
    else if (e.type === 'read')
      await this.emitMessageRead({ instanceId, externalId: e.id, chatId: e.chatId, readAt: e.timestamp });
    else if (e.type === 'failed')
      await this.emitMessageFailed({
        instanceId,
        externalId: e.id,
        chatId: e.chatId,
        error: 'Z-API delivery failed',
        retryable: false,
      });
  }
  private async ingestReaction(instanceId: string, e: Extract<NormalizedEvent, { type: 'reaction' }>): Promise<void> {
    const params = {
      instanceId,
      messageId: e.targetId,
      chatId: e.chatId,
      from: e.from,
      emoji: e.emoji,
      rawPayload: { ...e.raw, externalId: e.id },
    };
    if (e.emoji) await this.emitReactionReceived(params);
    else await this.emitReactionRemoved(params);
  }
  private async ingestReceived(
    instanceId: string,
    e: Extract<NormalizedEvent, { content: NormalizedContent }>,
  ): Promise<void> {
    if (e.content.text !== undefined) {
      const sanitized = sanitizeMessage(e.content.text, this.logger, { instanceId, messageId: e.id });
      if (!sanitized.ok) return;
      e.content.text = sanitized.text;
    }
    const timings = this.captureInboundTimings(e.timestamp);
    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId: e.id,
      chatId: e.chatId,
      from: e.from,
      senderName: e.senderName,
      content: e.content,
      replyToId: e.replyTo,
      rawPayload: e.raw,
      timings,
    });
    if (timings) this.captureT2(correlationId, timings);
  }
  async fetchHistory(): Promise<never> {
    throw new ZapiError('ZAPI_UNSUPPORTED', 'Z-API history synchronization is not implemented');
  }
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const result = await this.sendMessage(instanceId, {
      to: chatId,
      content: { type: 'reaction', targetMessageId: messageId, emoji },
    });
    if (!result.success) throw new ZapiError(result.error ?? 'ZAPI_SEND_FAILED', 'Reaction failed', result.retryable);
  }
  async unreact(instanceId: string, chatId: string, messageId: string, _emoji: string): Promise<void> {
    const connection = this.connections.get(instanceId);
    if (!connection || connection.vendor.driver !== 'web')
      throw new ZapiError('ZAPI_UNSUPPORTED', 'Only Web supports removing reactions');
    await connection.client.request('send-remove-reaction', 'POST', { phone: recipient(chatId), messageId });
  }
}
