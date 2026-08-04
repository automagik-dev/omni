/**
 * Hermes (Mutant) channel plugin.
 *
 * Implements `BaseChannelPlugin` for the Hermes WhatsApp gateway
 * (mutant.com.br):
 *   - Outbound via REST (`POST /api/v2/messages`, JWT bearer auth with a
 *     single re-sign-in retry on 401).
 *   - Inbound via per-instance webhook
 *     (`POST /api/v2/channels/hermes/:instanceId/webhook`) — Hermes has NO
 *     signature mechanism; the payload `media_id` is cross-checked against
 *     the instance's configured line UUID instead.
 *   - 24h messaging window enforced upstream by Meta — only namespaced HSM
 *     templates ship outside it. No typing indicator.
 *
 * Per-instance state: `HermesClient` (scoped to one line media_id +
 * username/password) + dedupe cache keyed by `wamid`.
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
import type { HermesContact, MetaInboundMessage, MetaWebhookStatusEntry } from '@omni/core/schemas';
import type { ChannelType, ContentType } from '@omni/core/types';

import { HERMES_CAPABILITIES } from './capabilities';
import { HermesClient } from './client';
import { handleHermesWebhookRequest } from './handlers/webhook';
import {
  sendContact,
  sendLocation,
  sendLocationRequest,
  sendMedia,
  sendPlannedInteractive,
  sendReaction,
  sendTemplate,
  sendText,
} from './senders';
import type { HermesConfig, HermesSendResponse } from './types';
import { HermesApiError, HermesErrorCode } from './utils/errors';

const HERMES_MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'document', 'sticker']);

/**
 * SDK download guard for inbound media. Hermes webhooks carry a DIRECT
 * `file` download URL (24h-lived S3 link) — the guard caps the response
 * size before the body is pulled into memory (see `downloadInboundMedia`).
 */
const downloadGuard = createDownloadGuard();

interface HermesInstanceState {
  client: HermesClient;
  config: HermesConfig;
  dedupeCache: DedupeCache;
}

export class HermesPlugin extends BaseChannelPlugin {
  readonly id = 'hermes' as ChannelType;
  readonly name = 'WhatsApp (H3rmes / Mutant)';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = HERMES_CAPABILITIES;

  /** instanceId → live state */
  private hermesInstances = new Map<string, HermesInstanceState>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('Hermes plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.hermesInstances) {
      state.dedupeCache.dispose();
    }
    this.hermesInstances.clear();
    this.logger.info('Hermes plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect an instance using the persisted Hermes config.
   *
   * `config.credentials` (fallback `config.options`) is expected to carry:
   *   - hermesBaseUrl (required)
   *   - hermesUsername / hermesPassword (required)
   *   - hermesMediaId (required — the line UUID)
   *   - hermesTemplateNamespace (optional — HSM sends)
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const hermesConfig = readHermesConfig(config);

    this.logger.info('Connecting Hermes instance', {
      instanceId,
      baseUrl: hermesConfig.baseUrl,
      mediaId: hermesConfig.mediaId,
    });

    const client = new HermesClient({
      baseUrl: hermesConfig.baseUrl,
      username: hermesConfig.username,
      password: hermesConfig.password,
      mediaId: hermesConfig.mediaId,
    });

    // Validate the credentials by performing a sign_in.
    const reachable = await client.ping();
    if (!reachable) {
      throw new HermesApiError(
        HermesErrorCode.AUTH_FAILED,
        'Hermes sign_in rejected or unreachable — check hermesUsername/hermesPassword/hermesBaseUrl',
        { operation: 'connect' },
      );
    }

    const dedupeCache = createInboundDedupeCache();
    this.hermesInstances.set(instanceId, { client, config: hermesConfig, dedupeCache });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Connected via Hermes (Mutant) gateway',
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: 'Hermes WhatsApp',
      ownerIdentifier: hermesConfig.mediaId,
    });

    this.logger.info('Hermes instance connected', { instanceId, mediaId: hermesConfig.mediaId });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting Hermes instance', { instanceId });

    const state = this.hermesInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.hermesInstances.delete(instanceId);
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
    const state = this.hermesInstances.get(instanceId);
    if (!state) {
      return {
        success: false,
        error: 'Hermes instance not connected',
        retryable: false,
        timestamp: Date.now(),
      };
    }

    const { content, to, replyTo, metadata } = message;

    // Journey timing: T10 (pluginSentAt) right before the Hermes API call.
    const correlationId = metadata?.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const dispatched = await dispatchOutbound(state, message, this.logger);
      if (!dispatched.ok) {
        return { success: false, error: dispatched.error, retryable: false, timestamp: Date.now() };
      }

      // Journey timing: T11 (platformDeliveredAt) once Hermes acknowledged the send.
      if (correlationId) this.captureT11(correlationId);

      // Hermes returns `message.id` (its UUID) on every successful send — it
      // is what later `statuses[].id` webhook entries reference, so a missing
      // id is a malformed response, not something to paper over with a
      // fabricated id (that would break status correlation downstream).
      const messageId = dispatched.response.message?.id;
      if (!messageId) {
        const err = 'Hermes did not return a message id on successful send (malformed response)';
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
      const isHermes = err instanceof HermesApiError;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const retryable = isHermes ? err.retryable : false;

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      return {
        success: false,
        error: errorMessage,
        errorCode: isHermes ? err.channelCode : undefined,
        retryable,
        timestamp: Date.now(),
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook
  // ─────────────────────────────────────────────────────────────

  /**
   * Per-instance webhook entry point. The route
   * (`POST /api/v2/channels/hermes/:instanceId/webhook`) passes the raw
   * request through; the instance id is extracted from the path (same
   * pattern as Gupshup). Body parsing/validation + the `media_id`
   * cross-check live in `handlers/webhook.ts`.
   */
  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.indexOf('hermes') + 1] ?? '';
    return handleHermesWebhookRequest(request, this, instanceId);
  }

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  override async getHealth(instanceId?: string): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];
    const single = instanceId ? this.hermesInstances.get(instanceId) : undefined;
    const states: Array<readonly [string, HermesInstanceState]> = instanceId
      ? single
        ? [[instanceId, single] as const]
        : []
      : Array.from(this.hermesInstances.entries());

    for (const [id, state] of states) {
      const ok = await state.client.ping();
      checks.push({
        name: `hermes:${id}`,
        status: ok ? 'pass' : 'fail',
        message: ok
          ? `Line ${state.config.mediaId} reachable`
          : `Line ${state.config.mediaId} unreachable — sign_in rejected or network error`,
      });
    }

    return {
      status: checks.length === 0 || checks.every((c) => c.status === 'pass') ? 'healthy' : 'unhealthy',
      checks,
      checkedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported — Hermes does not expose backfill).
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }

  // ─────────────────────────────────────────────────────────────
  // Reactions (implements ChannelPlugin.react / ChannelPlugin.unreact)
  // ─────────────────────────────────────────────────────────────

  /** Add a reaction emoji to a message (`messageId` = inbound wamid or Hermes UUID). */
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const state = this.requireInstanceState(instanceId, 'react');
    await sendReaction(state.client, chatId, messageId, emoji);
  }

  /** Remove a reaction — Hermes removes it when an empty emoji is sent for the same message id. */
  async unreact(instanceId: string, chatId: string, messageId: string, _emoji: string): Promise<void> {
    const state = this.requireInstanceState(instanceId, 'unreact');
    await sendReaction(state.client, chatId, messageId, '');
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound media download
  // ─────────────────────────────────────────────────────────────

  /**
   * Download an inbound media attachment from the DIRECT `file` URL that
   * Hermes attaches to media webhooks (24h-lived S3 link — no media-lookup
   * API dance needed). The SDK download guard checks Content-Length before
   * the body is pulled into memory (throws `DownloadTooLargeError`).
   */
  async downloadInboundMedia(instanceId: string, fileUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    this.requireInstanceState(instanceId, 'downloadInboundMedia');

    let parsed: URL;
    try {
      parsed = new URL(fileUrl);
    } catch {
      throw new HermesApiError(HermesErrorCode.INVALID_REQUEST, 'Invalid inbound media file URL', {
        operation: 'downloadInboundMedia',
      });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new HermesApiError(HermesErrorCode.INVALID_REQUEST, 'Inbound media file URL must be http(s)', {
        operation: 'downloadInboundMedia',
      });
    }

    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new HermesApiError(
        HermesErrorCode.UPSTREAM_ERROR,
        `Failed to download inbound media (HTTP ${res.status}) — Hermes file links expire after 24h`,
        { httpStatus: res.status, operation: 'downloadInboundMedia' },
      );
    }
    downloadGuard.checkResponse(res, this.logger, { instanceId, url: fileUrl, channel: 'hermes' });
    const bytes = await res.arrayBuffer();
    const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
    return { buffer: Buffer.from(bytes), mimeType };
  }

  /** Live state for `instanceId`, or throw `HERMES_NOT_CONNECTED`. */
  private requireInstanceState(instanceId: string, operation: string): HermesInstanceState {
    const state = this.hermesInstances.get(instanceId);
    if (!state) {
      throw new HermesApiError(HermesErrorCode.NOT_CONNECTED, 'Hermes instance not connected', { operation });
    }
    return state;
  }

  // ─────────────────────────────────────────────────────────────
  // Public accessors used by the webhook handler
  // ─────────────────────────────────────────────────────────────

  /** Look up the live state for an instance — used by the webhook handler. */
  getInstanceState(instanceId: string): HermesInstanceState | undefined {
    return this.hermesInstances.get(instanceId);
  }

  getLogger(): Logger {
    return this.logger;
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound handlers (called by handlers/webhook.ts)
  //
  // Public wrappers around the protected emit* helpers exposed by
  // BaseChannelPlugin — same pattern as the whatsapp-business sibling: all
  // event-emission logic stays inside the plugin class so the webhook
  // handler remains a pure dispatcher.
  // ─────────────────────────────────────────────────────────────

  /**
   * Emit `message.received` (or `reaction.received`/`reaction.removed`) from
   * a parsed Hermes inbound message, after dedupe.
   *
   * Returns `true` when an event was published, `false` when the message was
   * a duplicate or had no extractable content.
   */
  async handleInboundMessage(
    instanceId: string,
    msg: MetaInboundMessage,
    contacts: HermesContact[] | undefined,
    dedupeCache: DedupeCache,
  ): Promise<boolean> {
    const wamid = msg.id;

    if (dedupeCache.isDuplicate(instanceId, wamid, 'hermes', this.logger)) {
      this.logger.debug('[hermes] duplicate inbound dropped', { instanceId, wamid });
      return false;
    }

    if (msg.type === 'reaction') {
      await this.handleInboundReaction(instanceId, msg);
      return true;
    }

    const content = extractInboundContent(msg);
    if (!content) {
      this.logger.warn('[hermes] inbound message has no extractable content', {
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
        hermes: msg as unknown as Record<string, unknown>,
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
   * emoji is empty — same "empty emoji removes" semantics as Meta).
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
        this.logger.warn('[hermes] inbound text rejected by sanitizer', {
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
   * Emit the appropriate `message.*` event for a Hermes status update.
   * `status.id` is the Hermes UUID returned by the original send.
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
        // when Hermes acknowledged the POST. Emitting again would duplicate
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
        const errorMessage = firstError?.message ?? firstError?.title ?? 'Hermes reported delivery failure';
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

type OutboundDispatchResult = { ok: true; response: HermesSendResponse } | { ok: false; error: string };

/**
 * Route an outgoing message to the matching sender by `content.type`.
 *
 * Returns `{ ok: false }` for unsupported types or missing template
 * metadata — `sendMessage` surfaces that as a non-retryable `SendResult`
 * without emitting `message.failed` (nothing was attempted against the
 * Hermes API). Sender failures propagate as thrown `HermesApiError`s.
 */
async function dispatchOutbound(
  state: HermesInstanceState,
  message: OutgoingMessage,
  logger?: Logger,
): Promise<OutboundDispatchResult> {
  const { client } = state;
  const { content, to, replyTo } = message;

  if (content.type === 'text') {
    return dispatchOutboundText(client, message, logger);
  }
  if (content.type === 'location_request') {
    return { ok: true, response: await sendLocationRequest(client, to, resolveOutboundText(message), replyTo) };
  }
  if (HERMES_MEDIA_TYPES.has(content.type)) {
    return dispatchOutboundMedia(client, message);
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
  if (content.type === 'template') {
    return dispatchOutboundTemplate(state, message);
  }
  return { ok: false, error: `Unsupported content.type=${content.type} for hermes` };
}

/**
 * Markdown → WhatsApp syntax, honoring the instance's `messageFormatMode`
 * (same contract as the whatsapp-business and baileys channels — without it
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
  client: HermesClient,
  message: OutgoingMessage,
  logger?: Logger,
): Promise<OutboundDispatchResult> {
  const { content, to, replyTo } = message;
  const formatted = resolveOutboundText(message);

  if (!content.buttons?.length) {
    return { ok: true, response: await sendText(client, to, formatted, replyTo) };
  }

  const plan = planInteractive(formatted, content.buttons, content.list?.buttonLabel ?? 'Options', {
    sectionTitle: content.list?.sectionTitle,
    forceList: content.list?.forceList,
  });
  if (plan.droppedRows > 0) {
    logger?.warn('[hermes] interactive list capped at 10 rows — extra buttons dropped', {
      to,
      droppedRows: plan.droppedRows,
    });
  }
  const response = plan.interactive
    ? await sendPlannedInteractive(client, to, plan.interactive, replyTo)
    : await sendText(client, to, plan.body, replyTo);
  return { ok: true, response };
}

/**
 * Media dispatch: prefer the public `mediaUrl` (Hermes fetches it); fall
 * back to reading `localPath` bytes and uploading via POST /api/v2/upload.
 */
async function dispatchOutboundMedia(client: HermesClient, message: OutgoingMessage): Promise<OutboundDispatchResult> {
  const { content, to, replyTo } = message;
  const caption = content.caption ?? content.text;

  if (content.mediaUrl) {
    const response = await sendMedia(client, to, { url: content.mediaUrl }, content.mimeType, caption, replyTo);
    return { ok: true, response };
  }
  if (content.localPath) {
    const bytes = await Bun.file(content.localPath).arrayBuffer();
    const response = await sendMedia(client, to, { bytes }, content.mimeType, caption, replyTo);
    return { ok: true, response };
  }
  return { ok: false, error: `Media send requires content.mediaUrl or content.localPath (type=${content.type})` };
}

/**
 * Template descriptor is carried via `metadata.template` (same convention
 * as whatsapp-business). The namespace comes from the instance config
 * (`hermesTemplateNamespace`) unless the descriptor overrides it.
 */
async function dispatchOutboundTemplate(
  state: HermesInstanceState,
  message: OutgoingMessage,
): Promise<OutboundDispatchResult> {
  const { to, replyTo, metadata } = message;
  const tpl = (metadata?.template ?? {}) as {
    name?: string;
    language?: string;
    namespace?: string;
    bodyParameters?: string[];
  };
  if (!tpl.name) {
    return { ok: false, error: 'template send requires metadata.template.name' };
  }
  const namespace = tpl.namespace ?? state.config.templateNamespace;
  if (!namespace) {
    return {
      ok: false,
      error: 'template send requires hermesTemplateNamespace on the instance (or metadata.template.namespace)',
    };
  }
  const response = await sendTemplate(
    state.client,
    to,
    {
      namespace,
      name: tpl.name,
      language: tpl.language ?? 'pt_BR',
      bodyParameters: tpl.bodyParameters,
    },
    replyTo,
  );
  return { ok: true, response };
}

/** Read + validate the Hermes credential block from an InstanceConfig. */
function readHermesConfig(config: InstanceConfig): HermesConfig {
  const creds = (config.credentials ?? {}) as Record<string, unknown>;
  const opts = (config.options ?? {}) as Record<string, unknown>;
  const pick = (key: string): string | undefined => (creds[key] ?? opts[key]) as string | undefined;

  const baseUrl = pick('hermesBaseUrl');
  const username = pick('hermesUsername');
  const password = pick('hermesPassword');
  const mediaId = pick('hermesMediaId');
  const templateNamespace = pick('hermesTemplateNamespace');

  if (!baseUrl) {
    throw new HermesApiError(HermesErrorCode.INVALID_REQUEST, 'hermesBaseUrl is required to connect a hermes instance');
  }
  if (!username || !password) {
    throw new HermesApiError(
      HermesErrorCode.AUTH_FAILED,
      'hermesUsername and hermesPassword are required to connect a hermes instance',
    );
  }
  if (!mediaId) {
    throw new HermesApiError(
      HermesErrorCode.INVALID_REQUEST,
      'hermesMediaId (line UUID) is required to connect a hermes instance',
    );
  }

  return { baseUrl, username, password, mediaId, templateNamespace };
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
 * Extract a normalized content envelope from a Hermes inbound message
 * (Cloud-API-shaped). Media messages carry a DIRECT `file` download URL —
 * surfaced as `mediaUrl` (no media-lookup API dance, unlike Meta).
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
    // Hermes attaches a DIRECT download URL (`file`) — expires after 24h.
    mediaUrl: mediaField.file,
    mediaId: mediaField.id,
    mimeType: mediaField.mime_type,
    caption: mediaField.caption,
    filename: mediaField.filename,
    isVoiceNote: msg.type === 'audio' ? mediaField.voice === true : undefined,
  };
}
