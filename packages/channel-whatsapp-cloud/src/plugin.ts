/**
 * WhatsApp Cloud (Meta) channel plugin.
 *
 * Implements `BaseChannelPlugin` for the official Meta WhatsApp Cloud API:
 *   - Outbound via REST (Graph API v25.0 by default).
 *   - Inbound via webhook with HMAC-SHA256 (`X-Hub-Signature-256`) verification.
 *   - 24h messaging window enforced by Meta — only HSM templates ship outside it.
 *
 * Per-instance state: `MetaWhatsAppClient` (scoped to one phone_number_id +
 * access_token) + dedupe cache keyed by `wamid`.
 */

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
import type { Logger } from '@omni/core';
import { markdownToWhatsApp } from '@omni/core';
import type { EventPayloadMap } from '@omni/core/events';
import { WhatsAppFlowSendSchema } from '@omni/core/schemas';
import type { MetaInboundMessage, MetaTemplateStatusUpdate, MetaWebhookStatusEntry } from '@omni/core/schemas';
import type { ChannelType, ContentType } from '@omni/core/types';

import { WHATSAPP_CLOUD_CAPABILITIES } from './capabilities';
import { MetaWhatsAppClient } from './client';
import { FlowResolverRegistry } from './flows/resolver';
import { handleFlowDataRequest } from './handlers/flow-data';
import { handleMetaWebhook } from './handlers/webhook';
import {
  type SendTemplateButton,
  type SendTemplateHeaderMedia,
  sendContact,
  sendFlow,
  sendInteractive,
  sendLocation,
  sendLocationRequest,
  sendMedia,
  sendReaction,
  sendTemplate,
  sendText,
} from './senders';
import type { MetaSendResponse, WhatsAppCloudConfig } from './types';
import { MetaApiError, MetaErrorCode } from './utils/errors';
import { toMetaPhone } from './utils/identity';

const META_MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'document', 'sticker']);

/**
 * SDK download guard for inbound media. Meta reports `file_size` on the
 * `GET /{media_id}` lookup — the guard rejects oversized payloads before any
 * bytes are pulled into memory (see `downloadInboundMedia`).
 */
const downloadGuard = createDownloadGuard();

interface WhatsAppCloudInstanceState {
  client: MetaWhatsAppClient;
  config: WhatsAppCloudConfig;
  dedupeCache: DedupeCache;
  /**
   * chat (digits-only phone) → wamid of the newest inbound message. Meta's
   * typing indicator can only be sent by referencing a RECEIVED message id
   * (`sendTyping` looks the wamid up here), so we remember one per chat.
   */
  lastInboundWamid: Map<string, string>;
}

/** Cap on remembered chats per instance — oldest insertion evicted beyond it. */
const MAX_TYPING_WAMID_CHATS = 1000;

export class WhatsAppCloudPlugin extends BaseChannelPlugin {
  readonly id = 'whatsapp-cloud' as ChannelType;
  readonly name = 'WhatsApp (Meta Cloud API)';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = WHATSAPP_CLOUD_CAPABILITIES;

  /** instanceId → live state */
  private waCloudInstances = new Map<string, WhatsAppCloudInstanceState>();

  /** phone_number_id → instanceId (reverse index — O(1) webhook resolution). */
  private byPhoneNumberId = new Map<string, string>();

  /** waba_id → Set<instanceId> (multiple instances can share a WABA). */
  private byWabaId = new Map<string, Set<string>>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('WhatsApp Cloud plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.waCloudInstances) {
      state.dedupeCache.dispose();
    }
    this.waCloudInstances.clear();
    this.byPhoneNumberId.clear();
    this.byWabaId.clear();
    this.logger.info('WhatsApp Cloud plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect an instance using the persisted Meta config.
   *
   * `config.credentials` is expected to carry:
   *   - metaAccessToken (required)
   *   - metaPhoneNumberId (required)
   *   - metaWabaId (required)
   *   - metaAppId / metaBusinessId / metaApiVersion / metaDisplayPhoneNumber /
   *     metaConnectionMethod (optional)
   *
   * The OAuth flow that populates these values lives in Group 5
   * (packages/api/src/routes/v2/whatsapp-cloud.ts → exchange/connect routes).
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const creds = (config.credentials ?? {}) as Record<string, unknown>;
    const opts = (config.options ?? {}) as Record<string, unknown>;

    const accessToken = (creds.metaAccessToken ?? opts.metaAccessToken) as string | undefined;
    const phoneNumberId = (creds.metaPhoneNumberId ?? opts.metaPhoneNumberId) as string | undefined;
    const wabaId = (creds.metaWabaId ?? opts.metaWabaId) as string | undefined;

    if (!accessToken) {
      throw new MetaApiError(
        MetaErrorCode.AUTH_FAILED,
        'metaAccessToken is required to connect a whatsapp-cloud instance',
      );
    }
    if (!phoneNumberId) {
      throw new MetaApiError(
        MetaErrorCode.PHONE_NOT_FOUND,
        'metaPhoneNumberId is required to connect a whatsapp-cloud instance',
      );
    }
    if (!wabaId) {
      throw new MetaApiError(
        MetaErrorCode.INVALID_REQUEST,
        'metaWabaId is required to connect a whatsapp-cloud instance',
      );
    }

    const apiVersion = ((creds.metaApiVersion ?? opts.metaApiVersion) as string | undefined) ?? 'v25.0';
    const appId = (creds.metaAppId ?? opts.metaAppId) as string | undefined;
    const businessId = (creds.metaBusinessId ?? opts.metaBusinessId) as string | undefined;
    const displayPhoneNumber = (creds.metaDisplayPhoneNumber ?? opts.metaDisplayPhoneNumber) as string | undefined;
    const connectionMethod =
      ((creds.metaConnectionMethod ?? opts.metaConnectionMethod) as string | undefined) ?? 'manual';

    this.logger.info('Connecting WhatsApp Cloud instance', { instanceId, phoneNumberId, wabaId, connectionMethod });

    const client = new MetaWhatsAppClient(
      {
        phoneNumberId,
        accessToken,
        apiVersion,
      },
      wabaId,
    );

    // Validate the token by hitting GET /{phone_number_id}.
    const reachable = await client.ping();
    if (!reachable) {
      throw new MetaApiError(
        MetaErrorCode.AUTH_FAILED,
        'Meta access token rejected or phone_number_id unreachable — check credentials',
        { operation: 'connect' },
      );
    }

    const cloudConfig: WhatsAppCloudConfig = {
      accessToken,
      phoneNumberId,
      wabaId,
      appId,
      businessId,
      apiVersion,
      connectionMethod,
      displayPhoneNumber,
    };
    const dedupeCache = createInboundDedupeCache();
    const lastInboundWamid = new Map<string, string>();

    this.waCloudInstances.set(instanceId, { client, config: cloudConfig, dedupeCache, lastInboundWamid });
    this.byPhoneNumberId.set(phoneNumberId, instanceId);
    let wabaSet = this.byWabaId.get(wabaId);
    if (!wabaSet) {
      wabaSet = new Set<string>();
      this.byWabaId.set(wabaId, wabaSet);
    }
    wabaSet.add(instanceId);

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: `Connected via Meta Cloud API (${connectionMethod})`,
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: displayPhoneNumber ?? 'WhatsApp Cloud',
      ownerIdentifier: phoneNumberId,
    });

    this.logger.info('WhatsApp Cloud instance connected', { instanceId, phoneNumberId });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting WhatsApp Cloud instance', { instanceId });

    const state = this.waCloudInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.waCloudInstances.delete(instanceId);
      this.byPhoneNumberId.delete(state.config.phoneNumberId);
      const wabaSet = this.byWabaId.get(state.config.wabaId);
      if (wabaSet) {
        wabaSet.delete(instanceId);
        if (wabaSet.size === 0) this.byWabaId.delete(state.config.wabaId);
      }
    }

    this.instances.setInstance(instanceId, {} as InstanceConfig, {
      state: 'disconnected',
      since: new Date(),
      message: 'Disconnected',
    });

    await this.emitInstanceDisconnected(instanceId, 'Manual disconnect');
  }

  // ─────────────────────────────────────────────────────────────
  // Outbound (full implementation in Group 3 — senders/*)
  // ─────────────────────────────────────────────────────────────

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.waCloudInstances.get(instanceId);
    if (!state) {
      return {
        success: false,
        error: 'WhatsApp Cloud instance not connected',
        retryable: false,
        timestamp: Date.now(),
      };
    }

    const { client } = state;
    const { content, to, replyTo, metadata } = message;

    // Journey timing: T10 (pluginSentAt) right before the Graph API call.
    const correlationId = metadata?.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const dispatched = await dispatchOutbound(client, message, this.logger);
      if (!dispatched.ok) {
        return {
          success: false,
          error: dispatched.error,
          retryable: false,
          timestamp: Date.now(),
        };
      }
      const { response } = dispatched;

      // Journey timing: T11 (platformDeliveredAt) once Meta acknowledged the send.
      if (correlationId) this.captureT11(correlationId);

      // Meta returns `messages[0].id` (wamid) on every successful send — if it's
      // missing, the response is malformed. Bail with a clear error rather than
      // fabricating a UUID, which would break dedupe + idempotency on the
      // webhook side (the inbound `sent`/`delivered` status callbacks key off
      // the real wamid).
      const messageId = response.messages?.[0]?.id;
      if (!messageId) {
        const err = 'Meta did not return a message id on successful send (malformed response)';
        await this.emitMessageFailed({ instanceId, chatId: to, error: err, retryable: false });
        return { success: false, error: err, retryable: false, timestamp: Date.now() };
      }

      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId: to,
        to,
        content: {
          type: content.type,
          text: content.text,
          mediaUrl: content.mediaUrl,
        },
        replyToId: replyTo,
        senderAgentId: metadata?.senderAgentId as string | undefined,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (err) {
      const isMeta = err instanceof MetaApiError;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const retryable = isMeta ? err.retryable : false;

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      return {
        success: false,
        error: errorMessage,
        errorCode: isMeta ? err.code : undefined,
        retryable,
        timestamp: Date.now(),
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook (full implementation in Group 4 — handlers/webhook.ts)
  // ─────────────────────────────────────────────────────────────

  async handleWebhook(request: Request): Promise<Response> {
    const appSecret = process.env.META_APP_SECRET ?? '';
    const verifyToken = process.env.META_VERIFY_TOKEN ?? '';

    if (!appSecret || !verifyToken) {
      this.logger.error('META_APP_SECRET or META_VERIFY_TOKEN missing — refusing to handle webhook', {
        method: request.method,
      });
      // 200 to avoid Meta disabling the app; the env misconfiguration is on us.
      return new Response('Webhook misconfigured server-side', { status: 200 });
    }

    return handleMetaWebhook(request, this, appSecret, verifyToken);
  }

  // ─────────────────────────────────────────────────────────────
  // WhatsApp Flows data-exchange endpoint
  // ─────────────────────────────────────────────────────────────

  /** Screen resolvers for endpoint-backed flows (see flows/resolver.ts). */
  readonly flowResolvers = new FlowResolverRegistry();

  /**
   * Handle one encrypted data-exchange request for `instanceId`. The caller
   * (API public route) owns instance lookup and private-key unsealing — this
   * method owns signature verification, crypto and screen resolution.
   */
  async handleFlowData(request: Request, opts: { instanceId: string; privateKeyPem: string }): Promise<Response> {
    return handleFlowDataRequest(request, {
      instanceId: opts.instanceId,
      channelType: this.id,
      privateKeyPem: opts.privateKeyPem,
      appSecret: process.env.META_APP_SECRET ?? '',
      registry: this.flowResolvers,
      logger: this.logger,
      publishEvent: (payload) =>
        this.eventBus.publish('flow.data_exchange', payload, {
          instanceId: opts.instanceId,
          channelType: this.id,
          source: `channel:${this.id}`,
        }),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  override async getHealth(instanceId?: string): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];
    const single = instanceId ? this.waCloudInstances.get(instanceId) : undefined;
    const states: Array<readonly [string, WhatsAppCloudInstanceState]> = instanceId
      ? single
        ? [[instanceId, single] as const]
        : []
      : Array.from(this.waCloudInstances.entries());

    for (const [id, state] of states) {
      const ok = await state.client.ping();
      checks.push({
        name: `whatsapp-cloud:${id}`,
        status: ok ? 'pass' : 'fail',
        message: ok
          ? `Phone ${state.config.phoneNumberId} reachable`
          : `Phone ${state.config.phoneNumberId} unreachable — token rejected or network error`,
      });
    }

    return {
      status: checks.length === 0 || checks.every((c) => c.status === 'pass') ? 'healthy' : 'unhealthy',
      checks,
      checkedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported — Meta does not expose backfill).
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }

  // ─────────────────────────────────────────────────────────────
  // Reactions (implements ChannelPlugin.react / ChannelPlugin.unreact)
  // ─────────────────────────────────────────────────────────────

  /** Add a reaction emoji to a message (`messageId` is the target wamid). */
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const state = this.requireInstanceState(instanceId, 'react');
    await sendReaction(state.client, chatId, messageId, emoji);
  }

  /** Remove a reaction — Meta removes it when an empty emoji is sent for the same wamid. */
  async unreact(instanceId: string, chatId: string, messageId: string, _emoji: string): Promise<void> {
    const state = this.requireInstanceState(instanceId, 'unreact');
    await sendReaction(state.client, chatId, messageId, '');
  }

  // ─────────────────────────────────────────────────────────────
  // Typing indicator (implements ChannelPlugin.sendTyping)
  // ─────────────────────────────────────────────────────────────

  /**
   * Show the typing indicator in `chatId`.
   *
   * Meta's Cloud API has no free-standing presence endpoint — the indicator is
   * sent by marking the newest RECEIVED message as read with
   * `typing_indicator: { type: 'text' }`, and it self-dismisses on reply or
   * after ~25s. Consequences honored here:
   *   - Needs a remembered inbound wamid for the chat (`lastInboundWamid`,
   *     recorded by `handleInboundMessage`). No wamid → silent no-op, per the
   *     sendTyping contract ("plugins that cannot start the indicator are
   *     silently skipped — the follow-up still sends, without the indicator").
   *   - `duration` cannot be enforced and `duration === 0` (stop) cannot be
   *     expressed — both are accepted and ignored.
   *   - The referenced message is marked read as a side effect (Meta couples
   *     them by design). That matches every caller's intent: typing precedes
   *     an imminent reply.
   */
  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    if (duration === 0) return; // Meta has no "stop typing" — it self-dismisses.

    const state = this.waCloudInstances.get(instanceId);
    if (!state) return; // Contract: typing is best-effort; never throw from here.

    const wamid = state.lastInboundWamid.get(toMetaPhone(chatId));
    if (!wamid) {
      this.logger.debug('[whatsapp-cloud] sendTyping skipped — no inbound wamid remembered for chat', {
        instanceId,
        chatId,
      });
      return;
    }

    try {
      await state.client.sendTypingIndicator(wamid);
    } catch (err) {
      this.logger.debug('[whatsapp-cloud] sendTyping failed (best-effort, ignored)', {
        instanceId,
        chatId,
        err: String(err),
      });
    }
  }

  /**
   * Remember the newest inbound wamid for a chat so `sendTyping` can reference
   * it. Bounded FIFO per instance: beyond `MAX_TYPING_WAMID_CHATS` chats the
   * oldest-inserted entry is evicted (re-inserting on every message keeps
   * active chats near the young end).
   */
  private rememberInboundWamid(instanceId: string, from: string, wamid: string): void {
    const state = this.waCloudInstances.get(instanceId);
    if (!state) return;
    const chatKey = toMetaPhone(from);
    state.lastInboundWamid.delete(chatKey);
    state.lastInboundWamid.set(chatKey, wamid);
    if (state.lastInboundWamid.size > MAX_TYPING_WAMID_CHATS) {
      const oldest = state.lastInboundWamid.keys().next().value;
      if (oldest !== undefined) state.lastInboundWamid.delete(oldest);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound media download
  // ─────────────────────────────────────────────────────────────

  /**
   * Resolve and download an inbound media attachment by Meta media id.
   *
   * Inbound webhooks carry only a `media_id` (surfaced in
   * `rawPayload.mediaId` by `handleInboundMessage`) — the bytes live behind
   * `GET /{media_id}` + an authenticated, short-lived download URL. The SDK
   * download guard checks the `file_size` Meta reports on the lookup before
   * any bytes are pulled into memory (throws `DownloadTooLargeError`).
   */
  async downloadInboundMedia(instanceId: string, mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const state = this.requireInstanceState(instanceId, 'downloadInboundMedia');
    const media = await state.client.getMediaUrl(mediaId);
    if (typeof media.file_size === 'number') {
      downloadGuard.checkSize(media.file_size, this.logger, {
        instanceId,
        url: media.url,
        channel: 'whatsapp-cloud',
      });
    }
    const bytes = await state.client.downloadMedia(media.url);
    return { buffer: Buffer.from(bytes), mimeType: media.mime_type };
  }

  /** Live state for `instanceId`, or throw `META_NOT_CONNECTED`. */
  private requireInstanceState(instanceId: string, operation: string): WhatsAppCloudInstanceState {
    const state = this.waCloudInstances.get(instanceId);
    if (!state) {
      throw new MetaApiError(MetaErrorCode.NOT_CONNECTED, 'WhatsApp Cloud instance not connected', {
        operation,
      });
    }
    return state;
  }

  // ─────────────────────────────────────────────────────────────
  // Public accessors used by the webhook handler (Group 4)
  // ─────────────────────────────────────────────────────────────

  /** Look up the live state for an instance — used by the webhook handler. */
  getInstanceState(instanceId: string): WhatsAppCloudInstanceState | undefined {
    return this.waCloudInstances.get(instanceId);
  }

  /** Iterate all connected instance ids — used by webhook for phone_number_id → instance resolution. */
  getConnectedInstanceIds(): string[] {
    return Array.from(this.waCloudInstances.keys());
  }

  /**
   * Reverse lookup: given a phone_number_id from a webhook payload, find the
   * matching instance. Returns `[instanceId, state]` or `undefined`.
   *
   * The Meta webhook is global — there's no path-based instance id — so this
   * is the resolution mechanism used by `handleWebhook` after signature
   * verification. O(1) via the `byPhoneNumberId` reverse index.
   */
  findInstanceByPhoneNumberId(phoneNumberId: string): readonly [string, WhatsAppCloudInstanceState] | undefined {
    const id = this.byPhoneNumberId.get(phoneNumberId);
    if (!id) return undefined;
    const state = this.waCloudInstances.get(id);
    return state ? ([id, state] as const) : undefined;
  }

  /**
   * Reverse lookup by `waba_id`. Returns ALL instances that share the WABA —
   * Meta's WABA-scoped webhook fields (`account_alerts`, `account_update`,
   * `phone_number_quality_update`, `phone_number_name_update`) carry only the
   * WABA id, and multiple Omni instances can be provisioned under the same
   * WABA (different phone numbers). Each instance gets its own alert event.
   *
   * O(K) where K is the number of instances sharing the WABA — typically 1.
   */
  findInstancesByWabaId(wabaId: string): Array<readonly [string, WhatsAppCloudInstanceState]> {
    const ids = this.byWabaId.get(wabaId);
    if (!ids || ids.size === 0) return [];
    const matches: Array<readonly [string, WhatsAppCloudInstanceState]> = [];
    for (const id of ids) {
      const state = this.waCloudInstances.get(id);
      if (state) matches.push([id, state] as const);
    }
    return matches;
  }

  getLogger(): Logger {
    return this.logger;
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound handlers (called by handlers/webhook.ts)
  //
  // These are public wrappers around the protected emit* helpers exposed
  // by BaseChannelPlugin. The pattern mirrors GupshupPlugin: keep all the
  // event-emission and PII-normalization logic inside the plugin class so
  // the webhook handler stays a pure dispatcher.
  // ─────────────────────────────────────────────────────────────

  /**
   * Emit `message.received` (or `reaction.received`/`reaction.removed`) from a
   * parsed Meta inbound message, after dedupe.
   *
   * Returns `true` when an event was published, `false` when the message was
   * a duplicate (`dedupeCache.isDuplicate`) or had no extractable content.
   */
  async handleInboundMessage(
    instanceId: string,
    msg: MetaInboundMessage,
    contacts: Array<{ profile?: { name?: string }; wa_id?: string }> | undefined,
    dedupeCache: DedupeCache,
  ): Promise<boolean> {
    const wamid = msg.id;

    if (dedupeCache.isDuplicate(instanceId, wamid, 'whatsapp-cloud', this.logger)) {
      this.logger.debug('[whatsapp-cloud] duplicate inbound dropped', { instanceId, wamid });
      return false;
    }

    if (msg.type === 'reaction') {
      await this.handleInboundReaction(instanceId, msg);
      return true;
    }

    this.rememberInboundWamid(instanceId, msg.from, wamid);

    const content = extractInboundContent(msg);
    if (!content) {
      this.logger.warn('[whatsapp-cloud] inbound message has no extractable content', {
        instanceId,
        wamid,
        type: msg.type,
      });
      return false;
    }

    if (!this.sanitizeInboundContent(instanceId, wamid, content)) return false;

    const senderName = contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
    const tsSeconds = Number.parseInt(msg.timestamp, 10);
    const platformTimestampMs = Number.isFinite(tsSeconds) ? tsSeconds * 1000 : Date.now();
    const replyToId = 'context' in msg ? msg.context?.id : undefined;

    // Journey timing: T0 (platformReceivedAt) + T1 (pluginReceivedAt), then
    // T2 (eventPublishedAt) after the event is on the bus.
    const timings = this.captureInboundTimings(platformTimestampMs);

    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId: wamid,
      chatId: msg.from,
      from: msg.from,
      senderName,
      content: {
        type: content.type,
        text: content.text ?? content.caption,
        mediaUrl: content.mediaUrl,
        mimeType: content.mimeType,
        isVoiceNote: content.isVoiceNote,
      },
      replyToId,
      rawPayload: {
        meta: msg as unknown as Record<string, unknown>,
        mediaId: content.mediaId,
        filename: content.filename,
        platformTimestampMs,
      },
      timings,
    });
    if (timings) this.captureT2(correlationId, timings);
    return true;
  }

  /**
   * Reactions go through emitReactionReceived (or emitReactionRemoved when
   * emoji is empty — Meta uses empty emoji as "reaction removed").
   *
   * Phone numbers stay in Meta wire format (digits-only) — each channel
   * uses its native `platform_user_id` shape; cross-channel identity
   * unification happens in the identity-graph layer, not here.
   */
  private async handleInboundReaction(
    instanceId: string,
    msg: Extract<MetaInboundMessage, { type: 'reaction' }>,
  ): Promise<void> {
    const targetMessageId = msg.reaction.message_id;
    const emoji = msg.reaction.emoji;
    if (!emoji) {
      await this.emitReactionRemoved({
        instanceId,
        messageId: targetMessageId,
        chatId: msg.from,
        from: msg.from,
        emoji: '',
      });
      return;
    }
    await this.emitReactionReceived({
      instanceId,
      messageId: targetMessageId,
      chatId: msg.from,
      from: msg.from,
      emoji,
      rawPayload: msg as unknown as Record<string, unknown>,
    });
  }

  /**
   * Run inbound text (body and/or media caption) through the SDK sanitizer.
   *
   * Mutates `content` in place with the cleaned text. Returns `false` when
   * the sanitizer rejects the message (null bytes / oversized) — the caller
   * drops the message without emitting.
   */
  private sanitizeInboundContent(instanceId: string, wamid: string, content: ExtractedInboundContent): boolean {
    for (const field of ['text', 'caption'] as const) {
      const value = content[field];
      if (!value) continue;
      const sanitized = sanitizeMessage(value, this.logger, { instanceId, messageId: wamid });
      if (!sanitized.ok) {
        this.logger.warn('[whatsapp-cloud] inbound text rejected by sanitizer', {
          instanceId,
          wamid,
          field,
          rejected: sanitized.rejected,
        });
        return false;
      }
      content[field] = sanitized.text;
    }
    return true;
  }

  /**
   * Emit the appropriate `message.*` event for a Meta status update.
   *
   * Maps:
   *   sent      → no-op (already emitted by `sendMessage`)
   *   delivered → message.delivered
   *   read      → message.read
   *   failed    → message.failed
   */
  async handleStatusUpdate(instanceId: string, status: MetaWebhookStatusEntry): Promise<void> {
    const tsSeconds = Number.parseInt(status.timestamp, 10);
    const timestampMs = Number.isFinite(tsSeconds) ? tsSeconds * 1000 : Date.now();
    // recipient_id stays in Meta wire format (digits-only) — see note in
    // handleInboundMessage.
    const recipientId = status.recipient_id;

    switch (status.status) {
      case 'sent':
        // Intentionally no-op — `sendMessage` already emitted `message.sent`
        // immediately after Graph API returned 200. Emitting again here would
        // duplicate the event downstream (DB rows, observability, agents).
        return;

      case 'delivered':
        await this.emitMessageDelivered({
          instanceId,
          externalId: status.id,
          chatId: recipientId,
          deliveredAt: timestampMs,
        });
        return;

      case 'read':
        await this.emitMessageRead({
          instanceId,
          externalId: status.id,
          chatId: recipientId,
          readAt: timestampMs,
        });
        return;

      case 'failed': {
        const firstError = status.errors?.[0];
        const errorCode = firstError ? String(firstError.code) : undefined;
        const errorMessage = firstError?.message ?? firstError?.title ?? 'Meta reported delivery failure';
        await this.emitMessageFailed({
          instanceId,
          externalId: status.id,
          chatId: recipientId,
          error: errorMessage,
          errorCode,
          retryable: false,
        });
        return;
      }
    }
  }

  /**
   * Emit `template.status_changed` from a Meta template lifecycle event.
   *
   * Caller (the templates service in `templates.ts::handleTemplateStatusUpdate`)
   * resolves the local template UUID and previous status from the
   * `whatsapp_templates` table before invoking this method — that resolution
   * also picks the correct instance scope (by `wabaId`), avoiding the fan-out
   * to all connected instances that an instance-blind dispatch would cause.
   */
  /**
   * Emit `channel.alert` for a Meta WABA-scoped webhook event.
   *
   * Maps Meta's freeform alert payload into a canonical Omni shape. The
   * webhook handler resolves all instances sharing the WABA and calls this
   * method once per instance — alerts are operator-facing and need
   * per-instance scope so dashboards/notifications fire correctly even when
   * the same WABA spans several Omni instances.
   */
  async handleChannelAlert(
    instanceId: string,
    alertType: EventPayloadMap['channel.alert']['alertType'],
    value: Record<string, unknown>,
  ): Promise<void> {
    const alertInfo = (value.alert_info ?? {}) as Record<string, unknown>;
    const entityType = typeof value.entity_type === 'string' ? value.entity_type : undefined;
    const entityId = typeof value.entity_id === 'string' ? value.entity_id : undefined;

    // Best-effort severity inference. Meta uses different fields across
    // webhook types so we look at the most common ones first.
    const severity = inferAlertSeverity(alertType, alertInfo, value);
    const message = inferAlertMessage(alertType, alertInfo, value);

    const payload: EventPayloadMap['channel.alert'] = {
      instanceId,
      channelType: this.id,
      alertType,
      severity,
      message,
      entityType,
      entityId,
      data: value,
    };

    await this.eventBus.publish('channel.alert', payload, {
      instanceId,
      channelType: this.id,
      source: `channel:${this.id}`,
    });
  }

  async handleTemplateStatusChanged(
    instanceId: string,
    update: MetaTemplateStatusUpdate,
    extras?: {
      templateId?: string;
      previousStatus?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DELETED';
    },
  ): Promise<void> {
    const newStatus = mapTemplateEventToStatus(update.event);
    if (!newStatus) {
      this.logger.debug('[whatsapp-cloud] unmapped template lifecycle event', {
        instanceId,
        event: update.event,
        metaTemplateId: update.message_template_id,
      });
      return;
    }

    const payload: EventPayloadMap['template.status_changed'] = {
      instanceId,
      templateId: extras?.templateId ?? update.message_template_id,
      metaTemplateId: update.message_template_id,
      templateName: update.message_template_name,
      language: update.message_template_language,
      previousStatus: extras?.previousStatus ?? null,
      newStatus,
      rejectionReason: update.reason,
    };

    await this.eventBus.publish('template.status_changed', payload, {
      instanceId,
      channelType: this.id,
      source: `channel:${this.id}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Module-level helpers — pure, no plugin state, kept outside the class
// for clarity. They're used by `sendMessage` and the inbound handlers.
// ─────────────────────────────────────────────────────────────────────────

type OutboundDispatchResult = { ok: true; response: MetaSendResponse } | { ok: false; error: string };

/**
 * Route an outgoing message to the matching sender by `content.type`.
 *
 * Returns `{ ok: false }` for unsupported types or missing template metadata —
 * `sendMessage` surfaces that as a non-retryable `SendResult` without emitting
 * `message.failed` (nothing was attempted against the Graph API). Sender
 * failures propagate as thrown `MetaApiError`s, handled by the caller.
 */
async function dispatchOutbound(
  client: MetaWhatsAppClient,
  message: OutgoingMessage,
  logger?: Logger,
): Promise<OutboundDispatchResult> {
  const { content, to, replyTo } = message;

  if (content.type === 'text') {
    return { ok: true, response: await dispatchOutboundText(client, message, logger) };
  }
  if (META_MEDIA_TYPES.has(content.type)) {
    return {
      ok: true,
      response: await sendMedia(
        client,
        to,
        content.mediaUrl ?? '',
        content.mimeType,
        content.caption ?? content.text,
        content.filename,
        replyTo,
      ),
    };
  }
  if (content.type === 'location' && content.location) {
    const { latitude, longitude, name, address } = content.location;
    return { ok: true, response: await sendLocation(client, to, latitude, longitude, name, address, replyTo) };
  }
  if (content.type === 'contact' && content.contact) {
    const response = await sendContact(
      client,
      to,
      [
        {
          name: content.contact.name,
          phones: content.contact.phone ? [content.contact.phone] : undefined,
          emails: content.contact.email ? [content.contact.email] : undefined,
        },
      ],
      replyTo,
    );
    return { ok: true, response };
  }
  if (content.type === 'reaction') {
    return { ok: true, response: await sendReaction(client, to, content.targetMessageId ?? '', content.emoji ?? '') };
  }
  if (content.type === 'location_request') {
    return { ok: true, response: await sendLocationRequest(client, to, content.text ?? '', replyTo) };
  }
  if (content.type === 'template') {
    return dispatchOutboundTemplate(client, message);
  }
  if (content.type === 'flow') {
    return dispatchOutboundFlow(client, message);
  }
  return { ok: false, error: `Unsupported content.type=${content.type} for whatsapp-cloud` };
}

/**
 * Flow descriptor is carried via `metadata.flow` (same convention as
 * `metadata.template`) and validated against `WhatsAppFlowSendSchema` —
 * callers populate it via the whatsapp-flows send route or directly.
 */
async function dispatchOutboundFlow(
  client: MetaWhatsAppClient,
  message: OutgoingMessage,
): Promise<OutboundDispatchResult> {
  const parsed = WhatsAppFlowSendSchema.safeParse(message.metadata?.flow);
  if (!parsed.success) {
    return {
      ok: false,
      error: `content.type=flow requires a valid metadata.flow descriptor: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    };
  }
  const { response } = await sendFlow(client, message.to, parsed.data, message.replyTo);
  return { ok: true, response };
}

/**
 * Text content — plain send, or the best-fitting Meta interactive type when
 * `content.buttons` is present (reply buttons ≤3, list 4-10, cta_url for a
 * single URL button). Overflow beyond Meta's 10-row list limit is dropped
 * with a warn log — never silently.
 */
async function dispatchOutboundText(
  client: MetaWhatsAppClient,
  message: OutgoingMessage,
  logger?: Logger,
): Promise<MetaSendResponse> {
  const { content, to, replyTo } = message;

  // Markdown → sintaxe do WhatsApp, igual ao canal baileys. Sem isto o
  // `**negrito**` do agente chegava CRU e o parser do WhatsApp casava os
  // asteriscos errados: "**a**, **b**, **c**" virava "*a, **b, **c*" no
  // aparelho (medido em 2026-08-01). O canal já recebe `messageFormatMode`
  // na instância — só não o honrava aqui, ao contrário do baileys.
  const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
  const text = content.text ?? '';
  const formatted = formatMode === 'passthrough' ? text : markdownToWhatsApp(text);

  if (!content.buttons?.length) {
    return sendText(client, to, formatted, replyTo);
  }
  const { response, droppedRows } = await sendInteractive(
    client,
    to,
    formatted,
    content.buttons,
    replyTo,
    content.list?.buttonLabel,
    { sectionTitle: content.list?.sectionTitle, forceList: content.list?.forceList },
  );
  if (droppedRows > 0) {
    logger?.warn('[whatsapp-cloud] interactive list capped at 10 rows — extra buttons dropped', { to, droppedRows });
  }
  return response;
}

/**
 * Template descriptor is carried via `metadata.template`. Senders/templates wire
 * this via the routes/v2/templates.ts handler when the user hits send-template;
 * for direct sendMessage calls, callers populate metadata.template themselves.
 */
async function dispatchOutboundTemplate(
  client: MetaWhatsAppClient,
  message: OutgoingMessage,
): Promise<OutboundDispatchResult> {
  const { to, replyTo, metadata } = message;
  const tpl = (metadata?.template ?? {}) as {
    name?: string;
    language?: string;
    bodyParameters?: string[];
    headerMedia?: SendTemplateHeaderMedia;
    buttonParameters?: SendTemplateButton[];
  };
  if (!tpl.name) {
    return { ok: false, error: 'template send requires metadata.template.name' };
  }
  const response = await sendTemplate(
    client,
    to,
    tpl.name,
    tpl.language ?? 'pt_BR',
    tpl.bodyParameters,
    tpl.headerMedia,
    tpl.buttonParameters,
    replyTo,
  );
  return { ok: true, response };
}

interface ExtractedInboundContent {
  type: ContentType;
  text?: string;
  mediaUrl?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  isVoiceNote?: boolean;
}

const MEDIA_TYPE_MAP: Partial<Record<MetaInboundMessage['type'], ContentType>> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
  document: 'document',
  sticker: 'sticker',
};

/**
 * Extract a normalized content envelope from a Meta inbound message.
 *
 * Media-bearing messages return only the `mediaId` — a downstream worker
 * (or a future inline download step) is responsible for swapping that for
 * a downloadable URL via `GET /{media_id}`. Returning `mediaId` here keeps
 * the webhook handler synchronous so we don't owe Meta a 2xx while waiting
 * on a Graph API roundtrip.
 */
function extractInboundContent(msg: MetaInboundMessage): ExtractedInboundContent | null {
  if (msg.type === 'text') {
    return { type: 'text', text: msg.text.body };
  }
  if (msg.type === 'location') {
    return extractLocationContent(msg.location);
  }
  if (msg.type === 'contacts') {
    return extractContactContent(msg.contacts);
  }
  if (msg.type === 'interactive') {
    return extractInteractiveContent(msg.interactive);
  }
  if (msg.type === 'button') {
    return { type: 'text', text: msg.button.text };
  }
  // Media types — image | audio | video | document | sticker (anything else → null)
  return extractMediaContent(msg);
}

function extractLocationContent(
  location: Extract<MetaInboundMessage, { type: 'location' }>['location'],
): ExtractedInboundContent {
  const { latitude, longitude, name, address } = location;
  const label = [name, address].filter(Boolean).join(', ');
  return {
    type: 'location',
    text: label || `${latitude},${longitude}`,
  };
}

function extractContactContent(
  contacts: Extract<MetaInboundMessage, { type: 'contacts' }>['contacts'],
): ExtractedInboundContent {
  const first = contacts[0];
  const formattedName = first?.name?.formatted_name as string | undefined;
  const firstName = first?.name?.first_name as string | undefined;
  const phone = (first?.phones?.[0]?.phone as string | undefined) ?? '';
  const name = formattedName ?? firstName ?? 'Contact';
  return {
    type: 'text',
    text: `Contact: ${name}${phone ? `: ${phone}` : ''}`,
  };
}

function extractInteractiveContent(
  interactive: Extract<MetaInboundMessage, { type: 'interactive' }>['interactive'],
): ExtractedInboundContent {
  if (interactive.type === 'button_reply' && interactive.button_reply) {
    return { type: 'text', text: interactive.button_reply.title };
  }
  if (interactive.type === 'nfm_reply' && interactive.nfm_reply) {
    // WhatsApp Flow completion. The structured answers live in response_json —
    // surfaced as text for the conversation timeline; consumers read the full
    // payload from rawPayload.meta.interactive.nfm_reply.response_json.
    return { type: 'text', text: interactive.nfm_reply.body ?? '[flow response]' };
  }
  if (interactive.type === 'list_reply' && interactive.list_reply) {
    return { type: 'text', text: interactive.list_reply.title };
  }
  return { type: 'text', text: '[interactive]' };
}

/** Pick the media payload matching the message type — image | audio | video | document | sticker. */
function getInboundMediaField(msg: MetaInboundMessage) {
  switch (msg.type) {
    case 'image':
      return msg.image;
    case 'audio':
      return msg.audio;
    case 'video':
      return msg.video;
    case 'document':
      return msg.document;
    case 'sticker':
      return msg.sticker;
    default:
      return undefined;
  }
}

function extractMediaContent(msg: MetaInboundMessage): ExtractedInboundContent | null {
  const omniType = MEDIA_TYPE_MAP[msg.type];
  if (!omniType) return null;

  const mediaField = getInboundMediaField(msg);
  if (!mediaField) return null;

  return {
    type: omniType,
    mediaId: mediaField.id,
    mimeType: mediaField.mime_type,
    caption: mediaField.caption,
    filename: mediaField.filename,
    isVoiceNote: msg.type === 'audio' ? mediaField.voice === true : undefined,
  };
}

/**
 * Best-effort severity inference for Meta WABA-scoped webhook fields.
 *
 * Meta does not include a uniform severity field across its alert webhooks;
 * we infer from the event semantics:
 *   - quality_rating dropping to `RED` → critical
 *   - quality_rating dropping to `YELLOW` → warning
 *   - account_update with `event === 'BANNED'` / `'DISABLED'` → critical
 *   - account_alerts with `alert_info.alert_type === 'compliance_issue'` etc. → warning
 *   - phone_number_name_update → info (name approvals/rejections are operational)
 * Anything else falls back to 'info'.
 */
function inferAlertSeverity(
  alertType: EventPayloadMap['channel.alert']['alertType'],
  alertInfo: Record<string, unknown>,
  value: Record<string, unknown>,
): AlertSeverity {
  if (alertType === 'phone_number_quality_update') {
    return inferQualityUpdateSeverity(value);
  }
  if (alertType === 'account_update') {
    return inferAccountUpdateSeverity(value);
  }
  if (alertType === 'account_alerts') {
    return inferAccountAlertsSeverity(alertInfo);
  }
  return 'info';
}

type AlertSeverity = 'info' | 'warning' | 'critical';

function inferQualityUpdateSeverity(value: Record<string, unknown>): AlertSeverity {
  const rating = (value.current_quality ?? value.event ?? '').toString().toUpperCase();
  if (rating === 'RED') return 'critical';
  if (rating === 'YELLOW') return 'warning';
  return 'info';
}

function inferAccountUpdateSeverity(value: Record<string, unknown>): AlertSeverity {
  const evt = (value.event ?? '').toString().toUpperCase();
  if (evt.includes('BAN') || evt.includes('DISABLE') || evt.includes('SUSPEND')) return 'critical';
  if (evt.includes('WARN') || evt.includes('RESTRICT')) return 'warning';
  return 'info';
}

function inferAccountAlertsSeverity(alertInfo: Record<string, unknown>): AlertSeverity {
  const sev = (alertInfo.severity ?? alertInfo.alert_severity ?? '').toString().toLowerCase();
  if (sev === 'critical' || sev === 'high') return 'critical';
  if (sev === 'warning' || sev === 'medium') return 'warning';
  return 'warning'; // alerts default to warning — they're meant to be acted on
}

function inferAlertMessage(
  alertType: EventPayloadMap['channel.alert']['alertType'],
  alertInfo: Record<string, unknown>,
  value: Record<string, unknown>,
): string {
  // Prefer a provider-supplied human-readable message when present.
  const explicit =
    (alertInfo.message as string | undefined) ??
    (alertInfo.description as string | undefined) ??
    (value.message as string | undefined);
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;

  switch (alertType) {
    case 'phone_number_quality_update': {
      const prev = value.previous_quality ?? value.event ?? '?';
      const next = value.current_quality ?? '?';
      return `Phone number quality changed from ${prev} to ${next}`;
    }
    case 'account_update':
      return `WABA account status update: ${value.event ?? 'unknown'}`;
    case 'phone_number_name_update':
      return `Verified name update: ${value.decision ?? value.event ?? 'changed'}`;
    case 'account_alerts':
      return `WABA alert: ${alertInfo.alert_type ?? 'see data'}`;
    default:
      return 'Channel alert received';
  }
}

function mapTemplateEventToStatus(
  event: MetaTemplateStatusUpdate['event'],
): 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DELETED' | null {
  switch (event) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'PAUSED':
      return 'PAUSED';
    case 'DISABLED':
      return 'DELETED';
    case 'FLAGGED':
      // FLAGGED is informational — templates remain APPROVED but with warning.
      // We surface as PAUSED to signal "do not use" without inventing a new
      // status value.
      return 'PAUSED';
  }
}
