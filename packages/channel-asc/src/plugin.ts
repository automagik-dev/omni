/**
 * ASC Brazil (ASCWhats GW) channel plugin.
 *
 * Implements `BaseChannelPlugin` for the ASC WhatsApp BSP gateway
 * (apigw.ascbrazil.com.br), a thin proxy over the WhatsApp Cloud API:
 *   - Outbound via REST (`POST /api/v1/messages`, a faithful Graph API
 *     mirror; static `originador` + `asc-token` headers).
 *   - Inbound via per-instance webhook
 *     (`/api/v2/channels/asc/:instanceId/webhook`) — payloads are OFFICIAL
 *     Meta Cloud API webhooks parsed with the shared core schemas. ASC does
 *     not document a signature; an optional verify token (`chave`) guards
 *     the GET challenge and, when echoed, the POST.
 *   - Typing indicator via `POST /api/v1/sendTypingIndicator` — Cloud API
 *     semantics: requires the wamid of the newest RECEIVED message, so the
 *     plugin remembers one per chat (same pattern as whatsapp-business).
 *
 * Per-instance state: `AscClient` (scoped to one originador + token) +
 * dedupe cache keyed by `wamid` + the last-inbound-wamid map.
 */

import {
  BaseChannelPlugin,
  createDownloadGuard,
  createInboundDedupeCache,
  planInteractive,
  sanitizeMessage,
} from '@omni/channel-sdk';
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
import type { MetaInboundMessage, MetaWebhookStatusEntry } from '@omni/core/schemas';
import type { ChannelType, ContentType } from '@omni/core/types';

import { ASC_CAPABILITIES } from './capabilities';
import { AscClient } from './client';
import { handleAscWebhookRequest } from './handlers/webhook';
import type { AscConfig, AscOutboundMessage, AscSendResponse, AscTemplatePayload } from './types';
import { AscApiError, AscErrorCode } from './utils/errors';
import { toAscPhone } from './utils/identity';

const ASC_MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'document', 'sticker']);

/**
 * SDK download guard for inbound media. ASC's media lookup
 * (`GET /api/v1/getDownloadMedia/{id}`) reports `file_size` — the guard
 * rejects oversized payloads before any bytes are pulled into memory
 * (see `downloadInboundMedia`).
 */
const downloadGuard = createDownloadGuard();

/** Cap on remembered chats per instance — oldest insertion evicted beyond it. */
const MAX_TYPING_WAMID_CHATS = 1000;

interface AscInstanceState {
  client: AscClient;
  config: AscConfig;
  dedupeCache: DedupeCache;
  /**
   * chat (digits-only phone) → wamid of the newest inbound message. ASC's
   * typing indicator (Cloud API semantics) can only reference a RECEIVED
   * message id, so we remember one per chat (`sendTyping` looks it up here).
   */
  lastInboundWamid: Map<string, string>;
}

export class AscPlugin extends BaseChannelPlugin {
  readonly id = 'asc' as ChannelType;
  readonly name = 'ASC WhatsApp';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = ASC_CAPABILITIES;

  /** instanceId → live state */
  private ascInstances = new Map<string, AscInstanceState>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('ASC plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.ascInstances) {
      state.dedupeCache.dispose();
    }
    this.ascInstances.clear();
    this.logger.info('ASC plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect an instance using the persisted ASC config.
   *
   * `config.credentials` (fallback `config.options`) is expected to carry:
   *   - ascToken (required)
   *   - ascOriginador (required — WABA phone, digits-only E.164)
   *   - ascBaseUrl (optional — defaults to the ASC production gateway)
   *   - webhookVerifyToken (optional — the `chave` registered via setWebhook)
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const ascConfig = readAscConfig(config);

    this.logger.info('Connecting ASC instance', {
      instanceId,
      baseUrl: ascConfig.baseUrl,
      originador: ascConfig.originador,
    });

    const client = new AscClient({
      baseUrl: ascConfig.baseUrl,
      originador: ascConfig.originador,
      ascToken: ascConfig.ascToken,
    });

    // Validate the credentials with a cheap authenticated read.
    const reachable = await client.ping();
    if (!reachable) {
      throw new AscApiError(
        AscErrorCode.AUTH_FAILED,
        'ASC gateway rejected the credentials or is unreachable — check ascToken/ascOriginador/ascBaseUrl',
        { operation: 'connect' },
      );
    }

    const dedupeCache = createInboundDedupeCache();
    this.ascInstances.set(instanceId, {
      client,
      config: ascConfig,
      dedupeCache,
      lastInboundWamid: new Map(),
    });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Connected via ASC Brazil gateway',
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: 'ASC WhatsApp',
      ownerIdentifier: ascConfig.originador,
    });

    this.logger.info('ASC instance connected', { instanceId, originador: ascConfig.originador });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting ASC instance', { instanceId });

    const state = this.ascInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.ascInstances.delete(instanceId);
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
    const state = this.ascInstances.get(instanceId);
    if (!state) {
      return {
        success: false,
        error: 'ASC instance not connected',
        retryable: false,
        timestamp: Date.now(),
      };
    }

    const { content, to, replyTo, metadata } = message;

    // Journey timing: T10 (pluginSentAt) right before the ASC API call.
    const correlationId = metadata?.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const dispatched = await dispatchOutbound(state, message, this.logger);
      if (!dispatched.ok) {
        return { success: false, error: dispatched.error, retryable: false, timestamp: Date.now() };
      }

      // Journey timing: T11 (platformDeliveredAt) once ASC acknowledged the send.
      if (correlationId) this.captureT11(correlationId);

      // ASC mirrors the Graph response: `messages[0].id` is the wamid that
      // later `statuses[].id` webhook entries reference — a missing id is a
      // malformed response, not something to paper over with a fabricated id
      // (that would break status correlation downstream).
      const messageId = dispatched.response.messages?.[0]?.id;
      if (!messageId) {
        const err = 'ASC did not return a message id on successful send (malformed response)';
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
      const isAsc = err instanceof AscApiError;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const retryable = isAsc ? err.retryable : false;

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      return {
        success: false,
        error: errorMessage,
        errorCode: isAsc ? err.channelCode : undefined,
        retryable,
        timestamp: Date.now(),
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook
  // ─────────────────────────────────────────────────────────────

  /**
   * Per-instance webhook entry point. The routes
   * (`GET|POST /api/v2/channels/asc/:instanceId/webhook`) pass the raw
   * request through; the instance id is extracted from the path (same
   * pattern as Gupshup/Hermes). GET handles the Meta-style challenge echo.
   */
  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.indexOf('asc') + 1] ?? '';

    const state = this.ascInstances.get(instanceId);
    if (!state) {
      return new Response('Instance not found', { status: 404 });
    }

    return handleAscWebhookRequest(request, this, instanceId, state.config.webhookVerifyToken);
  }

  // ─────────────────────────────────────────────────────────────
  // Typing indicator (implements ChannelPlugin.sendTyping)
  // ─────────────────────────────────────────────────────────────

  /**
   * Show the typing indicator in `chatId`.
   *
   * ASC (Cloud API semantics) has no free-standing presence endpoint — the
   * indicator is sent by referencing the newest RECEIVED message, which is
   * also marked as read, and it self-dismisses on reply or after ~25s.
   * Consequences honored here:
   *   - Needs a remembered inbound wamid for the chat (`lastInboundWamid`,
   *     recorded by `handleInboundMessage`). No wamid → silent no-op, per
   *     the sendTyping contract.
   *   - `duration` cannot be enforced and `duration === 0` (stop) cannot be
   *     expressed — both are accepted and ignored.
   */
  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    if (duration === 0) return; // No "stop typing" — it self-dismisses.

    const state = this.ascInstances.get(instanceId);
    if (!state) return; // Contract: typing is best-effort; never throw from here.

    const wamid = state.lastInboundWamid.get(toAscPhone(chatId));
    if (!wamid) {
      this.logger.debug('[asc] sendTyping skipped — no inbound wamid remembered for chat', {
        instanceId,
        chatId,
      });
      return;
    }

    try {
      await state.client.sendTypingIndicator(wamid);
    } catch (err) {
      this.logger.debug('[asc] sendTyping failed (best-effort, ignored)', {
        instanceId,
        chatId,
        err: String(err),
      });
    }
  }

  /**
   * Remember the newest inbound wamid for a chat so `sendTyping` can
   * reference it. Bounded FIFO per instance: beyond `MAX_TYPING_WAMID_CHATS`
   * chats the oldest-inserted entry is evicted (re-inserting on every
   * message keeps active chats near the young end).
   */
  private rememberInboundWamid(state: AscInstanceState, from: string, wamid: string): void {
    const chatKey = toAscPhone(from);
    state.lastInboundWamid.delete(chatKey);
    state.lastInboundWamid.set(chatKey, wamid);
    if (state.lastInboundWamid.size > MAX_TYPING_WAMID_CHATS) {
      const oldest = state.lastInboundWamid.keys().next().value;
      if (oldest !== undefined) state.lastInboundWamid.delete(oldest);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Read receipts (implements ChannelPlugin.markAsRead)
  // ─────────────────────────────────────────────────────────────

  /**
   * Mark inbound messages as read via `POST /api/v1/markRead`. Best-effort:
   * uses the wamids from `messageData` when the runtime supplies them,
   * otherwise falls back to the newest remembered inbound wamid for the
   * chat (which covers the `['all']` form — Cloud API read receipts are
   * cumulative up to the referenced message).
   */
  async markAsRead(
    instanceId: string,
    chatId: string,
    messageIds: string[],
    messageData?: Array<{ externalId: string; rawPayload?: Record<string, unknown> | null }>,
  ): Promise<void> {
    const state = this.ascInstances.get(instanceId);
    if (!state) return;

    const candidates = messageData?.map((m) => m.externalId) ?? messageIds;
    let wamids = candidates.filter((id) => id.startsWith('wamid.'));
    if (wamids.length === 0) {
      const last = state.lastInboundWamid.get(toAscPhone(chatId));
      wamids = last ? [last] : [];
    }

    for (const wamid of wamids) {
      try {
        await state.client.markRead(wamid);
      } catch (err) {
        this.logger.debug('[asc] markRead failed (best-effort, ignored)', {
          instanceId,
          chatId,
          err: String(err),
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Reactions (implements ChannelPlugin.react / ChannelPlugin.unreact)
  // ─────────────────────────────────────────────────────────────

  /** Add a reaction emoji to a message (`messageId` is the target wamid). */
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const state = this.requireInstanceState(instanceId, 'react');
    await state.client.reactMessage(toAscPhone(chatId), messageId, emoji);
  }

  /** Remove a reaction — Cloud API removes it when an empty emoji is sent for the same wamid. */
  async unreact(instanceId: string, chatId: string, messageId: string, _emoji: string): Promise<void> {
    const state = this.requireInstanceState(instanceId, 'unreact');
    await state.client.reactMessage(toAscPhone(chatId), messageId, '');
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound media download
  // ─────────────────────────────────────────────────────────────

  /**
   * Resolve and download an inbound media attachment by media id. Inbound
   * webhooks carry only a media id (surfaced in `rawPayload.mediaId` by
   * `handleInboundMessage`) — the bytes live behind ASC's download proxy.
   * The SDK download guard checks the `file_size` the lookup reports before
   * any bytes are pulled into memory (throws `DownloadTooLargeError`).
   */
  async downloadInboundMedia(instanceId: string, mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const state = this.requireInstanceState(instanceId, 'downloadInboundMedia');

    const info = await state.client.getMediaInfo(mediaId);
    if (typeof info.file_size === 'number') {
      downloadGuard.checkSize(info.file_size, this.logger, { instanceId, url: info.url, channel: 'asc' });
    }
    const { bytes, mimeType } = await state.client.downloadMedia(mediaId);
    return { buffer: Buffer.from(bytes), mimeType: info.mime_type ?? mimeType };
  }

  /** Live state for `instanceId`, or throw `ASC_NOT_CONNECTED`. */
  private requireInstanceState(instanceId: string, operation: string): AscInstanceState {
    const state = this.ascInstances.get(instanceId);
    if (!state) {
      throw new AscApiError(AscErrorCode.NOT_CONNECTED, 'ASC instance not connected', { operation });
    }
    return state;
  }

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  override async getHealth(instanceId?: string): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];
    const single = instanceId ? this.ascInstances.get(instanceId) : undefined;
    const states: Array<readonly [string, AscInstanceState]> = instanceId
      ? single
        ? [[instanceId, single] as const]
        : []
      : Array.from(this.ascInstances.entries());

    for (const [id, state] of states) {
      const ok = await state.client.ping();
      checks.push({
        name: `asc:${id}`,
        status: ok ? 'pass' : 'fail',
        message: ok
          ? `Originador ${state.config.originador} reachable`
          : `Originador ${state.config.originador} unreachable — token rejected or network error`,
      });
    }

    return {
      status: checks.length === 0 || checks.every((c) => c.status === 'pass') ? 'healthy' : 'unhealthy',
      checks,
      checkedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported — ASC does not expose backfill).
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }

  // ─────────────────────────────────────────────────────────────
  // Public accessors used by the webhook handler
  // ─────────────────────────────────────────────────────────────

  /** Look up the live state for an instance — used by the webhook handler. */
  getInstanceState(instanceId: string): AscInstanceState | undefined {
    return this.ascInstances.get(instanceId);
  }

  getLogger(): Logger {
    return this.logger;
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound handlers (called by handlers/webhook.ts)
  //
  // Public wrappers around the protected emit* helpers exposed by
  // BaseChannelPlugin — same pattern as the whatsapp-business/hermes
  // siblings: all event-emission logic stays inside the plugin class so
  // the webhook handler remains a pure dispatcher.
  // ─────────────────────────────────────────────────────────────

  /**
   * Emit `message.received` (or `reaction.received`/`reaction.removed`)
   * from a parsed Meta-format inbound message, after dedupe.
   *
   * Returns `true` when an event was published, `false` when the message
   * was a duplicate or had no extractable content.
   */
  async handleInboundMessage(
    instanceId: string,
    msg: MetaInboundMessage,
    contacts: Array<{ profile?: { name?: string }; wa_id?: string }> | undefined,
    dedupeCache: DedupeCache,
  ): Promise<boolean> {
    const wamid = msg.id;

    if (dedupeCache.isDuplicate(instanceId, wamid, 'asc', this.logger)) {
      this.logger.debug('[asc] duplicate inbound dropped', { instanceId, wamid });
      return false;
    }

    if (msg.type === 'reaction') {
      await this.handleInboundReaction(instanceId, msg);
      return true;
    }

    const state = this.ascInstances.get(instanceId);
    if (state) this.rememberInboundWamid(state, msg.from, wamid);

    const content = extractInboundContent(msg);
    if (!content) {
      this.logger.warn('[asc] inbound message has no extractable content', {
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
        // ASC defers the media download like Meta Cloud — the webhook
        // carries only a media id, not a public URL. Surface it on the
        // event so the media pipeline can materialize the bytes via
        // `downloadInboundMedia`.
        mediaId: content.mediaId,
        mimeType: content.mimeType,
        isVoiceNote: content.isVoiceNote,
      },
      replyToId,
      rawPayload: {
        asc: msg as unknown as Record<string, unknown>,
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
   * emoji is empty — Cloud API uses empty emoji as "reaction removed").
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
   * Mutates `content` in place; returns `false` when the sanitizer rejects
   * the message (null bytes / oversized) — the caller drops it.
   */
  private sanitizeInboundContent(instanceId: string, wamid: string, content: ExtractedInboundContent): boolean {
    for (const field of ['text', 'caption'] as const) {
      const value = content[field];
      if (!value) continue;
      const sanitized = sanitizeMessage(value, this.logger, { instanceId, messageId: wamid });
      if (!sanitized.ok) {
        this.logger.warn('[asc] inbound text rejected by sanitizer', {
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
   * Emit the appropriate `message.*` event for a Meta-format status update.
   * `status.id` is the wamid returned by the original send.
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
    const recipientId = status.recipient_id;

    switch (status.status) {
      case 'sent':
        // Intentionally no-op — `sendMessage` already emitted `message.sent`
        // when ASC acknowledged the POST. Emitting again would duplicate
        // the event downstream.
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
        const errorMessage = firstError?.message ?? firstError?.title ?? 'ASC reported delivery failure';
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
}

// ─────────────────────────────────────────────────────────────────────────
// Module-level helpers — pure, no plugin state (Biome cognitive-complexity
// budget: sendMessage stays a thin orchestrator, dispatch lives here).
// ─────────────────────────────────────────────────────────────────────────

type OutboundDispatchResult = { ok: true; response: AscSendResponse } | { ok: false; error: string };

/** Base envelope shared by every /api/v1/messages payload. */
function basePayload(to: string, type: AscOutboundMessage['type'], replyTo?: string): AscOutboundMessage {
  const payload: AscOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toAscPhone(to),
    type,
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return payload;
}

/**
 * Route an outgoing message to the matching payload builder by
 * `content.type` and POST it through the single /api/v1/messages endpoint.
 *
 * Returns `{ ok: false }` for unsupported types or missing template
 * metadata — `sendMessage` surfaces that as a non-retryable `SendResult`
 * without emitting `message.failed` (nothing was attempted against the ASC
 * API). API failures propagate as thrown `AscApiError`s.
 */
async function dispatchOutbound(
  state: AscInstanceState,
  message: OutgoingMessage,
  logger?: Logger,
): Promise<OutboundDispatchResult> {
  const { client } = state;
  const { content, to, replyTo } = message;

  if (content.type === 'text') {
    return dispatchOutboundText(client, message, logger);
  }
  if (ASC_MEDIA_TYPES.has(content.type)) {
    return dispatchOutboundMedia(client, message);
  }
  if (content.type === 'location' && content.location) {
    const { latitude, longitude, name, address } = content.location;
    const payload = basePayload(to, 'location', replyTo);
    payload.location = { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) };
    return { ok: true, response: await client.sendMessage(payload) };
  }
  if (content.type === 'contact' && content.contact) {
    const payload = basePayload(to, 'contacts', replyTo);
    payload.contacts = [expandContactCard(content.contact)];
    return { ok: true, response: await client.sendMessage(payload) };
  }
  if (content.type === 'template') {
    return dispatchOutboundTemplate(client, message);
  }
  return { ok: false, error: `Unsupported content.type=${content.type} for asc` };
}

/**
 * Markdown → WhatsApp syntax, honoring the instance's `messageFormatMode`
 * (same contract as the whatsapp-business and hermes channels — without it
 * the agent's `**bold**` reaches the device raw and WhatsApp pairs the
 * asterisks wrong).
 */
function resolveOutboundText(message: OutgoingMessage): string {
  const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
  const text = message.content.text ?? '';
  return formatMode === 'passthrough' ? text : markdownToWhatsApp(text);
}

/**
 * Text content — plain send, or the best-fitting Cloud API interactive type
 * when `content.buttons` is present (shared `planInteractive` mapper: reply
 * buttons ≤3, list 4-10, cta_url for a single URL button). Overflow beyond
 * the 10-row list limit is dropped with a warn log — never silently.
 */
async function dispatchOutboundText(
  client: AscClient,
  message: OutgoingMessage,
  logger?: Logger,
): Promise<OutboundDispatchResult> {
  const { content, to, replyTo } = message;
  const formatted = resolveOutboundText(message);

  if (!content.buttons?.length) {
    const payload = basePayload(to, 'text', replyTo);
    payload.text = { body: formatted, preview_url: false };
    return { ok: true, response: await client.sendMessage(payload) };
  }

  const plan = planInteractive(formatted, content.buttons, content.list?.buttonLabel ?? 'Options', {
    sectionTitle: content.list?.sectionTitle,
    forceList: content.list?.forceList,
  });
  if (plan.droppedRows > 0) {
    logger?.warn('[asc] interactive list capped at 10 rows — extra buttons dropped', {
      to,
      droppedRows: plan.droppedRows,
    });
  }

  if (plan.interactive) {
    const payload = basePayload(to, 'interactive', replyTo);
    payload.interactive = plan.interactive;
    return { ok: true, response: await client.sendMessage(payload) };
  }
  const payload = basePayload(to, 'text', replyTo);
  payload.text = { body: plan.body, preview_url: false };
  return { ok: true, response: await client.sendMessage(payload) };
}

/**
 * Media dispatch via the `link` form (ASC fetches the public URL, like
 * Graph). Captions: image / video / document only — audio + sticker reject
 * them upstream. Filenames: documents only.
 */
async function dispatchOutboundMedia(client: AscClient, message: OutgoingMessage): Promise<OutboundDispatchResult> {
  const { content, to, replyTo } = message;

  if (!content.mediaUrl) {
    return { ok: false, error: `Media send requires content.mediaUrl (type=${content.type})` };
  }

  const kind = content.type as 'image' | 'audio' | 'video' | 'document' | 'sticker';
  const media: { link: string; caption?: string; filename?: string } = { link: content.mediaUrl };

  const caption = content.caption ?? content.text;
  if (caption && (kind === 'image' || kind === 'video' || kind === 'document')) {
    media.caption = caption;
  }
  if (content.filename && kind === 'document') {
    media.filename = content.filename;
  }

  const payload = basePayload(to, kind, replyTo);
  payload[kind] = media;
  return { ok: true, response: await client.sendMessage(payload) };
}

/**
 * Template descriptor is carried via `metadata.template` (same convention
 * as whatsapp-business/hermes). `components` passes through verbatim when
 * present; otherwise `bodyParameters` is expanded into a body component.
 */
async function dispatchOutboundTemplate(client: AscClient, message: OutgoingMessage): Promise<OutboundDispatchResult> {
  const { to, replyTo, metadata } = message;
  const tpl = (metadata?.template ?? {}) as {
    name?: string;
    language?: string;
    components?: unknown[];
    bodyParameters?: string[];
  };
  if (!tpl.name) {
    return { ok: false, error: 'template send requires metadata.template.name' };
  }

  const template: AscTemplatePayload = {
    name: tpl.name,
    language: { code: tpl.language ?? 'pt_BR' },
  };
  if (tpl.components) {
    template.components = tpl.components;
  } else if (tpl.bodyParameters?.length) {
    template.components = [{ type: 'body', parameters: tpl.bodyParameters.map((text) => ({ type: 'text', text })) }];
  }

  const payload = basePayload(to, 'template', replyTo);
  payload.template = template;
  return { ok: true, response: await client.sendMessage(payload) };
}

/** Expand the channel-agnostic contact card into the Cloud API `contacts[]` shape. */
function expandContactCard(contact: { name: string; phone?: string; email?: string }): Record<string, unknown> {
  const record: Record<string, unknown> = { name: { formatted_name: contact.name } };
  if (contact.phone) {
    record.phones = [{ phone: contact.phone, type: 'CELL', wa_id: toAscPhone(contact.phone) }];
  }
  if (contact.email) {
    record.emails = [{ email: contact.email, type: 'WORK' }];
  }
  return record;
}

/** Read + validate the ASC credential block from an InstanceConfig. */
function readAscConfig(config: InstanceConfig): AscConfig {
  const creds = (config.credentials ?? {}) as Record<string, unknown>;
  const opts = (config.options ?? {}) as Record<string, unknown>;
  const pick = (key: string): string | undefined => (creds[key] ?? opts[key]) as string | undefined;

  const ascToken = pick('ascToken');
  const originador = pick('ascOriginador') ?? pick('originador');
  const baseUrl = pick('ascBaseUrl');
  const webhookVerifyToken = pick('webhookVerifyToken');

  if (!ascToken) {
    throw new AscApiError(AscErrorCode.AUTH_FAILED, 'ascToken is required to connect an asc instance');
  }
  if (!originador) {
    throw new AscApiError(
      AscErrorCode.INVALID_REQUEST,
      'ascOriginador (WABA phone number) is required to connect an asc instance',
    );
  }

  return {
    baseUrl: baseUrl ?? 'https://apigw.ascbrazil.com.br',
    originador: toAscPhone(originador),
    ascToken,
    webhookVerifyToken,
  };
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
 * Extract a normalized content envelope from a Meta-format inbound message.
 *
 * Media-bearing messages return only the `mediaId` — the bytes live behind
 * ASC's download proxy and are materialized by `downloadInboundMedia`.
 * Returning `mediaId` keeps the webhook handler synchronous so we don't owe
 * the gateway a 2xx while waiting on an API roundtrip.
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
  if (interactive.type === 'list_reply' && interactive.list_reply) {
    return { type: 'text', text: interactive.list_reply.title };
  }
  return { type: 'text', text: '[interactive]' };
}

/** Pick the media payload matching the message type. */
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
