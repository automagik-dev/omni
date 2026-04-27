/**
 * Microsoft Teams Channel Plugin.
 *
 * Subclasses `BaseChannelPlugin` to claim the `'teams'` channel slot.
 *
 * - Group 3 wires `connect()`, `disconnect()`, and `handleWebhook()`.
 * - Group 4 fills `sendMessage()` with text/media/typing/reaction senders.
 *
 * Inbound auth: every Bot Framework activity arrives signed with a JWT in
 * the `Authorization` header. Validating that JWT is mandatory — without it
 * any caller who knows the webhook URL can forge activities. Per DESIGN §4.2
 * we delegate that validation to `botbuilder`'s `CloudAdapter`, which fetches
 * Microsoft's OpenID metadata, verifies signature/issuer/audience/exp/nbf,
 * and only then invokes our dispatch logic. We adapt the Hono `Request` /
 * `Response` to the minimal Node-compatible shape `CloudAdapter.process`
 * expects.
 *
 * Outbound auth: we keep our custom `BotFrameworkClient` (AAD client-creds +
 * direct REST POSTs) for sending activities. The Bot Framework SDK's outbound
 * stack is significantly heavier and we already own the small wire surface;
 * see `connection/bot-framework-client.ts` for the rationale.
 */

import { BaseChannelPlugin, createDownloadGuard, createInboundDedupeCache } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  DownloadGuard,
  FetchHistoryOptions,
  FetchHistoryResult,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import type { Logger } from '@omni/core';
import type { ChannelType, ContentType } from '@omni/core/types';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
} from 'botbuilder';

import { TEAMS_CAPABILITIES } from './capabilities';
import { BotFrameworkClient, TokenAcquisitionError, validateCredentials } from './connection';
import { type InboundActivity, parseInboundMessage, parseReactionActivity, toActivityMeta } from './handlers';
import {
  type TeamsMediaKind,
  type TeamsSendContext,
  createBotFrameworkSendContext,
  sendMediaMessage,
  sendReaction,
  sendTextMessage,
  sendTyping,
} from './senders';
import type { TeamsActivityMeta, TeamsConfig, TeamsConnectionOptions, TeamsReplyToMode } from './types';
import { TeamsError, TeamsErrorCode } from './types';

/**
 * Minimal shape of `botbuilder`'s `CloudAdapter` we depend on. Typed as an
 * interface (not the concrete class) so tests can swap in a fake adapter
 * without instantiating the real one.
 */
export interface TeamsCloudAdapter {
  process(
    req: { body?: Record<string, unknown>; headers: Record<string, string | string[] | undefined>; method?: string },
    res: TeamsCloudAdapterResponse,
    logic: (turnContext: { activity: unknown }) => Promise<void>,
  ): Promise<void>;
}

export interface TeamsCloudAdapterResponse {
  socket: unknown;
  status(code: number): unknown;
  send(body?: unknown): unknown;
  end(...args: unknown[]): unknown;
  header(name: string, value: unknown): unknown;
}

interface TeamsInstanceState {
  /** Resolved configuration (credentials + tenant + options) */
  config: TeamsConfig;
  /** Bot Framework REST client for outbound calls */
  client: BotFrameworkClient;
  /** Bot Framework adapter that validates inbound JWTs and runs the logic callback. */
  cloudAdapter: TeamsCloudAdapter;
  /** Per-instance inbound dedupe cache */
  dedupeCache: DedupeCache;
  /**
   * Per-instance download guard for inbound attachment fetches. Bot Framework
   * `contentUrl` payloads are bot-bearer-signed but unbounded in size; the
   * guard enforces the SDK contract (size cap + cancel hook).
   */
  downloadGuard: DownloadGuard;
  /** Last-seen `serviceUrl` per conversation id (set on first inbound activity) */
  serviceUrls: Map<string, string>;
  /** Last activity id per conversation (used for sendTyping / replyToMode='all') */
  lastActivityIds: Map<string, string>;
}

export class TeamsPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'teams';
  readonly name = 'Microsoft Teams (Bot Framework)';
  readonly version = '0.1.0';
  readonly capabilities: ChannelCapabilities = TEAMS_CAPABILITIES;

  /** Plugin-specific config per instance */
  protected teamsConfigs = new Map<string, TeamsConfig>();
  /** Active runtime state per instance (client, caches, conversation refs) */
  protected teamsInstances = new Map<string, TeamsInstanceState>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('Teams plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.teamsInstances) {
      state.dedupeCache.dispose();
    }
    this.teamsInstances.clear();
    this.teamsConfigs.clear();
    this.logger.info('Teams plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connect / Disconnect
  // ─────────────────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const teamsConfig = resolveTeamsConfig(instanceId, config);

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connecting',
      since: new Date(),
    });

    const connectionOptions = toConnectionOptions(teamsConfig);

    this.logger.info('Connecting Teams instance', {
      instanceId,
      appId: connectionOptions.appId,
      appType: connectionOptions.appType,
      tenantId: connectionOptions.tenantId,
    });

    // Connect-time credential validation: hit AAD with the bot's app
    // creds. AAD returns 401 for bad client_secret, 400/invalid_client for
    // bad app_id; either is a hard non-retryable AUTH_FAILED.
    try {
      await validateCredentials(connectionOptions);
    } catch (err) {
      await this.updateInstanceStatus(instanceId, config, {
        state: 'error',
        since: new Date(),
        error: {
          code: TeamsErrorCode.AUTH_FAILED,
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
      });
      if (err instanceof TokenAcquisitionError) {
        throw new TeamsError(
          TeamsErrorCode.AUTH_FAILED,
          `Teams credential validation failed (${err.httpStatus}): ${err.message}`,
        );
      }
      throw new TeamsError(
        TeamsErrorCode.AUTH_FAILED,
        `Teams credential validation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const client = new BotFrameworkClient({ options: connectionOptions });
    const cloudAdapter = this.buildCloudAdapter(connectionOptions);
    const dedupeCache = createInboundDedupeCache();
    const downloadGuard = createDownloadGuard({
      maxSizeBytes: TEAMS_CAPABILITIES.maxFileSize,
    });

    this.teamsConfigs.set(instanceId, teamsConfig);
    this.teamsInstances.set(instanceId, {
      config: teamsConfig,
      client,
      cloudAdapter,
      dedupeCache,
      downloadGuard,
      serviceUrls: new Map(),
      lastActivityIds: new Map(),
    });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Connected via Bot Framework',
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: teamsConfig.defaultBotName ?? 'Microsoft Teams Bot',
      ownerIdentifier: connectionOptions.appId,
    });

    this.logger.info('Teams instance connected', { instanceId });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting Teams instance', { instanceId });

    const state = this.teamsInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.teamsInstances.delete(instanceId);
    }
    this.teamsConfigs.delete(instanceId);

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
    const conversationId = message.to;
    const state = this.teamsInstances.get(instanceId);

    if (!state) {
      return this.failOutbound(
        instanceId,
        conversationId,
        new TeamsError(TeamsErrorCode.NOT_CONNECTED, `Teams instance ${instanceId} is not connected`),
      );
    }

    const serviceUrl = state.serviceUrls.get(conversationId) ?? state.config.serviceUrl;
    if (!serviceUrl) {
      return this.failOutbound(
        instanceId,
        conversationId,
        new TeamsError(
          TeamsErrorCode.SEND_FAILED,
          `Teams instance ${instanceId} has no serviceUrl for conversation ${conversationId} — receive an inbound activity first or set TeamsConfig.serviceUrl`,
        ),
      );
    }

    const ctx = createBotFrameworkSendContext({ client: state.client, serviceUrl, conversationId });
    const replyToId = this.resolveReplyToId(state, conversationId, message);
    const correlationId = message.metadata?.correlationId as string | undefined;

    try {
      // T10: record the moment we hand the message off to the platform.
      if (correlationId) this.captureT10(correlationId);

      const messageId = await this.dispatchOutbound(ctx, message, replyToId);

      // T11: record the moment Bot Framework Connector confirms acceptance.
      if (correlationId) this.captureT11(correlationId);

      if (messageId) {
        state.lastActivityIds.set(conversationId, messageId);
      }

      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId: conversationId,
        threadId: message.threadId,
        to: message.to,
        content: { type: message.content.type, text: message.content.text },
        replyToId: message.replyTo,
        senderAgentId: message.metadata?.senderAgentId as string | undefined,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (err) {
      return this.failOutbound(instanceId, conversationId, err);
    }
  }

  /**
   * Send a typing indicator (`Activity.typing`).
   *
   * The optional `duration` parameter is informational only — Bot Framework
   * does not let bots specify a duration on the typing activity. Teams
   * clears the indicator on its own ~10 seconds after the last typing
   * activity or as soon as the bot's next message lands.
   */
  async sendTyping(instanceId: string, chatId: string, _duration?: number): Promise<void> {
    const state = this.teamsInstances.get(instanceId);
    if (!state) {
      throw new TeamsError(TeamsErrorCode.NOT_CONNECTED, `Teams instance ${instanceId} is not connected`);
    }

    const serviceUrl = state.serviceUrls.get(chatId) ?? state.config.serviceUrl;
    if (!serviceUrl) {
      throw new TeamsError(
        TeamsErrorCode.SEND_FAILED,
        `Teams instance ${instanceId} has no serviceUrl for conversation ${chatId} — receive an inbound activity first or set TeamsConfig.serviceUrl`,
      );
    }

    const ctx = createBotFrameworkSendContext({ client: state.client, serviceUrl, conversationId: chatId });
    const replyToId = state.lastActivityIds.get(chatId);
    await sendTyping(ctx, { replyToId }, this.logger);
  }

  /**
   * Add a reaction to a Teams activity (`messageReaction.reactionsAdded`).
   */
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    await this.sendReactionInternal(instanceId, chatId, messageId, emoji, true);
  }

  /**
   * Remove a reaction from a Teams activity (`messageReaction.reactionsRemoved`).
   */
  async unreact(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    await this.sendReactionInternal(instanceId, chatId, messageId, emoji, false);
  }

  private async sendReactionInternal(
    instanceId: string,
    chatId: string,
    messageId: string,
    emoji: string,
    add: boolean,
  ): Promise<void> {
    const state = this.teamsInstances.get(instanceId);
    if (!state) {
      throw new TeamsError(TeamsErrorCode.NOT_CONNECTED, `Teams instance ${instanceId} is not connected`);
    }
    const serviceUrl = state.serviceUrls.get(chatId) ?? state.config.serviceUrl;
    if (!serviceUrl) {
      throw new TeamsError(
        TeamsErrorCode.SEND_FAILED,
        `Teams instance ${instanceId} has no serviceUrl for conversation ${chatId} — receive an inbound activity first or set TeamsConfig.serviceUrl`,
      );
    }
    const ctx = createBotFrameworkSendContext({ client: state.client, serviceUrl, conversationId: chatId });
    await sendReaction(ctx, { targetActivityId: messageId, emoji, add }, this.logger);
  }

  // ─────────────────────────────────────────────────────────────
  // History
  // ─────────────────────────────────────────────────────────────

  /**
   * Bot Framework does not expose a back-fill history API to bots — bots
   * only see activities that arrive while they are subscribed. We return an
   * empty result rather than throwing so the dispatcher's history-sync flow
   * treats Teams as "no prior history" and continues. A follow-up wish may
   * add Microsoft Graph API based history sync (out of scope for v1).
   */
  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { messages: [], totalFetched: 0 };
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle a single Bot Framework activity POST.
   *
   * Path convention (matches gupshup + telegram):
   *   `POST /api/v2/channels/teams/{instanceId}/webhook`
   *
   * The host webhook router strips the prefix and hands us the request as-is.
   *
   * **Auth (CRITICAL):** Bot Framework signs every activity with a JWT in
   * the `Authorization` header. We delegate validation to the per-instance
   * `CloudAdapter` — it fetches Microsoft's OpenID metadata, verifies the
   * signature/issuer/audience/exp/nbf, and only then invokes our dispatch
   * logic. Without this, anyone who learns the webhook URL can forge
   * activities. On failure the adapter writes 401 to the response object;
   * we relay that status back to the caller.
   */
  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const teamsIdx = pathParts.indexOf('teams');
    const instanceId = teamsIdx >= 0 ? (pathParts[teamsIdx + 1] ?? '') : '';

    if (!instanceId) {
      return new Response('Missing instanceId in webhook path', { status: 400 });
    }

    const state = this.teamsInstances.get(instanceId);
    if (!state) {
      return new Response('Instance not connected', { status: 404 });
    }

    // Body parsing is fail-open with 200 — Bot Framework retries 5xx in a
    // tight loop, and a malformed body is almost always a misconfigured
    // probe, not a real retry-worthy condition. Only the JWT path can
    // produce a 401 (and it does so via the adapter's response object).
    let bodyText: string;
    try {
      bodyText = await request.text();
    } catch {
      return new Response('', { status: 200 });
    }

    if (bodyText.length === 0) {
      return new Response('', { status: 200 });
    }
    if (bodyText.length > 1024 * 1024) {
      this.logger.warn('[teams] oversized webhook body rejected', { instanceId, size: bodyText.length });
      return new Response('', { status: 200 });
    }

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      this.logger.warn('[teams] webhook body is not valid JSON', { instanceId, preview: bodyText.slice(0, 256) });
      return new Response('', { status: 200 });
    }
    if (!parsedBody || typeof parsedBody !== 'object') {
      return new Response('', { status: 200 });
    }

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? undefined;

    const fakeReq = {
      body: parsedBody,
      headers: {
        authorization: authHeader,
        'content-type': request.headers.get('content-type') ?? 'application/json',
      } as Record<string, string | string[] | undefined>,
      method: request.method,
    };

    const captured: { status: number; body?: string } = { status: 200 };
    const fakeRes: TeamsCloudAdapterResponse = {
      socket: undefined,
      status(code: number) {
        captured.status = code;
        return fakeRes;
      },
      send(body?: unknown) {
        if (body !== undefined && body !== null) {
          captured.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
        return fakeRes;
      },
      end(..._args: unknown[]) {
        return fakeRes;
      },
      header(_name: string, _value: unknown) {
        return fakeRes;
      },
    };

    try {
      await state.cloudAdapter.process(fakeReq, fakeRes, async (turnContext) => {
        const activity = turnContext.activity as InboundActivity;
        try {
          await this.dispatchActivity(instanceId, activity, state);
        } catch (err) {
          this.logger.error('[teams] activity dispatch failed', {
            instanceId,
            error: err instanceof Error ? err.message : String(err),
            activityType: activity?.type,
            activityId: activity?.id,
          });
        }
      });
    } catch (err) {
      this.logger.error('[teams] cloudAdapter.process threw', {
        instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response('Internal error', { status: 500 });
    }

    return new Response(captured.body ?? '', { status: captured.status });
  }

  /**
   * Build a `CloudAdapter` configured with the bot's app credentials. The
   * adapter validates inbound JWTs against Microsoft's published OpenID
   * metadata and rejects anything signed by a different issuer or for a
   * different audience.
   *
   * Single-tenant deployments require `tenantId` to scope the issuer.
   * `MultiTenant` (the default) accepts the public Bot Framework issuer.
   *
   * Override seam: tests that exercise webhook auth replace `cloudAdapter`
   * on the per-instance state via `registerInstanceForTests` instead of
   * stubbing this method.
   */
  protected buildCloudAdapter(connectionOptions: TeamsConnectionOptions): TeamsCloudAdapter {
    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: connectionOptions.appId,
      MicrosoftAppPassword: connectionOptions.appPassword,
      MicrosoftAppType: connectionOptions.appType,
      MicrosoftAppTenantId: connectionOptions.tenantId,
    });
    const auth = new ConfigurationBotFrameworkAuthentication({}, credentialsFactory);
    return new CloudAdapter(auth) as unknown as TeamsCloudAdapter;
  }

  /**
   * Route a parsed activity to the correct handler. Each branch is
   * responsible for its own dedupe, sanitisation, and event emission.
   */
  protected async dispatchActivity(
    instanceId: string,
    activity: InboundActivity,
    state: TeamsInstanceState,
  ): Promise<void> {
    if (!activity || typeof activity !== 'object') return;
    if (typeof activity.type !== 'string') return;

    // Capture the service URL the moment we see it — Bot Framework's
    // "trust on first use" pattern is exactly this map.
    if (activity.serviceUrl && activity.conversation?.id) {
      state.serviceUrls.set(activity.conversation.id, activity.serviceUrl);
    }

    switch (activity.type) {
      case 'message':
        await this.handleInboundMessage(instanceId, activity, state);
        break;
      case 'messageReaction':
        await this.handleInboundReaction(instanceId, activity, state);
        break;
      case 'typing':
      case 'event':
      case 'invoke':
      case 'conversationUpdate':
      case 'endOfConversation':
        // Acknowledge but don't relay. Conversation lifecycle events surface
        // useful signals for proactive messaging in a follow-up wish.
        this.logger.debug('[teams] non-message activity acknowledged', {
          instanceId,
          activityType: activity.type,
        });
        break;
      default:
        this.logger.debug('[teams] unrecognised activity type — fail-open', {
          instanceId,
          activityType: activity.type,
        });
    }
  }

  protected async handleInboundMessage(
    instanceId: string,
    activity: InboundActivity,
    state: TeamsInstanceState,
  ): Promise<void> {
    const parsed = parseInboundMessage(activity, { logger: this.logger });
    if (!parsed) return;

    const dedupeKey = `${parsed.meta.conversationId}:${parsed.meta.activityId}`;
    if (state.dedupeCache.isDuplicate(instanceId, dedupeKey, this.id, this.logger as Logger)) {
      return;
    }

    state.lastActivityIds.set(parsed.meta.conversationId, parsed.meta.activityId);

    const timings = parsed.platformTimestamp ? this.captureInboundTimings(parsed.platformTimestamp) : undefined;

    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId: parsed.meta.activityId,
      chatId: parsed.chatId,
      from: parsed.from,
      content: {
        type: parsed.content.type as ContentType,
        text: parsed.content.text,
        mediaUrl: parsed.content.mediaUrl,
        mimeType: parsed.content.mimeType,
      },
      replyToId: parsed.replyToId,
      rawPayload: {
        ...parsed.rawPayload,
        pushName: parsed.fromName,
        teamsMeta: parsed.meta,
        teamsMentions: parsed.mentions.mentions,
        teamsMentionsBot: parsed.mentions.mentionsBot,
      } as unknown as Record<string, unknown>,
      timings,
    });

    if (timings) {
      this.captureT2(correlationId, timings);
    }
  }

  protected async handleInboundReaction(
    instanceId: string,
    activity: InboundActivity,
    state: TeamsInstanceState,
  ): Promise<void> {
    const events = parseReactionActivity(activity);
    for (const event of events) {
      const meta: TeamsActivityMeta = event.meta;
      const dedupeKey = `${meta.conversationId}:${event.targetActivityId}:${event.reaction}:${event.added ? 'add' : 'remove'}`;

      if (state.dedupeCache.isDuplicate(instanceId, dedupeKey, this.id, this.logger as Logger)) {
        continue;
      }

      const chatId = meta.channelId ?? meta.conversationId;

      if (event.added) {
        await this.emitReactionReceived({
          instanceId,
          messageId: event.targetActivityId,
          chatId,
          from: meta.userId,
          emoji: event.reaction,
        });
      } else {
        await this.emitReactionRemoved({
          instanceId,
          messageId: event.targetActivityId,
          chatId,
          from: meta.userId,
          emoji: event.reaction,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Internal accessors used by senders / tests
  // ─────────────────────────────────────────────────────────────

  /** Resolve a conversation-scoped service URL captured at inbound time. */
  getServiceUrl(instanceId: string, conversationId: string): string | undefined {
    return this.teamsInstances.get(instanceId)?.serviceUrls.get(conversationId);
  }

  /** Look up the Bot Framework client for an instance (used by senders). */
  getClient(instanceId: string): BotFrameworkClient | undefined {
    return this.teamsInstances.get(instanceId)?.client;
  }

  /** Expose logger to nested handlers (mirrors gupshup pattern). */
  getLogger(): Logger {
    return this.logger as Logger;
  }

  /** Test seam: inject a fully-built instance state (used by handler tests). */
  registerInstanceForTests(instanceId: string, state: TeamsInstanceState): void {
    this.teamsInstances.set(instanceId, state);
    this.teamsConfigs.set(instanceId, state.config);
  }

  /** Helper used by the activity handlers to record activity meta on demand. */
  static toActivityMeta(activity: InboundActivity): TeamsActivityMeta {
    return toActivityMeta(activity);
  }

  // ─────────────────────────────────────────────────────────────
  // Outbound dispatch helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Route an `OutgoingMessage` to the right sender based on its content
   * type. Returns the activity ID Teams assigns so the caller can populate
   * `SendResult.messageId`.
   */
  private async dispatchOutbound(
    ctx: TeamsSendContext,
    message: OutgoingMessage,
    replyToId: string | undefined,
  ): Promise<string> {
    const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough' | undefined) ?? 'convert';

    switch (message.content.type) {
      case 'text':
        return sendTextMessage(ctx, { text: message.content.text ?? '', replyToId, formatMode }, this.logger);

      case 'image':
      case 'audio':
      case 'video':
      case 'document':
        return sendMediaMessage(
          ctx,
          {
            kind: message.content.type as TeamsMediaKind,
            mediaUrl: message.content.mediaUrl,
            content: extractInlineBuffer(message),
            mimeType: message.content.mimeType,
            filename: message.content.filename,
            caption: message.content.caption ?? message.content.text,
            replyToId,
          },
          this.logger,
        );

      case 'reaction': {
        const targetActivityId = message.content.targetMessageId ?? message.replyTo ?? '';
        return sendReaction(ctx, { targetActivityId, emoji: message.content.emoji ?? '' }, this.logger);
      }

      default:
        throw new TeamsError(
          TeamsErrorCode.UNSUPPORTED_ACTIVITY,
          `Teams plugin does not support outbound content type: ${message.content.type}`,
        );
    }
  }

  /**
   * Resolve `replyToId` for an outbound activity using `replyToMode`.
   *
   * - `off`     → never reply, returns undefined
   * - `first`   → reply to the first activity we tracked for the
   *               conversation (best-effort: we don't persist the very first
   *               id across restarts, so this falls back to `lastActivityIds`)
   * - `all`     → reply to the most recent activity (the default)
   *
   * Explicit `message.replyTo` always wins regardless of mode so callers can
   * still reply to a specific message.
   */
  private resolveReplyToId(
    state: TeamsInstanceState,
    conversationId: string,
    message: OutgoingMessage,
  ): string | undefined {
    if (message.replyTo) return message.replyTo;

    const mode: TeamsReplyToMode = state.config.replyToMode ?? 'all';
    if (mode === 'off') return undefined;

    return state.lastActivityIds.get(conversationId);
  }

  /**
   * Emit a `message.failed` event and shape a `SendResult` for the failure.
   * Centralises the error shape so every failure path returns the same
   * `{ success: false, error, errorCode, retryable, timestamp }` envelope.
   */
  private async failOutbound(instanceId: string, chatId: string, err: unknown): Promise<SendResult> {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode = err instanceof TeamsError ? err.channelCode : TeamsErrorCode.SEND_FAILED;
    const retryable = err instanceof TeamsError ? err.recoverable : false;

    await this.emitMessageFailed({
      instanceId,
      chatId,
      error: message,
      errorCode,
      retryable,
    });

    return {
      success: false,
      error: message,
      errorCode,
      retryable,
      timestamp: Date.now(),
    };
  }
}

/**
 * Extract a buffered media payload from `OutgoingMessage.metadata.base64`.
 *
 * The dispatcher hands media as either a public URL on `content.mediaUrl`
 * or an inline base64 blob on `metadata.base64`. The latter path is mostly
 * used by the agent-dispatcher when an upstream LLM returns a generated
 * image without a URL. We accept both shapes so the plugin matches the
 * Slack plugin's behaviour.
 */
function extractInlineBuffer(message: OutgoingMessage): Buffer | undefined {
  const base64 = message.metadata?.base64;
  if (typeof base64 !== 'string' || base64.length === 0) return undefined;
  return Buffer.from(base64, 'base64');
}

// ─────────────────────────────────────────────────────────────
// Config resolution
// ─────────────────────────────────────────────────────────────

function resolveTeamsConfig(instanceId: string, config: InstanceConfig): TeamsConfig {
  const credentials = (config.credentials ?? {}) as Record<string, unknown>;
  const options = (config.options ?? {}) as Record<string, unknown>;

  const appId = (credentials.appId ?? options.appId) as string | undefined;
  const appPassword = (credentials.appPassword ?? options.appPassword) as string | undefined;
  const tenantId = (credentials.tenantId ?? options.tenantId) as string | undefined;
  const appType = (options.appType ?? credentials.appType) as TeamsConfig['appType'];

  validateTeamsCredentials(instanceId, { appId, appPassword, appType, tenantId });

  return {
    appId: appId as string,
    appPassword: appPassword as string,
    tenantId,
    appType,
    ...extractTeamsOptions(options),
  };
}

function validateTeamsCredentials(
  instanceId: string,
  values: {
    appId?: string;
    appPassword?: string;
    appType?: TeamsConfig['appType'];
    tenantId?: string;
  },
): void {
  if (!values.appId) {
    throw new TeamsError(
      TeamsErrorCode.INVALID_CREDENTIALS,
      `Teams instance ${instanceId} is missing credentials.appId`,
    );
  }
  if (!values.appPassword) {
    throw new TeamsError(
      TeamsErrorCode.INVALID_CREDENTIALS,
      `Teams instance ${instanceId} is missing credentials.appPassword`,
    );
  }
  if (values.appType === 'SingleTenant' && !values.tenantId) {
    throw new TeamsError(
      TeamsErrorCode.INVALID_CREDENTIALS,
      `Teams instance ${instanceId} requires credentials.tenantId for SingleTenant deployments`,
    );
  }
}

function extractTeamsOptions(options: Record<string, unknown>): Partial<TeamsConfig> {
  return {
    serviceUrl: options.serviceUrl as string | undefined,
    conversationAllowlist: options.conversationAllowlist as string[] | undefined,
    conversationBlocklist: options.conversationBlocklist as string[] | undefined,
    conversations: options.conversations as TeamsConfig['conversations'],
    dmPolicy: options.dmPolicy as TeamsConfig['dmPolicy'],
    dmAllowlist: options.dmAllowlist as string[] | undefined,
    dmRejectionMessage: options.dmRejectionMessage as string | undefined,
    replyToMode: options.replyToMode as TeamsConfig['replyToMode'],
    defaultBotName: options.defaultBotName as string | undefined,
    retryConfig: options.retryConfig as TeamsConfig['retryConfig'],
    httpPort: options.httpPort as number | undefined,
  };
}

function toConnectionOptions(teamsConfig: TeamsConfig): TeamsConnectionOptions {
  if (!teamsConfig.appId || !teamsConfig.appPassword) {
    // resolveTeamsConfig already enforces this — but the type narrows here.
    throw new TeamsError(TeamsErrorCode.INVALID_CREDENTIALS, 'Teams config missing appId/appPassword');
  }
  return {
    appId: teamsConfig.appId,
    appPassword: teamsConfig.appPassword,
    tenantId: teamsConfig.tenantId,
    appType: teamsConfig.appType,
    retryConfig: teamsConfig.retryConfig,
    httpPort: teamsConfig.httpPort,
  };
}
