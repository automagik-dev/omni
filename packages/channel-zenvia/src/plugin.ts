import { BaseChannelPlugin, createDownloadGuard, createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  FetchHistoryOptions,
  FetchHistoryResult,
  HealthCheck,
  HealthStatus,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import { markdownToWhatsApp } from '@omni/core';
import type { Logger } from '@omni/core';
import type { ChannelType, ContentType } from '@omni/core/types';

import { ZENVIA_CAPABILITIES } from './capabilities';
import { ZenviaClient } from './client';
import { handleZenviaWebhookRequest } from './handlers/webhook';
import { ZenviaSalesClient } from './sales-client';
import {
  ZENVIA_HANDOFF_SOLUTIONS,
  type ZenviaConfig,
  type ZenviaHandoffSolution,
  type ZenviaInboundContent,
  type ZenviaInboundMessage,
  type ZenviaMessageStatusEvent,
  type ZenviaOutboundContent,
  type ZenviaOutboundMessage,
  type ZenviaReferral,
  type ZenviaSendResponse,
} from './types';
import { ZenviaApiError, ZenviaErrorCode } from './utils/errors';
import {
  HANDOFF_NOT_CONFIGURED_ERROR,
  buildHandoffNote,
  buildHandoffRouting,
  resolveHandoffMode,
} from './utils/handoff';
import { toZenviaPhone } from './utils/identity';

const ZENVIA_MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'document']);

const downloadGuard = createDownloadGuard();

interface ZenviaInstanceState {
  client: ZenviaClient;
  salesClient?: ZenviaSalesClient;
  config: ZenviaConfig;
  dedupeCache: DedupeCache;
}

type TransferOutcome = { ok: true } | { ok: false; error: string; errorCode?: string; retryable: boolean };

export class ZenviaPlugin extends BaseChannelPlugin {
  readonly id = 'zenvia' as ChannelType;
  readonly name = 'Zenvia WhatsApp';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = ZENVIA_CAPABILITIES;

  private zenviaInstances = new Map<string, ZenviaInstanceState>();

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('Zenvia plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.zenviaInstances) {
      state.dedupeCache.dispose();
    }
    this.zenviaInstances.clear();
    this.logger.info('Zenvia plugin destroyed');
  }

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    this.dropInstanceState(instanceId);
    const zenviaConfig = readZenviaConfig(config);

    this.logger.info('Connecting Zenvia instance', { instanceId, senderId: zenviaConfig.senderId });

    const client = new ZenviaClient({ apiToken: zenviaConfig.apiToken });

    const reachable = await client.ping();
    if (!reachable) {
      throw new ZenviaApiError(
        ZenviaErrorCode.AUTH_FAILED,
        'Zenvia API rejected the token or is unreachable — check zenviaApiToken',
        { operation: 'connect' },
      );
    }

    let salesClient: ZenviaSalesClient | undefined;
    if (zenviaConfig.salesApiKey && zenviaConfig.handoffGroupId) {
      salesClient = new ZenviaSalesClient({ apiKey: zenviaConfig.salesApiKey });
      await this.verifySalesAccess(instanceId, salesClient, zenviaConfig.handoffGroupId);
    } else if (zenviaConfig.salesApiKey || zenviaConfig.handoffGroupId || zenviaConfig.handoffUserId) {
      this.logger.warn('Zenvia Sales transfer needs both zenviaSalesApiKey and zenviaHandoffGroupId; it stays off', {
        instanceId,
      });
    }

    this.zenviaInstances.get(instanceId)?.dedupeCache.dispose();
    this.zenviaInstances.set(instanceId, {
      client,
      salesClient,
      config: zenviaConfig,
      dedupeCache: createInboundDedupeCache(),
    });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Connected via Zenvia API',
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: 'Zenvia WhatsApp',
      ownerIdentifier: zenviaConfig.senderId,
    });

    this.logger.info('Zenvia instance connected', { instanceId, senderId: zenviaConfig.senderId });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting Zenvia instance', { instanceId });

    this.dropInstanceState(instanceId);

    this.instances.setInstance(instanceId, {} as InstanceConfig, {
      state: 'disconnected',
      since: new Date(),
      message: 'Disconnected',
    });

    await this.emitInstanceDisconnected(instanceId, 'Manual disconnect');
  }

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.zenviaInstances.get(instanceId);
    if (!state) {
      return { success: false, error: 'Zenvia instance not connected', retryable: false, timestamp: Date.now() };
    }

    const { content, to, replyTo, metadata } = message;

    const built = buildOutbound(state.config, message);
    if (!built.ok) {
      return { success: false, error: built.error, retryable: false, timestamp: Date.now() };
    }

    const correlationId = metadata?.correlationId as string | undefined;

    let transferred = false;
    if (metadata?.isHandoff === true && state.salesClient && resolveHandoffMode(state.config) === 'transfer') {
      const outcome = await this.transferToHuman(instanceId, state, to, metadata);
      if (!outcome.ok) {
        return {
          success: false,
          error: outcome.error,
          errorCode: outcome.errorCode,
          retryable: outcome.retryable,
          timestamp: Date.now(),
        };
      }
      transferred = true;
    }

    if (correlationId) this.captureT10(correlationId);

    try {
      const response: ZenviaSendResponse = await state.client.sendMessage(built.payload);

      if (correlationId) this.captureT11(correlationId);

      const messageId = response.id;
      if (!messageId) {
        const err = 'Zenvia did not return a message id on successful send (malformed response)';
        await this.emitMessageFailed({ instanceId, chatId: to, error: err, retryable: false });
        if (transferred) return { success: true, timestamp: Date.now() };
        return { success: false, error: err, retryable: false, timestamp: Date.now() };
      }

      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId: to,
        to,
        content: { type: content.type, text: content.text, mediaUrl: content.mediaUrl },
        replyToId: replyTo,
        senderAgentId: metadata?.senderAgentId as string | undefined,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (err) {
      const isZenvia = err instanceof ZenviaApiError;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const retryable = isZenvia ? err.retryable : false;

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      if (transferred) {
        this.logger.warn('Zenvia handoff transferred but the farewell message failed', {
          instanceId,
          error: errorMessage,
        });
        return { success: true, timestamp: Date.now() };
      }

      return {
        success: false,
        error: errorMessage,
        errorCode: isZenvia ? err.channelCode : undefined,
        retryable,
        timestamp: Date.now(),
      };
    }
  }

  private async transferToHuman(
    instanceId: string,
    state: ZenviaInstanceState,
    to: string,
    metadata: Record<string, unknown>,
  ): Promise<TransferOutcome> {
    const sales = state.salesClient;
    const groupId = state.config.handoffGroupId;
    if (!sales || !groupId) return { ok: false, error: HANDOFF_NOT_CONFIGURED_ERROR, retryable: false };

    try {
      const prospect = await sales.findProspectByPhone(to);
      if (!prospect) {
        return {
          ok: false,
          error:
            'Zenvia handoff failed: no Sales prospect exists for this contact, so there is no conversation to transfer',
          retryable: false,
        };
      }

      const userId = state.config.handoffUserId;
      await sales.transferProspect(prospect.id, userId ? { group: groupId, user: userId } : { group: groupId });

      const note = buildHandoffNote(metadata);
      if (note) {
        try {
          await sales.createNote(prospect.id, note);
        } catch (err) {
          this.logger.warn('Zenvia handoff note failed after the transfer', {
            instanceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { ok: true };
    } catch (err) {
      const isZenvia = err instanceof ZenviaApiError;
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: isZenvia ? err.channelCode : undefined,
        retryable: isZenvia ? err.retryable : false,
      };
    }
  }

  private async verifySalesAccess(instanceId: string, sales: ZenviaSalesClient, groupId: string): Promise<void> {
    try {
      const groups = await sales.listGroups();
      if (!groups.some((group) => group.id === groupId)) {
        this.logger.warn('Zenvia handoff group not among the groups listed for the Sales key; transfers may fail', {
          instanceId,
        });
      }
    } catch (err) {
      this.logger.warn('Zenvia Sales API check failed on connect; handoff transfer is unverified', {
        instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private dropInstanceState(instanceId: string): void {
    const previous = this.zenviaInstances.get(instanceId);
    if (!previous) return;
    previous.dedupeCache.dispose();
    this.zenviaInstances.delete(instanceId);
  }

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.indexOf('zenvia') + 1] ?? '';

    const state = this.zenviaInstances.get(instanceId);
    if (!state) {
      return new Response('Instance not connected', { status: 503 });
    }

    return handleZenviaWebhookRequest(request, this, instanceId, state.config.webhookVerifyToken);
  }

  async downloadInboundMedia(instanceId: string, fileUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const state = this.requireInstanceState(instanceId, 'downloadInboundMedia');

    const res = await state.client.downloadFile(fileUrl);
    downloadGuard.checkResponse(res, this.logger, { instanceId, channel: 'zenvia' });
    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch {
      throw new ZenviaApiError(ZenviaErrorCode.UPSTREAM_ERROR, 'Zenvia downloadFile body read failed or timed out', {
        operation: 'downloadFile',
      });
    }
    downloadGuard.checkSize(bytes.byteLength, this.logger, { instanceId, channel: 'zenvia' });

    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
    return { buffer: Buffer.from(bytes), mimeType };
  }

  private requireInstanceState(instanceId: string, operation: string): ZenviaInstanceState {
    const state = this.zenviaInstances.get(instanceId);
    if (!state) {
      throw new ZenviaApiError(ZenviaErrorCode.NOT_CONNECTED, 'Zenvia instance not connected', { operation });
    }
    return state;
  }

  override async getHealth(instanceId?: string): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];
    const single = instanceId ? this.zenviaInstances.get(instanceId) : undefined;
    const states: Array<readonly [string, ZenviaInstanceState]> = instanceId
      ? single
        ? [[instanceId, single] as const]
        : []
      : Array.from(this.zenviaInstances.entries());

    for (const [id, state] of states) {
      const ok = await state.client.ping();
      checks.push({
        name: `zenvia:${id}`,
        status: ok ? 'pass' : 'fail',
        message: ok
          ? `Sender ${state.config.senderId} reachable`
          : `Sender ${state.config.senderId} unreachable — token rejected or network error`,
      });
    }

    return {
      status: checks.length === 0 || checks.every((c) => c.status === 'pass') ? 'healthy' : 'unhealthy',
      checks,
      checkedAt: new Date(),
    };
  }

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }

  getInstanceState(instanceId: string): ZenviaInstanceState | undefined {
    return this.zenviaInstances.get(instanceId);
  }

  getLogger(): Logger {
    return this.logger;
  }

  async handleInboundMessage(instanceId: string, msg: ZenviaInboundMessage): Promise<boolean> {
    const state = this.zenviaInstances.get(instanceId);
    if (!state) {
      this.logger.warn('[zenvia] webhook for unknown/disconnected instance — dropping', { instanceId });
      return false;
    }

    const addressedTo = msg.to ? toZenviaPhone(msg.to) || msg.to : undefined;
    if (addressedTo && addressedTo !== state.config.senderId) {
      this.logger.debug('[zenvia] inbound message addressed to another sender dropped', {
        instanceId,
        messageId: msg.id,
      });
      return false;
    }

    if (state.dedupeCache.isDuplicate(instanceId, msg.id, 'zenvia', this.logger)) {
      this.logger.debug('[zenvia] duplicate inbound dropped', { instanceId, messageId: msg.id });
      return false;
    }

    if (msg.contents.length > 1) {
      this.logger.warn('[zenvia] inbound message has several contents — only the first is used', {
        instanceId,
        messageId: msg.id,
        contents: msg.contents.length,
      });
    }

    const first = msg.contents[0];
    const content = first ? extractInboundContent(first) : null;
    if (!content) {
      this.logger.warn('[zenvia] inbound message has no extractable content', {
        instanceId,
        messageId: msg.id,
        type: first?.type,
      });
      return false;
    }

    if (!this.sanitizeInboundContent(instanceId, msg.id, content)) return false;

    const from = toZenviaPhone(msg.from);
    const senderName = msg.visitor?.name ?? msg.visitor?.firstName;
    const parsedTs = msg.timestamp ? Date.parse(msg.timestamp) : Number.NaN;
    const platformTimestampMs = Number.isFinite(parsedTs) ? parsedTs : Date.now();

    const timings = this.captureInboundTimings(platformTimestampMs);

    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId: msg.id,
      chatId: from,
      from,
      senderName,
      content: {
        type: content.type,
        text: content.text ?? content.caption,
        mediaId: content.mediaId,
        mimeType: content.mimeType,
      },
      replyToId: msg.idRef,
      rawPayload: buildRawPayload(msg, content, senderName, platformTimestampMs),
      timings,
    });
    if (timings) this.captureT2(correlationId, timings);
    return true;
  }

  private sanitizeInboundContent(instanceId: string, messageId: string, content: ExtractedInboundContent): boolean {
    for (const field of ['text', 'caption'] as const) {
      const value = content[field];
      if (!value) continue;
      const sanitized = sanitizeMessage(value, this.logger, { instanceId, messageId });
      if (!sanitized.ok) {
        this.logger.warn('[zenvia] inbound text rejected by sanitizer', {
          instanceId,
          messageId,
          field,
          rejected: sanitized.rejected,
        });
        return false;
      }
      content[field] = sanitized.text;
    }
    return true;
  }

  async handleStatusUpdate(instanceId: string, event: ZenviaMessageStatusEvent): Promise<void> {
    const externalId = event.message?.id ?? event.messageId;
    if (!externalId) return;

    const status = event.messageStatus;
    const parsedTs = status.timestamp ? Date.parse(status.timestamp) : Number.NaN;
    const timestampMs = Number.isFinite(parsedTs) ? parsedTs : Date.now();
    const chatId = toZenviaPhone(event.message?.to ?? '');

    switch (status.code) {
      case 'DELIVERED':
        await this.emitMessageDelivered({ instanceId, externalId, chatId, deliveredAt: timestampMs });
        return;

      case 'READ':
        await this.emitMessageRead({ instanceId, externalId, chatId, readAt: timestampMs });
        return;

      case 'REJECTED':
      case 'NOT_DELIVERED': {
        const cause = status.causes?.[0];
        await this.emitMessageFailed({
          instanceId,
          externalId,
          chatId,
          error: cause?.details ?? cause?.reason ?? status.description ?? `Zenvia status ${status.code}`,
          errorCode: cause?.channelErrorCode,
          retryable: false,
        });
        return;
      }

      default:
        return;
    }
  }
}

type OutboundBuildResult = { ok: true; payload: ZenviaOutboundMessage } | { ok: false; error: string };

function buildOutbound(config: ZenviaConfig, message: OutgoingMessage): OutboundBuildResult {
  const contentResult = buildOutboundContent(message);
  if (!contentResult.ok) return contentResult;

  const payload: ZenviaOutboundMessage = {
    from: config.senderId,
    to: toZenviaPhone(message.to),
    contents: [contentResult.content],
  };
  if (message.replyTo) payload.idRef = message.replyTo;

  const meta = message.metadata ?? {};
  if (meta.isHandoff === true) {
    const mode = resolveHandoffMode(config);
    if (!mode) return { ok: false, error: HANDOFF_NOT_CONFIGURED_ERROR };
    if (mode === 'routing' && config.handoffSolution) {
      payload.conversation = buildHandoffRouting(config.handoffSolution, meta);
    }
  }

  return { ok: true, payload };
}

type ContentBuildResult = { ok: true; content: ZenviaOutboundContent } | { ok: false; error: string };

function buildOutboundContent(message: OutgoingMessage): ContentBuildResult {
  const { content } = message;

  if (content.type === 'text') {
    const text = resolveOutboundText(message);
    if (!text) return { ok: false, error: 'Refusing to send an empty text message' };
    return { ok: true, content: { type: 'text', text } };
  }
  if (ZENVIA_MEDIA_TYPES.has(content.type)) {
    return buildMediaContent(message);
  }
  if (content.type === 'location' && content.location) {
    const { latitude, longitude, name, address } = content.location;
    return {
      ok: true,
      content: { type: 'location', latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) },
    };
  }
  if (content.type === 'template') {
    return buildTemplateContent(message);
  }
  return { ok: false, error: `Unsupported content.type=${content.type} for zenvia` };
}

function resolveOutboundText(message: OutgoingMessage): string {
  const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
  const text = message.content.text ?? '';
  return formatMode === 'passthrough' ? text : markdownToWhatsApp(text);
}

function buildMediaContent(message: OutgoingMessage): ContentBuildResult {
  const { content } = message;
  if (!content.mediaUrl) {
    return { ok: false, error: `Media send requires content.mediaUrl (type=${content.type})` };
  }

  const file: Extract<ZenviaOutboundContent, { type: 'file' }> = { type: 'file', fileUrl: content.mediaUrl };
  if (content.mimeType) file.fileMimeType = content.mimeType;

  const caption = content.caption ?? content.text;
  if (caption && (content.type === 'image' || content.type === 'video')) file.fileCaption = caption;
  if (content.filename && content.type === 'document') file.fileName = content.filename;

  return { ok: true, content: file };
}

function buildTemplateContent(message: OutgoingMessage): ContentBuildResult {
  const tpl = (message.metadata?.template ?? {}) as {
    id?: string;
    name?: string;
    fields?: Record<string, string | number | boolean>;
    bodyParameters?: string[];
  };
  const templateId = tpl.id ?? tpl.name;
  if (!templateId) {
    return { ok: false, error: 'template send requires metadata.template.id (the Zenvia template id)' };
  }
  if (!tpl.fields && tpl.bodyParameters?.length) {
    return {
      ok: false,
      error: 'Zenvia templates take named fields — pass metadata.template.fields instead of bodyParameters',
    };
  }
  return { ok: true, content: { type: 'template', templateId, ...(tpl.fields ? { fields: tpl.fields } : {}) } };
}

function readZenviaConfig(config: InstanceConfig): ZenviaConfig {
  const creds = (config.credentials ?? {}) as Record<string, unknown>;
  const opts = (config.options ?? {}) as Record<string, unknown>;
  const pick = (key: string): string | undefined => {
    const value = creds[key] ?? opts[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };

  const apiToken = pick('zenviaApiToken');
  const senderId = pick('zenviaSenderId');
  const handoffSolution = pick('zenviaHandoffSolution');
  const webhookVerifyToken = pick('webhookVerifyToken');
  const salesApiKey = pick('zenviaSalesApiKey');
  const handoffGroupId = pick('zenviaHandoffGroupId');
  const handoffUserId = pick('zenviaHandoffUserId');

  if (!apiToken) {
    throw new ZenviaApiError(ZenviaErrorCode.AUTH_FAILED, 'zenviaApiToken is required to connect a zenvia instance');
  }
  if (!senderId) {
    throw new ZenviaApiError(
      ZenviaErrorCode.INVALID_REQUEST,
      'zenviaSenderId (the sender registered at Zenvia) is required to connect a zenvia instance',
    );
  }
  if (handoffSolution && !isHandoffSolution(handoffSolution)) {
    throw new ZenviaApiError(
      ZenviaErrorCode.INVALID_REQUEST,
      `zenviaHandoffSolution must be one of ${ZENVIA_HANDOFF_SOLUTIONS.join(', ')}`,
    );
  }

  if (!webhookVerifyToken) {
    throw new ZenviaApiError(
      ZenviaErrorCode.INVALID_REQUEST,
      'webhookVerifyToken is required for a zenvia instance: Zenvia signs nothing, so the subscription must send it as x-webhook-token',
    );
  }

  return {
    apiToken,
    senderId: toZenviaPhone(senderId) || senderId,
    handoffSolution: handoffSolution as ZenviaHandoffSolution | undefined,
    webhookVerifyToken,
    salesApiKey,
    handoffGroupId,
    handoffUserId,
  };
}

function isHandoffSolution(value: string): value is ZenviaHandoffSolution {
  return (ZENVIA_HANDOFF_SOLUTIONS as readonly string[]).includes(value);
}

interface ExtractedInboundContent {
  type: ContentType;
  text?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}

function extractInboundContent(content: ZenviaInboundContent): ExtractedInboundContent | null {
  switch (content.type) {
    case 'text':
      return typeof content.text === 'string' ? { type: 'text', text: content.text } : null;
    case 'file':
      return extractFileContent(content);
    case 'location':
      return extractLocationContent(content);
    case 'contacts':
      return extractContactsContent(content);
    default:
      return null;
  }
}

function omniTypeForMime(mimeType: string | undefined): ContentType {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('video/')) return 'video';
  return 'document';
}

function extractFileContent(content: ZenviaInboundContent): ExtractedInboundContent | null {
  const file = content as {
    fileUrl?: string;
    fileMimeType?: string;
    fileName?: string;
    fileCaption?: string;
    status?: string;
  };
  if (file.status === 'REJECTED' || !file.fileUrl) return null;
  return {
    type: omniTypeForMime(file.fileMimeType),
    mediaId: file.fileUrl,
    mimeType: file.fileMimeType,
    caption: file.fileCaption,
    filename: file.fileName,
  };
}

function extractLocationContent(content: ZenviaInboundContent): ExtractedInboundContent | null {
  const loc = content as { latitude?: number; longitude?: number; name?: string; address?: string };
  if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') return null;
  const label = [loc.name, loc.address].filter(Boolean).join(', ');
  return { type: 'location', text: label || `${loc.latitude},${loc.longitude}` };
}

function extractContactsContent(content: ZenviaInboundContent): ExtractedInboundContent | null {
  const contacts = (content as { contacts?: Array<Record<string, unknown>> }).contacts;
  const first = contacts?.[0];
  if (!first) return null;
  const name = first.name as { formattedName?: string; firstName?: string } | undefined;
  const phones = first.phones as Array<{ phone?: string }> | undefined;
  const displayName = name?.formattedName ?? name?.firstName ?? 'Contact';
  const phone = phones?.[0]?.phone ?? '';
  return { type: 'text', text: `Contact: ${displayName}${phone ? `: ${phone}` : ''}` };
}

function toMetaReferral(referral: ZenviaReferral | undefined): Record<string, unknown> | undefined {
  if (!referral) return undefined;
  const meta: Record<string, unknown> = {};
  if (referral.source?.type) meta.source_type = referral.source.type;
  if (referral.source?.id) meta.source_id = referral.source.id;
  if (referral.source?.url) meta.source_url = referral.source.url;
  if (referral.headline) meta.headline = referral.headline;
  if (referral.body) meta.body = referral.body;
  if (referral.ctwaId) meta.ctwa_clid = referral.ctwaId;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function buildRawPayload(
  msg: ZenviaInboundMessage,
  content: ExtractedInboundContent,
  senderName: string | undefined,
  platformTimestampMs: number,
): Record<string, unknown> {
  const referral = toMetaReferral(msg.referral);
  return {
    zenvia: msg as unknown as Record<string, unknown>,
    ...(senderName ? { pushName: senderName } : {}),
    ...(referral ? { referral } : {}),
    ...(content.filename ? { filename: content.filename } : {}),
    platformTimestampMs,
  };
}
