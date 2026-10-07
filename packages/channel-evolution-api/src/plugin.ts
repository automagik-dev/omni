import {
  BaseChannelPlugin,
  type InstanceConfig,
  type OutgoingMessage,
  type SendResult,
  sanitizeMessage,
} from '@omni/channel-sdk';
import { EvolutionConfigSchema } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import { evolutionCapabilities } from './capabilities';
import { EvolutionClient, EvolutionError } from './client';
import { equalSecret, readBody } from './security';
import { type EvolutionEvent, normalizeEvolution } from './webhook';

export class EvolutionPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'evolution-api';
  readonly name = 'Evolution API';
  readonly version = '2.261006.2';
  readonly capabilities = evolutionCapabilities;
  private readonly connections = new Map<string, { client: EvolutionClient; config: InstanceConfig }>();
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const vendor = EvolutionConfigSchema.parse(config.options?.evolutionConfig ?? config.credentials.evolutionConfig);
    const client = new EvolutionClient(vendor);
    const state = await client.status();
    this.connections.set(instanceId, { client, config });
    await this.updateInstanceStatus(instanceId, config, {
      state: state === 'open' ? 'connected' : 'connecting',
      since: new Date(),
    });
    if (state === 'open') await this.emitInstanceConnected(instanceId);
    else {
      try {
        await this.getQrCode(instanceId);
      } catch (error) {
        // An asynchronous QR may arrive via webhook after connect returns.
        if (!(error instanceof EvolutionError && error.channelCode === 'EVOLUTION_PAIRING_REQUIRED')) {
          this.connections.delete(instanceId);
          throw error;
        }
      }
    }
  }
  /** Detach locally without logging out or deleting the remote Evolution session. */
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
    const c = this.connection(instanceId);
    const code = await c.client.qr();
    await this.updateInstanceStatus(instanceId, c.config, { state: 'qr', since: new Date() });
    await this.emitQrCode(instanceId, code, new Date(Date.now() + 45_000));
    return code;
  }
  private connection(instanceId: string) {
    const c = this.connections.get(instanceId);
    if (!c) throw new EvolutionError('EVOLUTION_NOT_CONFIGURED', 'Evolution instance not configured');
    return c;
  }
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    let accepted = false;
    try {
      const c = this.connection(instanceId);
      const correlationId =
        typeof message.metadata?.correlationId === 'string' ? message.metadata.correlationId : undefined;
      if (correlationId) this.captureT10(correlationId);
      const response = await c.client.send(message);
      accepted = true;
      if (correlationId) this.captureT11(correlationId);
      await this.emitMessageSent({
        instanceId,
        externalId: response.messageId,
        chatId: response.chatId,
        to: message.to,
        content: message.content,
        rawPayload: { evolutionAccepted: true },
        senderAgentId: message.metadata?.senderAgentId as string | undefined,
        systemNotice: message.metadata?.systemNotice as boolean | undefined,
      });
      return { success: true, messageId: response.messageId, timestamp: Date.now() };
    } catch (error) {
      const code = accepted
        ? 'EVOLUTION_DELIVERY_UNKNOWN'
        : error instanceof EvolutionError
          ? error.channelCode
          : 'EVOLUTION_INVALID_CONTENT';
      return {
        success: false,
        errorCode: code,
        error: code,
        retryable: !accepted && error instanceof EvolutionError && error.retryable,
        timestamp: Date.now(),
      };
    }
  }
  async handleWebhook(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const match = /^\/api\/v2\/channels\/evolution-api\/([^/]+)\/webhook$/.exec(new URL(request.url).pathname);
    const instanceId = match?.[1] ?? '';
    const c = this.connections.get(instanceId);
    if (!c) return new Response('Not found', { status: 404 });
    if (!equalSecret(request.headers.get('x-webhook-token'), c.client.config.webhookToken))
      return new Response('Unauthorized', { status: 401 });
    let body: Buffer;
    try {
      body = await readBody(request);
    } catch {
      return new Response('Invalid or oversized body', { status: 413 });
    }
    let events: EvolutionEvent[];
    try {
      events = normalizeEvolution(JSON.parse(body.toString('utf8')), c.client.config.instanceName, (index) => {
        this.logger.warn('Skipping invalid Evolution webhook batch item', { instanceId, index });
      });
    } catch {
      return new Response('Invalid payload or instance mismatch', { status: 400 });
    }
    try {
      for (const event of events) await this.ingest(instanceId, event);
    } catch {
      return new Response('Event persistence unavailable', { status: 503 });
    }
    return Response.json({ ok: true });
  }
  private async ingest(instanceId: string, event: EvolutionEvent): Promise<void> {
    const c = this.connection(instanceId);
    if (event.type === 'connection') {
      await this.updateInstanceStatus(instanceId, c.config, { state: event.state, since: new Date() });
      if (event.state === 'connected')
        await this.emitInstanceConnected(instanceId, {
          ownerIdentifier: event.owner,
          profileName: event.profileName,
          profilePicUrl: event.profilePicUrl,
        });
      if (event.state === 'disconnected') await this.emitInstanceDisconnected(instanceId, 'Evolution disconnected');
    } else if (event.type === 'qr') {
      await this.updateInstanceStatus(instanceId, c.config, { state: 'qr', since: new Date() });
      await this.emitQrCode(instanceId, event.code, new Date(Date.now() + 45_000));
    } else if (event.type === 'receipt') {
      const params = { instanceId, externalId: event.id, chatId: event.chatId };
      if (event.status === 'delivered') await this.emitMessageDelivered({ ...params, deliveredAt: event.timestamp });
      else if (event.status === 'read') await this.emitMessageRead({ ...params, readAt: event.timestamp });
      else await this.emitMessageFailed({ ...params, error: 'Evolution delivery failed', retryable: false });
    } else if (event.fromMe) {
      await this.emitMessageSent({
        instanceId,
        externalId: event.id,
        chatId: event.chatId,
        to: event.chatId,
        content: event.content,
        rawPayload: { ...event.raw, evolutionEcho: true },
      });
    } else {
      await this.ingestReceived(instanceId, event);
    }
  }
  private async ingestReceived(instanceId: string, event: Extract<EvolutionEvent, { type: 'message' }>): Promise<void> {
    if (event.content.text !== undefined) {
      const sanitized = sanitizeMessage(event.content.text, this.logger, { instanceId, messageId: event.id });
      if (!sanitized.ok) return;
      event.content.text = sanitized.text;
    }
    const timings = this.captureInboundTimings(event.timestamp);
    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId: event.id,
      chatId: event.chatId,
      from: event.from,
      senderName: event.senderName,
      content: event.content,
      replyToId: event.replyTo,
      rawPayload: event.raw,
      timings,
    });
    if (timings) this.captureT2(correlationId, timings);
  }
  async fetchHistory(): Promise<never> {
    throw new EvolutionError('EVOLUTION_UNSUPPORTED', 'Evolution history synchronization is not implemented');
  }
}
