/**
 * Microsoft Teams Channel Plugin
 *
 * Provides Microsoft Teams messaging via the Bot Framework SDK (`botbuilder`).
 *
 * Scaffold scope (issue #433):
 * - `connect()` Zod-validates the Azure Bot credentials and creates a
 *   CloudAdapter from them. Construction is local — the credentials are not
 *   exercised against Entra until the first send or inbound activity.
 * - `disconnect()` releases the adapter, disposes the dedupe cache and clears
 *   stored conversation references.
 * - `sendMessage()` uses `adapter.continueConversationAsync` with a stored
 *   ConversationReference keyed by conversation ID. Bot Framework bots can
 *   only continue conversations they have seen — the user messages first.
 * - `handleWebhook()` forwards the incoming activity into
 *   `adapter.processActivityDirect`, which validates the Bot Framework JWT in
 *   the Authorization header against the instance's app credentials before
 *   any handler runs; the handler then captures the ConversationReference,
 *   dedupes, sanitizes and emits `message.received`.
 *
 * Media, reactions, typing, Adaptive Cards and streaming are follow-up work —
 * this plugin only wires the text-messaging path end-to-end, and
 * `capabilities.ts` declares exactly that.
 */

import { BaseChannelPlugin, createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
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
import type { ChannelType } from '@omni/core/types';
import { CloudAdapter, ConfigurationBotFrameworkAuthentication, TurnContext } from 'botbuilder';
import type { Activity, ConversationReference } from 'botbuilder';
import { z } from 'zod';

import { MSTEAMS_CAPABILITIES } from './capabilities';
import type { MsTeamsConfig } from './types';
import { MsTeamsConfigSchema } from './types';
import { MsTeamsApiError, MsTeamsErrorCode } from './utils/errors';

/**
 * Cap on remembered conversations per instance — oldest insertion evicted
 * beyond it (re-inserting on every inbound activity keeps active
 * conversations near the young end; same bounded-FIFO pattern as asc's
 * lastInboundWamid map).
 */
const MAX_CONVERSATION_REFS = 1000;

/**
 * Minimal shape an inbound POST body must have to be handed to the adapter.
 * The full Activity contract is botbuilder's to enforce; this boundary check
 * exists so garbage JSON is rejected with a 400 instead of surfacing as an
 * opaque adapter throw. `.passthrough()` keeps every other field intact.
 */
const InboundActivitySchema = z
  .object({
    type: z.string().min(1),
    id: z.string().optional(),
    text: z.string().optional(),
    timestamp: z.union([z.string(), z.date()]).optional(),
    channelId: z.string().optional(),
    conversation: z.object({ id: z.string() }).passthrough().optional(),
    from: z.object({ id: z.string().optional(), name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

interface InstanceState {
  adapter: CloudAdapter;
  appId: string;
  conversationRefs: Map<string, Partial<ConversationReference>>;
  dedupeCache: DedupeCache;
}

export class MsTeamsPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'msteams';
  readonly name = 'Microsoft Teams (botbuilder)';
  readonly version = '0.1.0';
  readonly capabilities: ChannelCapabilities = MSTEAMS_CAPABILITIES;

  private readonly instanceStates = new Map<string, InstanceState>();

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('Microsoft Teams plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.instanceStates) {
      state.dedupeCache.dispose();
    }
    this.instanceStates.clear();
    this.logger.info('Microsoft Teams plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect an instance from Azure Bot credentials.
   *
   * `config.credentials` (fallback `config.options`) is expected to carry:
   *   - appId / msteamsAppId (required — Entra application id)
   *   - appPassword / msteamsAppPassword (required — client secret; SECRET,
   *     accepted at connect time only and held in memory, never persisted)
   *   - appType / msteamsAppType (optional — default MultiTenant)
   *   - tenantId / msteamsTenantId (optional — required for SingleTenant)
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    // A repeat connect REBUILDS the adapter instead of no-opping: with the
    // appPassword never at rest, POST /instances/:id/connect is the ONLY
    // secret-rotation path — a no-op here would silently keep the revoked
    // credential (hermes/asc rebuild unconditionally for the same reason).
    // Conversation references and the dedupe cache are credential-agnostic
    // and survive the rebuild.
    const existing = this.instanceStates.get(instanceId);
    if (existing) {
      this.logger.info('Instance already connected — rebuilding the adapter with the supplied credentials', {
        instanceId,
      });
    }

    const credentials = readMsTeamsConfig(config);

    if (credentials.allowAnonymous) {
      // Environment gate, not just documentation: an anonymous adapter behind
      // the public webhook route disables ALL JWT validation, so the flag is
      // only honored where the runtime says this is a dev process.
      if (this.config.env !== 'development') {
        throw new MsTeamsApiError(
          MsTeamsErrorCode.INVALID_CONFIG,
          `msteamsAllowAnonymous is a local-development flag and is refused in env "${this.config.env}" — supply real Azure Bot credentials instead`,
          { operation: 'connect' },
        );
      }
      this.logger.warn(
        'Teams instance connecting in ANONYMOUS local-dev mode — the webhook will accept unsigned activities',
        { instanceId },
      );
    }

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connecting',
      since: new Date(),
    });

    const adapter = this.createAdapter(credentials);

    adapter.onTurnError = async (_context, error) => {
      this.logger.error('Teams turn error', {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
      // RETHROW — botbuilder's runMiddleware routes handler errors here and,
      // if this callback returns normally, resolves the turn as successful:
      // handleWebhook would ack 200 and Bot Framework would never redeliver
      // a message we failed to emit (e.g. the event bus was briefly down).
      // Propagating turns that into an honest 500. (No courtesy sendActivity
      // either: the retry the 500 provokes would duplicate it.)
      throw error;
    };

    this.instanceStates.set(instanceId, {
      adapter,
      appId: credentials.appId,
      conversationRefs: existing?.conversationRefs ?? new Map(),
      dedupeCache: existing?.dedupeCache ?? createInboundDedupeCache(),
    });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
    });
    await this.emitInstanceConnected(instanceId, {
      profileName: 'Microsoft Teams',
      ownerIdentifier: credentials.appId || 'anonymous-local',
    });

    this.logger.info('Teams instance connected', { instanceId, appId: credentials.appId });
  }

  /**
   * Adapter factory — the single seam between this plugin and botbuilder's
   * network stack. Tests override it with a faked CloudAdapter so every path
   * (JWT rejection, Connector failures, successful sends) runs without any
   * real Bot Framework traffic.
   */
  protected createAdapter(credentials: MsTeamsConfig): CloudAdapter {
    // Anonymous local-dev mode (Bot Framework Emulator / Teams App Test
    // Tool): an EMPTY configuration makes botbuilder's auth accept
    // unauthenticated traffic. Only reachable behind the explicit
    // allowAnonymous flag validated in readMsTeamsConfig.
    const auth = credentials.allowAnonymous
      ? new ConfigurationBotFrameworkAuthentication({})
      : new ConfigurationBotFrameworkAuthentication({
          MicrosoftAppId: credentials.appId,
          MicrosoftAppPassword: credentials.appPassword,
          MicrosoftAppType: credentials.appType,
          MicrosoftAppTenantId: credentials.tenantId,
        });
    return new CloudAdapter(auth);
  }

  async disconnect(instanceId: string): Promise<void> {
    const state = this.instanceStates.get(instanceId);
    if (!state) {
      this.logger.debug('Disconnect called for unknown instance', { instanceId });
      return;
    }

    state.dedupeCache.dispose();
    state.conversationRefs.clear();
    this.instanceStates.delete(instanceId);

    const entry = this.instances.get(instanceId);
    if (entry) {
      await this.updateInstanceStatus(instanceId, entry.config, {
        state: 'disconnected',
        since: new Date(),
      });
    }

    await this.emitInstanceDisconnected(instanceId, 'disconnect requested');
  }

  // ─────────────────────────────────────────────────────────────
  // Outbound
  // ─────────────────────────────────────────────────────────────

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.instanceStates.get(instanceId);
    if (!state) {
      const error = `Teams instance ${instanceId} is not connected`;
      await this.emitMessageFailed({
        instanceId,
        chatId: message.to,
        error,
        errorCode: MsTeamsErrorCode.NOT_CONNECTED,
        retryable: false,
      });
      return { success: false, error, retryable: false, timestamp: Date.now() };
    }

    // Scaffold is text-only; richer content types are declared false in
    // capabilities, so the runtime should never route them here. Reject
    // without emitting — nothing was attempted against the Connector.
    if (message.content.type !== 'text') {
      return {
        success: false,
        error: `Unsupported content.type=${message.content.type} for msteams (text-only scaffold)`,
        retryable: false,
        timestamp: Date.now(),
      };
    }

    const reference = state.conversationRefs.get(message.to);
    if (!reference) {
      const error = `No ConversationReference stored for ${message.to} — the user must message the bot first`;
      await this.emitMessageFailed({
        instanceId,
        chatId: message.to,
        error,
        errorCode: MsTeamsErrorCode.NO_CONVERSATION_REFERENCE,
        retryable: false,
      });
      return { success: false, error, retryable: false, timestamp: Date.now() };
    }

    const text = message.content.text ?? '';
    let sentId: string | undefined;

    // Journey timing: T10 (pluginSentAt) right before the Connector call.
    const correlationId = message.metadata?.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      await state.adapter.continueConversationAsync(state.appId, reference, async (context) => {
        const response = await context.sendActivity({ type: 'message', text });
        sentId = response?.id;
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.emitMessageFailed({
        instanceId,
        chatId: message.to,
        error,
        errorCode: MsTeamsErrorCode.SEND_FAILED,
        retryable: true,
      });
      return { success: false, error, errorCode: MsTeamsErrorCode.SEND_FAILED, retryable: true, timestamp: Date.now() };
    }

    // Journey timing: T11 (platformDeliveredAt) once the Connector acknowledged.
    if (correlationId) this.captureT11(correlationId);

    await this.emitMessageSent({
      instanceId,
      externalId: sentId ?? '',
      chatId: message.to,
      to: message.to,
      content: { type: 'text', text },
      replyToId: message.replyTo,
      senderAgentId: message.metadata?.senderAgentId as string | undefined,
    });

    return { success: true, messageId: sentId, timestamp: Date.now() };
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook
  // ─────────────────────────────────────────────────────────────

  /**
   * Per-instance webhook entry point
   * (`POST /api/v2/channels/msteams/:instanceId/webhook`).
   *
   * Authenticity: unlike the token-compare channels, Bot Framework signs
   * every delivery — `adapter.processActivityDirect` validates the JWT in
   * the Authorization header against the Bot Framework metadata + this
   * instance's app credentials BEFORE the handler logic runs. A request
   * without a valid service token never reaches `handleIncomingActivity`.
   */
  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.indexOf('msteams') + 1] ?? '';

    const state = this.instanceStates.get(instanceId);
    if (!state) {
      return new Response('Instance not found', { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const parsed = InboundActivitySchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn('Rejected malformed Teams activity', {
        instanceId,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return new Response('Invalid activity', { status: 400 });
    }

    const activity = parsed.data as unknown as Activity;
    const authHeader = request.headers.get('authorization') ?? '';

    // Classify failures by PHASE, not by message text: the adapter validates
    // the Bot Framework JWT before it ever invokes the turn logic, so an
    // error with the logic never entered is an authentication rejection,
    // and an error after it entered is an internal failure. (Matching on the
    // message is unreliable — processActivityDirect wraps errors with the
    // full stack, where auth-flavored words appear in unrelated crashes.)
    let logicEntered = false;
    try {
      await state.adapter.processActivityDirect(authHeader, activity, async (context) => {
        logicEntered = true;
        await this.handleIncomingActivity(instanceId, state, context);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!logicEntered) {
        this.logger.warn('Teams activity rejected: authentication failed', { instanceId, error: message });
        return new Response('Unauthorized', { status: 401 });
      }
      this.logger.error('Failed to process Teams activity', { instanceId, error: message });
      return new Response('Internal error', { status: 500 });
    }

    return new Response(null, { status: 200 });
  }

  private async handleIncomingActivity(instanceId: string, state: InstanceState, context: TurnContext): Promise<void> {
    const activity = context.activity;
    const reference = TurnContext.getConversationReference(activity);
    const chatId = reference.conversation?.id ?? '';

    if (chatId) {
      this.rememberConversationReference(state, chatId, reference);
    }

    if (activity.type !== 'message') {
      return;
    }

    const externalId = activity.id ?? '';
    // Marks-on-check (shared SDK cache semantics, same as every sibling
    // channel): if the emit below fails and Bot Framework redelivers, the
    // retry lands here as a "duplicate". Known repo-wide tradeoff.
    if (externalId && state.dedupeCache.isDuplicate(instanceId, externalId, 'msteams', this.logger)) {
      this.logger.debug('[msteams] duplicate inbound dropped', { instanceId, externalId });
      return;
    }

    // removeRecipientMention dereferences activity.recipient.id unguarded
    // (botbuilder-core turnContext.js) — a recipient-less message activity
    // passes the boundary schema, so guard here or the turn handler throws.
    const rawText = activity.recipient
      ? (TurnContext.removeRecipientMention(activity) ?? activity.text ?? '')
      : (activity.text ?? '');
    const sanitized = sanitizeMessage(rawText, this.logger, { instanceId, messageId: externalId });
    if (!sanitized.ok) {
      this.logger.warn('[msteams] inbound text rejected by sanitizer', {
        instanceId,
        externalId,
        rejected: sanitized.rejected,
      });
      return;
    }

    // Journey timing: T0 (platformReceivedAt) + T1 (pluginReceivedAt), then
    // T2 (eventPublishedAt) after the event is on the bus.
    const platformTimestampMs = resolveActivityTimestampMs(activity);
    const timings = this.captureInboundTimings(platformTimestampMs);

    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from: activity.from?.id ?? '',
      senderName: activity.from?.name,
      content: {
        type: 'text',
        text: sanitized.text,
      },
      replyToId: activity.replyToId,
      rawPayload: activity as unknown as Record<string, unknown>,
      timings,
    });
    if (timings) this.captureT2(correlationId, timings);
  }

  /**
   * Remember the ConversationReference for a conversation so `sendMessage`
   * can continue it later. Bounded FIFO per instance (re-insertion keeps
   * active conversations near the young end).
   */
  private rememberConversationReference(
    state: InstanceState,
    chatId: string,
    reference: Partial<ConversationReference>,
  ): void {
    state.conversationRefs.delete(chatId);
    state.conversationRefs.set(chatId, reference);
    if (state.conversationRefs.size > MAX_CONVERSATION_REFS) {
      const oldest = state.conversationRefs.keys().next().value;
      if (oldest !== undefined) state.conversationRefs.delete(oldest);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported — the Bot Framework offers no backfill API).
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }
}

/**
 * Read + Zod-validate the Azure Bot credential bag from an InstanceConfig.
 *
 * Accepts both the plain keys (`appId`, direct SDK use) and the
 * `msteams`-prefixed keys the API connect route forwards
 * (`msteamsAppId`, ...), body-over-plain when both are present.
 */
function readMsTeamsConfig(config: InstanceConfig): MsTeamsConfig {
  const source = {
    ...(config.credentials ?? {}),
    ...(config.options ?? {}),
  } as Record<string, unknown>;

  const parsed = MsTeamsConfigSchema.safeParse({
    appId: source.msteamsAppId ?? source.appId ?? undefined,
    appPassword: source.msteamsAppPassword ?? source.appPassword ?? undefined,
    appType: source.msteamsAppType ?? source.appType ?? undefined,
    tenantId: source.msteamsTenantId ?? source.tenantId ?? undefined,
    allowAnonymous: source.msteamsAllowAnonymous ?? source.allowAnonymous ?? undefined,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new MsTeamsApiError(
      MsTeamsErrorCode.INVALID_CONFIG,
      `Microsoft Teams instance credentials are invalid — ${issues}`,
      { operation: 'connect' },
    );
  }

  return parsed.data;
}

/** Activity timestamps arrive as ISO strings on the wire (Date once parsed). */
function resolveActivityTimestampMs(activity: Activity): number {
  const ts = activity.timestamp;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}
