/**
 * Slack Channel Plugin using Bolt.js with Socket Mode
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, streaming, interactions, and file handling.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BaseChannelPlugin,
  createDownloadGuard,
  createInboundDedupeCache,
  createThreadStarterCache,
} from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  ConnectionStatus,
  DedupeCache,
  FetchHistoryOptions,
  FetchHistoryResult,
  HistorySyncMessage,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
  StreamSender,
  ThreadStarterCache,
} from '@omni/channel-sdk';
import { DebounceManager } from '@omni/core';
import type { ChannelType, ContentType } from '@omni/core/types';
import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { z } from 'zod';

import { SLACK_CAPABILITIES } from './capabilities';
import { resolveStreamMode, resolveStreamThrottle } from './config/stream-mode';
import type { SlackAttachment, SlackAuthorization, SlackEventBody, SlackRevocation } from './connection/app-receiver';
import { SlackAppReceiver, receiverKeyFor } from './connection/app-receiver';
import type { SocketConnectionState } from './connection/bolt-client';
import { buildActingClients, resolveWorkspaceIdentity } from './connection/bolt-client';
import type { AgentSessionStoppedArgs } from './handlers/agent-sessions';
import type { CommandPayload } from './handlers/commands';
import { setupCommandHandlers } from './handlers/commands';
import { downloadSlackFile, extractFileInfo, getContentTypeFromMime } from './handlers/files';
import { setupInteractionHandlers } from './handlers/interactions';
import { type SlackDebouncedArgs, setupMessageHandlers, shouldSkipMessage } from './handlers/messages';
import { setupPinHandlers } from './handlers/pins';
import { type SlackStatusMethod, clearTypingStatus, forgetStatusMemo, setSlackThreadStatus } from './handlers/typing';
import { uploadFile, uploadFileFromUrl } from './senders/media';
import { type NativeStreamSender, createNativeStreamSender } from './senders/native-stream';
import { createSlackStreamSender } from './senders/stream';
import {
  cancelScheduledSlackMessage,
  deleteSlackMessage,
  editSlackMessage,
  scheduleTextMessage,
  sendTextMessage,
} from './senders/text';
import type {
  ReplyToMode,
  SlackAuthMode,
  SlackConfig,
  SlackConnectionMode,
  SlackConnectionOptions,
  SlackInteractionPayload,
} from './types';
import { SlackError, SlackErrorCode } from './types';

/** Download size guard — 50MB default; applied to inbound file metadata before dispatching */
const downloadGuard = createDownloadGuard();

type SlackPresenceType = 'typing' | 'recording' | 'paused';

/**
 * Lift the fields the receiver routes on out of one of Bolt's per-event body
 * types.
 *
 * Bolt's bodies are interfaces with no index signature, so none of them
 * structurally satisfies {@link SlackEventBody}; copying the routing fields
 * across is what keeps this cast-free. `team_id` is the authoritative
 * workspace — Bolt types it as required on every event envelope, and the
 * inner-event fallback {@link SlackAppReceiver.targetsFor} also accepts is not
 * typed on the event unions Bolt hands these listeners. `authorizations` and
 * `event_context` are what narrows delivery when a workspace has more than one
 * instance: without them here the receiver would have nothing to narrow by.
 */
function routingEnvelope(body: {
  team_id?: string;
  authorizations?: SlackAuthorization[];
  event_context?: string;
}): SlackEventBody {
  return { team_id: body.team_id, authorizations: body.authorizations, event_context: body.event_context };
}

/**
 * The fields the reaction listeners read from `reaction_added` /
 * `reaction_removed`. Bolt's own event types are assignable to this; declaring
 * the narrow shape keeps the listener body cast-free.
 */
interface SlackReactionEvent {
  user?: string;
  reaction?: string;
  item?: { channel?: string; ts?: string };
}

/**
 * External boundary: the `agent_session_stopped` payload as Slack sends it
 * (#914). Bolt has no type for the event, so the fields are validated here;
 * `channel` is the only one the handler cannot do without.
 */
const AgentSessionStoppedEventSchema = z
  .object({
    channel: z.string().min(1),
    thread_ts: z.string().optional(),
    user: z.string().optional(),
    event_ts: z.string().optional(),
    streaming_message_ts: z.array(z.string()).optional(),
  })
  .passthrough();

type SlackPresenceStatusResult = {
  delivered: boolean;
  /** Which Slack API handled the call; absent when no call was attempted. */
  method?: SlackStatusMethod;
  threadId?: string;
  status?: string;
  loadingMessages?: string[];
  reason?: 'not_connected' | 'no_active_thread' | 'slack_status_failed';
};

/**
 * Resolve Slack credentials from config, options, and credentials sources.
 * Supports legacy token aliases and both connection modes.
 */
function resolveSlackTokens(
  slackConfig: SlackConfig,
  rawOptions: Record<string, unknown>,
  rawCredentials: Record<string, unknown>,
): {
  botToken: string;
  userToken?: string;
  authMode: SlackAuthMode;
  appToken?: string;
  signingSecret?: string;
  mode: SlackConnectionMode;
} {
  const botToken =
    slackConfig.botToken ??
    (rawOptions.token as string | undefined) ??
    (rawCredentials.botToken as string | undefined) ??
    (rawCredentials.token as string | undefined);
  const userToken = slackConfig.userToken ?? (rawCredentials.userToken as string | undefined);
  const authMode: SlackAuthMode = slackConfig.authMode ?? 'bot';
  const appToken = slackConfig.appToken ?? (rawCredentials.appToken as string | undefined);
  const signingSecret = slackConfig.signingSecret ?? (rawCredentials.signingSecret as string | undefined);
  const mode: SlackConnectionMode = slackConfig.mode ?? 'socket';

  // The bot token stays mandatory even in user mode: Bolt authenticates the
  // socket with it, and it is the fallback for calls the user token lacks
  // scope for. User mode changes who ACTS, not who connects.
  if (!botToken) {
    throw new SlackError(SlackErrorCode.INVALID_TOKEN, 'botToken (xoxb-...) is required');
  }
  if (authMode === 'user' && !userToken) {
    throw new SlackError(
      SlackErrorCode.INVALID_TOKEN,
      "userToken (xoxp-...) is required when authMode is 'user' — without it every action would silently go out as the bot",
    );
  }
  if (userToken && !userToken.startsWith('xoxp-')) {
    // Catch a bot token pasted into the user slot. Left unchecked, the plugin
    // would look like it was acting as the human while posting as the bot.
    throw new SlackError(
      SlackErrorCode.INVALID_TOKEN,
      'userToken must be a user token (xoxp-...); got a token with a different prefix',
    );
  }
  if (mode === 'socket' && !appToken) {
    throw new SlackError(SlackErrorCode.INVALID_TOKEN, 'appToken (xapp-...) is required for Socket Mode');
  }
  if (mode === 'http' && !signingSecret) {
    throw new SlackError(SlackErrorCode.INVALID_TOKEN, 'signingSecret is required for HTTP mode');
  }

  return { botToken, userToken, authMode, appToken, signingSecret, mode };
}

/**
 * Slack Channel Plugin
 *
 * Extends BaseChannelPlugin to provide Slack messaging via Bolt.js Socket Mode.
 *
 * Features:
 * - Socket Mode connection (no webhook URL needed)
 * - Text messaging with mrkdwn formatting
 * - Streaming draft messages (replace, status_final, off)
 * - Thread support
 * - Interactive components (Block Kit)
 * - Slash commands
 * - File uploads/downloads
 * - Reactions, pins
 * - DM policy enforcement
 * - Identity customization
 */
export class SlackPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'slack';
  readonly name = 'Slack (Bolt.js)';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = SLACK_CAPABILITIES;

  /**
   * Attached instances, keyed by instance id.
   *
   * An attachment is everything this plugin needs to act for one instance —
   * its acting clients, identities, config and reliability caches. It replaces
   * the per-instance Bolt `App` the plugin used to own: the `App` now belongs
   * to the receiver below, and several instances share one.
   */
  private attachments = new Map<string, SlackAttachment>();

  /**
   * Shared Bolt receivers, keyed by {@link receiverKeyFor}.
   *
   * One receiver per Slack app — per app-level token in Socket Mode, per
   * signing secret and port in HTTP mode. Slack load-balances an app's events
   * across its Socket Mode connections, so two instances behind one app token
   * MUST share one socket or each would see only part of the traffic.
   */
  private receivers = new Map<string, SlackAppReceiver>();

  /** Plugin-specific config per instance */
  private slackConfigs = new Map<string, SlackConfig>();

  /**
   * InstanceConfig per attached instance, so a socket transition on a shared
   * receiver can be mirrored into EVERY attached instance's status (#941).
   */
  private instanceConfigs = new Map<string, InstanceConfig>();

  /** Highest attach stamp handed out so far; see {@link nextAttachedAt}. */
  private lastAttachedAt = 0;

  /**
   * Cached display names per instance (null = failed lookup):
   * `${instanceId}:${userId}` for users, `${instanceId}:channel:${channelId}` for channel names (#1162).
   */
  private userNameCache = new Map<string, string | null>();

  /** Per-instance inbound dedup caches (created on connect, disposed on disconnect) */
  private dedupeCaches = new Map<string, DedupeCache>();

  /** Per-instance debounce managers (created on connect, flushed + disposed on disconnect) */
  private debouncers = new Map<string, DebounceManager>();

  /** Per-instance thread-starter caches for conversations.replies coalescing */
  private threadCaches = new Map<string, ThreadStarterCache<HistorySyncMessage[]>>();

  /**
   * Last active thread per (instanceId, channelId): Map<`${instanceId}:${channelId}`, threadTs>
   * Used by sendTyping to resolve the thread context for assistant.threads.setStatus.
   */
  private activeThreads = new Map<string, string>();

  /**
   * Pending auto-clear timers per active status thread.
   * Key: `${instanceId}:${channelId}:${threadTs}`
   */
  private presenceStatusTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Pending ack reactions awaiting removal after reply.
   * Key: `${instanceId}:${channelId}:${messageTs}`, Value: emoji name
   */
  private pendingAckReactions = new Map<string, string>();

  /**
   * Live native-mode stream senders keyed by `${instanceId}:${channelId}`.
   * `agent_session_stopped` lists the streams Slack already halted; these are
   * told so the cancel path skips chat.stopStream on them (#914).
   */
  private activeNativeStreams = new Map<string, Set<NativeStreamSender>>();

  /**
   * Newest Slack ts seen per conversation, for reconnect backfill (#1151).
   * Map<instanceId, Map<channelId | `${channelId}:${threadTs}`, ts>>. Survives
   * a connection rebuild (that is the point); cleared on disconnect.
   */
  private lastSeenTs = new Map<string, Map<string, string>>();

  /** Per-instance inbound message handler, reused to feed backfilled messages. */
  private inboundHandlers = new Map<string, (msg: Record<string, unknown>) => Promise<void>>();

  /**
   * Plugin-specific initialization
   */
  protected override async onInitialize(_context: PluginContext): Promise<void> {
    // No additional initialization needed
  }

  /**
   * Plugin-specific cleanup
   */
  protected override async onDestroy(): Promise<void> {
    for (const [key, receiver] of this.receivers) {
      this.logger.info('Stopping Slack receiver', { receiver: key, attachments: receiver.attachments.size });
      await receiver.stop();
    }
    this.receivers.clear();
    this.attachments.clear();
    this.slackConfigs.clear();
    this.instanceConfigs.clear();
    this.userNameCache.clear();

    for (const debouncer of this.debouncers.values()) {
      debouncer.flushAll();
    }
    this.debouncers.clear();

    for (const cache of this.dedupeCaches.values()) {
      cache.dispose();
    }
    this.dedupeCaches.clear();

    for (const cache of this.threadCaches.values()) {
      cache.dispose();
    }
    this.threadCaches.clear();
    for (const timer of this.presenceStatusTimers.values()) {
      clearTimeout(timer);
    }
    this.presenceStatusTimers.clear();
    this.activeThreads.clear();
    this.pendingAckReactions.clear();
    this.activeNativeStreams.clear();
  }

  /**
   * Connect a Slack instance.
   *
   * Instances behind the SAME Slack app share one {@link SlackAppReceiver} —
   * one Bolt `App`, one socket. So connect() resolves tokens, takes (or, on a
   * miss, creates) the receiver for those options, verifies the workspace
   * identity through the receiver's own bot client, attaches, and starts the
   * receiver only when nothing has started it yet.
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    // A reconnect ALWAYS detaches first (design decision 10). The socket is
    // the receiver's, not this instance's, so "already connected" can no
    // longer be decided from one instance's health check — the attachment and
    // its acting clients are rebuilt instead, and the receiver stays up for
    // whatever else is attached to it.
    if (this.attachments.has(instanceId)) {
      this.logger.warn('Instance already attached — detaching before reconnect', { instanceId });
      await this.detachInstance(instanceId);
      this.disposeInstanceCaches(instanceId);
    }

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connecting',
      since: new Date(),
    });

    const rawOptions = (config.options ?? {}) as Record<string, unknown>;
    const rawCredentials = (config.credentials ?? {}) as Record<string, unknown>;
    const slackConfig = rawOptions as SlackConfig;

    // Create per-instance reliability caches
    const debounceDelayMs = (slackConfig as Record<string, unknown>).debounceDelayMs as number | undefined;
    const { dedupeCache, debouncer } = this.createReliabilityCaches(instanceId, debounceDelayMs);
    this.dedupeCaches.set(instanceId, dedupeCache);
    this.debouncers.set(instanceId, debouncer);

    // Create per-instance thread-starter cache for conversations.replies coalescing
    const threadCache = createThreadStarterCache<HistorySyncMessage[]>();
    this.threadCaches.set(instanceId, threadCache);

    let receiverKey: string | undefined;
    try {
      const resolved = resolveSlackTokens(slackConfig, rawOptions, rawCredentials);
      this.slackConfigs.set(instanceId, slackConfig);
      this.instanceConfigs.set(instanceId, config);

      // Runtime guard: warn early if both allowlist and blocklist are set.
      // The allowlist takes precedence in isChannelBlocked(), so the blocklist
      // would be silently ignored — warn here so misconfiguration is visible.
      if (slackConfig.channelAllowlist?.length && slackConfig.channelBlocklist?.length) {
        this.logger.warn(
          'Both channelAllowlist and channelBlocklist are configured — channelAllowlist takes precedence and channelBlocklist will be ignored',
          { instanceId },
        );
      }

      const options: SlackConnectionOptions = {
        botToken: resolved.botToken,
        userToken: resolved.userToken,
        authMode: resolved.authMode,
        appToken: resolved.appToken,
        signingSecret: resolved.signingSecret,
        retryConfig: slackConfig.retryConfig,
        mode: resolved.mode,
        httpPort: slackConfig.httpPort,
      };

      // Phase 1: take the receiver for these options. Its constructor is where
      // every Bolt listener is registered — Socket Mode drops events that
      // arrive before their listener exists, so that has to happen before any
      // start, and exactly once for the whole receiver.
      const taken = this.obtainReceiver(options, slackConfig);
      receiverKey = taken.key;
      const receiver = taken.receiver;

      // Phase 2: identity, acting clients and the user-mode invariant. Nothing
      // is attached and nothing is started until all three hold.
      const attachment = await this.buildAttachment(instanceId, receiver, options, slackConfig, {
        dedupeCache,
        debouncer,
      });

      // Phase 3: this instance's inbound handler, which the receiver's shared
      // message listener calls for every event of this workspace.
      this.registerInboundHandler(attachment);

      receiver.attach(attachment);
      this.attachments.set(instanceId, attachment);

      // Phase 4: start, but only if nothing started this receiver already — a
      // second instance on the same app token joins the open socket.
      if (!receiver.isRunning) {
        await receiver.start();
      }

      await this.updateInstanceStatus(instanceId, config, {
        state: 'connected',
        since: new Date(),
        metadata: {
          profileName: attachment.botName,
          ownerIdentifier: attachment.botUserId,
        },
      });

      await this.emitInstanceConnected(instanceId, {
        profileName: attachment.botName,
        ownerIdentifier: attachment.botUserId,
        teamId: attachment.teamId,
        // Only user mode acts as a human; in bot mode there is no such id.
        actingUserId: attachment.authMode === 'user' ? attachment.actingUserId : undefined,
      });

      // Runtime detection (#941): from here on, a socket dying drives a real
      // status transition instead of leaving a stale cached 'connected'.
      this.watchSocketState(instanceId, config, receiver);
      void this.backfillMissedMessages(instanceId, attachment);

      this.logger.info('Slack instance connected', {
        instanceId,
        receiver: receiverKey,
        botName: attachment.botName,
        teamId: attachment.teamId,
        attachments: receiver.attachments.size,
      });
    } catch (error) {
      // Undo a partial attach, and stop + forget a receiver this connect
      // created and left with nothing attached — a stopped receiver must never
      // be handed back out by a later connect.
      await this.detachInstance(instanceId);
      if (receiverKey) await this.pruneReceiver(receiverKey);
      this.inboundHandlers.delete(instanceId);
      // Dispose reliability caches that were created before the failed connect
      this.disposeInstanceCaches(instanceId);
      await this.updateInstanceStatus(instanceId, config, {
        state: 'error',
        since: new Date(),
        error: {
          code: SlackErrorCode.CONNECTION_FAILED,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      });
      throw error;
    }
  }

  /**
   * The receiver for these connection options, constructed only on a miss.
   *
   * `registerHandlers` runs inside the constructor, so `setupHandlers` is
   * called once per receiver rather than once per instance.
   */
  private obtainReceiver(
    options: SlackConnectionOptions,
    config: SlackConfig,
  ): { key: string; receiver: SlackAppReceiver } {
    const key = receiverKeyFor(options);
    const existing = this.receivers.get(key);
    if (existing) return { key, receiver: existing };

    const receiver = new SlackAppReceiver(options, (app, own) => this.setupHandlers(app, own, config), this.logger);
    this.receivers.set(key, receiver);
    return { key, receiver };
  }

  /**
   * Resolve identity and acting clients, and build this instance's attachment.
   *
   * Nothing here attaches or starts anything: a failure leaves the receiver
   * exactly as it was.
   */
  private async buildAttachment(
    instanceId: string,
    receiver: SlackAppReceiver,
    options: SlackConnectionOptions,
    config: SlackConfig,
    caches: { dedupeCache: DedupeCache; debouncer: DebounceManager },
  ): Promise<SlackAttachment> {
    // The receiver's `App` is built with `authorize` and carries NO token, so
    // there is no app client to run auth.test through. Identity goes through
    // the receiver's own bot client instead; before the attach the team id is
    // still unknown, so the client is taken by bot token, and the attach
    // reuses that very object — afterwards `receiver.botClientFor(teamId)` is
    // this same client.
    const botClient = receiver.clientForBotToken(options.botToken);
    const identity = await resolveWorkspaceIdentity(botClient);
    const { actingClient, userClient } = buildActingClients(options, botClient);

    // User mode (#889) MUST NOT attach or start without a resolved acting-user
    // id. Self-filtering compares the human's own typing against it; when it is
    // undefined the check in shouldSkipMessage silently no-ops and the agent
    // answers the operator's OWN messages. Fail fast rather than attach broken.
    let actingUserId: string | undefined;
    if (userClient) {
      actingUserId = await this.resolveActingUserId(userClient);
      if (!actingUserId) {
        throw new SlackError(
          SlackErrorCode.CONNECTION_FAILED,
          'User mode requires a resolved acting user id, but it could not be determined from the user token. Refusing to connect.',
        );
      }
    }

    return {
      instanceId,
      teamId: identity.teamId,
      authMode: options.authMode ?? 'bot',
      actingClient,
      userClient,
      actingUserId,
      botUserId: identity.botUserId,
      botId: identity.botId,
      botToken: options.botToken,
      botName: identity.botName,
      config,
      dedupeCache: caches.dedupeCache,
      debouncer: caches.debouncer,
      attachedAt: this.nextAttachedAt(),
    };
  }

  /**
   * A strictly increasing attach stamp.
   *
   * The receiver answers `authorize`, and keys a workspace's bot client, with
   * the attachment of the GREATEST `attachedAt`. Two attaches inside one
   * millisecond would tie on a bare `Date.now()`, so the counter never repeats
   * a value and a re-attach always outranks the attach it replaced.
   */
  private nextAttachedAt(): number {
    this.lastAttachedAt = Math.max(Date.now(), this.lastAttachedAt + 1);
    return this.lastAttachedAt;
  }

  /** Resolve the authorizing human's user id from the user token (#889). */
  private async resolveActingUserId(userClient: WebClient): Promise<string | undefined> {
    try {
      const auth = await userClient.auth.test();
      const actingUserId = auth.user_id ?? undefined;
      this.logger.info('Acting user identity resolved', { actingUserId, actingUser: auth.user });
      return actingUserId;
    } catch (error) {
      this.logger.warn('Failed to resolve the acting user identity from the user token', {
        error: String(error),
      });
      return undefined;
    }
  }

  /**
   * Disconnect a Slack instance
   */
  async disconnect(instanceId: string): Promise<void> {
    if (!this.attachments.has(instanceId)) return;

    await this.detachInstance(instanceId);
    this.slackConfigs.delete(instanceId);
    this.instanceConfigs.delete(instanceId);
    this.lastSeenTs.delete(instanceId);
    this.inboundHandlers.delete(instanceId);

    // Clear cached user names, active threads, and pending ack reactions for this instance
    for (const key of this.userNameCache.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.userNameCache.delete(key);
    }
    for (const key of this.activeThreads.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.activeThreads.delete(key);
    }
    for (const [key, timer] of this.presenceStatusTimers) {
      if (!key.startsWith(`${instanceId}:`)) continue;
      clearTimeout(timer);
      this.presenceStatusTimers.delete(key);
    }
    for (const key of this.activeNativeStreams.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.activeNativeStreams.delete(key);
    }
    for (const key of this.pendingAckReactions.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.pendingAckReactions.delete(key);
    }

    // Flush pending debounce windows and dispose reliability caches
    this.disposeInstanceCaches(instanceId);

    await this.emitInstanceDisconnected(instanceId, 'User requested disconnect');
  }

  /**
   * Detach one instance from its receiver.
   *
   * The receiver survives as long as anything else is attached to it; only the
   * last detach takes the socket down. Safe to call for an instance that is
   * not attached.
   */
  private async detachInstance(instanceId: string): Promise<void> {
    const attachment = this.attachments.get(instanceId);
    this.attachments.delete(instanceId);
    // The Agent-API availability memo is keyed on the attachment, so dropping
    // it here means the next attach probes with a clean slate.
    if (attachment) forgetStatusMemo(attachment);

    for (const [key, receiver] of this.receivers) {
      if (!receiver.attachments.has(instanceId)) continue;
      receiver.detach(instanceId);
      await this.pruneReceiver(key);
      return;
    }
  }

  /**
   * Stop and forget a receiver with nothing attached.
   *
   * The receiver stops its own `App` on the last detach, so leaving the key in
   * the map would let a later connect be handed a receiver whose `App` is
   * already stopped. Calling this on a receiver that still has attachments is
   * a no-op.
   */
  private async pruneReceiver(key: string): Promise<void> {
    const receiver = this.receivers.get(key);
    if (!receiver || receiver.attachments.size > 0) return;
    this.receivers.delete(key);
    await receiver.stop();
  }

  /** The receiver an instance is attached to, if any. */
  private receiverOf(instanceId: string): SlackAppReceiver | undefined {
    for (const receiver of this.receivers.values()) {
      if (receiver.attachments.has(instanceId)) return receiver;
    }
    return undefined;
  }

  /**
   * Report status from the REAL socket, not just the cached transition (#941).
   *
   * BaseChannelPlugin caches the last written status, and 'connected' used to
   * be written once at connect() and never revisited — a deaf socket reported
   * connected forever and the instance monitor had nothing to act on. When the
   * cache says connected but the receiver's Socket Mode WebSocket is not open,
   * report a retryable error instead; needsReconnect() in the instance monitor
   * treats that as a signal to rebuild the instance automatically.
   */
  override async getStatus(instanceId: string): Promise<ConnectionStatus> {
    const status = await super.getStatus(instanceId);
    if (status.state !== 'connected') return status;

    const receiver = this.receiverOf(instanceId);
    if (!receiver || receiver.socketHealth().open) return status;

    return {
      state: 'error',
      since: new Date(),
      message: 'Socket Mode WebSocket is not open despite cached connected state',
      error: {
        code: SlackErrorCode.CONNECTION_FAILED,
        message: 'Socket Mode WebSocket is not open',
        retryable: true,
      },
    };
  }

  /**
   * Mirror Socket Mode lifecycle transitions into instance status (#941).
   *
   * The socket belongs to the receiver, so the hook is per receiver and fans
   * out to every instance attached to it. Each transition maps to a state the
   * instance monitor already knows how to act on: 'error' → schedule
   * reconnect; a fresh 'reconnecting' → leave Bolt's own retry loop alone
   * (going stale hands it to the monitor); a recovered socket → 'connected'.
   */
  private watchSocketState(instanceId: string, config: InstanceConfig, receiver: SlackAppReceiver): void {
    this.instanceConfigs.set(instanceId, config);
    if (receiver.mode !== 'socket') return;
    receiver.onSocketStateChange = (state) => this.applySocketState(receiver, state);
  }

  /** Apply one socket transition to every instance attached to that receiver. */
  private applySocketState(receiver: SlackAppReceiver, state: SocketConnectionState): void {
    for (const attachment of receiver.attachments.values()) {
      const instanceId = attachment.instanceId;
      // A rebuilt instance leaves the old attachment's transitions behind.
      if (this.attachments.get(instanceId) !== attachment) continue;
      const config = this.instanceConfigs.get(instanceId);
      if (!config) continue;
      this.applySocketStateTo(instanceId, config, attachment, state);
    }
  }

  private applySocketStateTo(
    instanceId: string,
    config: InstanceConfig,
    attachment: SlackAttachment,
    state: SocketConnectionState,
  ): void {
    const setStatus = (status: ConnectionStatus): void => {
      this.updateInstanceStatus(instanceId, config, status).catch((err) => {
        this.logger.warn('Failed to update instance status from socket transition', {
          instanceId,
          error: String(err),
        });
      });
    };

    if (state === 'connected') {
      this.logger.info('Slack Socket Mode connection restored', { instanceId });
      void this.backfillMissedMessages(instanceId, attachment);
      setStatus({
        state: 'connected',
        since: new Date(),
        metadata: {
          profileName: attachment.botName,
          ownerIdentifier: attachment.botUserId,
        },
      });
      return;
    }

    if (state === 'reconnecting') {
      this.logger.warn('Slack Socket Mode reconnecting', { instanceId });
      setStatus({ state: 'reconnecting', since: new Date() });
      return;
    }

    if (state === 'disconnected') {
      this.logger.error('Slack Socket Mode connection lost', { instanceId });
      setStatus({
        state: 'error',
        since: new Date(),
        error: {
          code: SlackErrorCode.CONNECTION_FAILED,
          message: 'Socket Mode WebSocket disconnected',
          retryable: true,
        },
      });
    }
  }

  /**
   * Send a message through Slack
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const attachment = this.getAttachment(instanceId);
    const slackConfig = this.slackConfigs.get(instanceId) ?? {};
    const channelId = message.to;

    try {
      const correlationId = message.metadata?.correlationId as string | undefined;
      if (correlationId) this.captureT10(correlationId);

      const messageId = await this.dispatchMessageByType(attachment, channelId, message, slackConfig);

      if (correlationId) this.captureT11(correlationId);

      // Clear typing indicator after reply is delivered
      await this.clearActiveTyping(instanceId, channelId, attachment, message.replyTo ?? message.threadId);

      // Remove ack reaction if configured
      this.removeAckReaction(instanceId, channelId, attachment, message.replyTo, message.threadId);

      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId: channelId,
        threadId: message.threadId,
        to: message.to,
        content: { type: message.content.type, text: message.content.text },
        replyToId: message.replyTo,
        senderAgentId: message.metadata?.senderAgentId as string | undefined,
        systemNotice: message.metadata?.systemNotice as boolean | undefined,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof SlackError ? error.channelCode : SlackErrorCode.SEND_FAILED;
      const retryable = error instanceof SlackError ? error.recoverable : false;

      // Clear typing indicator on error too
      await this.clearActiveTyping(instanceId, channelId, attachment, message.replyTo ?? message.threadId);

      // Remove ack reaction on error too (best effort)
      this.removeAckReaction(instanceId, channelId, attachment, message.replyTo, message.threadId);

      await this.emitMessageFailed({
        instanceId,
        chatId: channelId,
        error: errorMessage,
        errorCode,
        retryable,
      });

      return {
        success: false,
        error: errorMessage,
        errorCode,
        retryable,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Create a stream sender for progressive message rendering
   */
  createStreamSender(
    instanceId: string,
    chatId: string,
    replyToMessageId?: string,
    _chatType?: 'dm' | 'group' | 'channel',
    options?: { formatMode?: 'convert' | 'passthrough' },
  ): StreamSender {
    const attachment = this.getAttachment(instanceId);
    const slackConfig = this.slackConfigs.get(instanceId) ?? {};
    const replyToMode = slackConfig.replyToMode ?? 'all';
    const threadTs = this.resolveThreadTs(replyToMode, replyToMessageId, undefined);

    const streamMode = resolveStreamMode(slackConfig.streamMode);
    const throttleMs = resolveStreamThrottle(slackConfig.streamThrottleMs);

    const streamKey = `${instanceId}:${chatId}`;
    let native: NativeStreamSender | undefined;
    let base: StreamSender;
    if (streamMode === 'native') {
      native = createNativeStreamSender({
        client: attachment.actingClient,
        channelId: chatId,
        threadTs,
        throttleMs,
        username: slackConfig.defaultUsername,
        iconUrl: slackConfig.defaultIconUrl,
        iconEmoji: slackConfig.defaultIconEmoji,
        formatMode: options?.formatMode ?? 'convert',
        logger: this.logger,
      });
      base = native;
      this.trackNativeStream(streamKey, native);
    } else {
      base = createSlackStreamSender({
        client: attachment.actingClient,
        channelId: chatId,
        threadTs,
        streamMode,
        throttleMs,
        username: slackConfig.defaultUsername,
        iconUrl: slackConfig.defaultIconUrl,
        iconEmoji: slackConfig.defaultIconEmoji,
        formatMode: options?.formatMode ?? 'convert',
        logger: this.logger,
      });
    }

    // Wrap to clean up ack reactions and typing on stream completion.
    // sendMessage handles cleanup for non-streamed replies, but streamed replies
    // bypass sendMessage entirely — reactions accumulate indefinitely without this.
    const cleanup = () => {
      if (native) this.untrackNativeStream(streamKey, native);
      this.removeAckReaction(instanceId, chatId, attachment, replyToMessageId, threadTs);
      this.clearActiveTyping(instanceId, chatId, attachment, threadTs).catch(() => {});
    };

    return {
      onThinkingDelta: base.onThinkingDelta.bind(base),
      onContentDelta: base.onContentDelta.bind(base),
      async onFinal(delta) {
        await base.onFinal(delta);
        cleanup();
      },
      async onError(delta) {
        await base.onError(delta);
        cleanup();
      },
      async abort() {
        await base.abort();
        cleanup();
      },
      async cancel() {
        // User-requested stop (#914): keep the partial output
        await (base.cancel ? base.cancel() : base.abort());
        cleanup();
      },
    };
  }

  private trackNativeStream(streamKey: string, sender: NativeStreamSender): void {
    let set = this.activeNativeStreams.get(streamKey);
    if (!set) {
      set = new Set();
      this.activeNativeStreams.set(streamKey, set);
    }
    set.add(sender);
  }

  private untrackNativeStream(streamKey: string, sender: NativeStreamSender): void {
    const set = this.activeNativeStreams.get(streamKey);
    if (!set) return;
    set.delete(sender);
    if (set.size === 0) this.activeNativeStreams.delete(streamKey);
  }

  /**
   * Tell the live native streams in a channel which of them Slack already
   * halted (`agent_session_stopped.streaming_message_ts`), so the dispatcher's
   * subsequent cancel does not call chat.stopStream on a finished stream.
   */
  private markStreamsStoppedByPlatform(instanceId: string, channelId: string, stoppedTs: readonly string[]): void {
    if (stoppedTs.length === 0) return;
    const senders = this.activeNativeStreams.get(`${instanceId}:${channelId}`);
    if (!senders) return;
    for (const sender of senders) {
      sender.markStoppedByPlatform(stoppedTs);
    }
  }

  /**
   * Send typing indicator via the Agent Sessions status API.
   *
   * **Thread-only / no-op for channels and DMs.** Slack's status surface is
   * session/thread-scoped (`agents.sessions.setStatus`, legacy
   * `assistant.threads.setStatus` as fallback). There is no general "user is
   * typing" indicator for channels or DMs — hence `canSendTyping: false` in
   * capabilities. This method exists for the thread context and no-ops (with
   * a debug log, #914) when no active thread is tracked.
   *
   * Slack clears status when the agent replies, when status is cleared, or
   * after Slack's own timeout. Omni can also clear earlier when callers pass
   * an explicit duration.
   */
  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    await this.sendPresenceStatus(instanceId, chatId, duration === 0 ? 'paused' : 'typing', duration);
  }

  /**
   * Send Slack's official agent session status.
   *
   * This is intentionally separate from `canSendTyping`: Slack does not expose
   * generic channel typing for bots, but the Agent Sessions status API is the
   * official status surface for AI agent threads.
   */
  async sendPresenceStatus(
    instanceId: string,
    chatId: string,
    type: SlackPresenceType,
    duration?: number,
    options?: { threadId?: string; status?: string; loadingMessages?: string[] },
  ): Promise<SlackPresenceStatusResult> {
    // Nominal method on the bail paths below: no call is attempted, but
    // callers key off `method` to distinguish Slack's session-status surface
    // from a plain typing indicator, so it must not fall back to some other
    // channel's default (#914 review).
    const nominalMethod: SlackStatusMethod = 'agents.sessions.setStatus';

    const attachment = this.attachments.get(instanceId);
    if (!attachment) return { delivered: false, method: nominalMethod, reason: 'not_connected' };

    const threadTs = options?.threadId ?? this.activeThreads.get(`${instanceId}:${chatId}`);
    if (!threadTs) {
      // Slack status is thread-scoped; a channel-level mention has no thread
      // to attach to. Logged so the missing status is diagnosable (#914).
      this.logger.debug('Slack presence status skipped', {
        instanceId,
        chatId,
        type,
        reason: 'no_active_thread',
      });
      return { delivered: false, method: nominalMethod, reason: 'no_active_thread' };
    }

    const shouldClear = type === 'paused';
    const status = shouldClear ? '' : (options?.status ?? (type === 'recording' ? 'is recording...' : 'is typing...'));
    const timerKey = this.presenceStatusTimerKey(instanceId, chatId, threadTs);

    const statusResult =
      status === ''
        ? await clearTypingStatus({
            client: attachment.actingClient,
            attachment,
            channelId: chatId,
            threadTs,
            logger: this.logger,
            instanceId,
          })
        : await setSlackThreadStatus({
            client: attachment.actingClient,
            attachment,
            channelId: chatId,
            threadTs,
            status,
            loadingMessages: options?.loadingMessages,
            logger: this.logger,
            instanceId,
          });
    const { delivered, method } = statusResult;

    // Echo only what was actually applied (#914 review): the Agent Sessions
    // API takes a lifecycle enum and accepts no loading messages, so the
    // caller's freeform status/loading copy is only in effect when the legacy
    // API delivered it. Failed calls echo the attempted values for diagnostics.
    const usedLegacy = method === 'assistant.threads.setStatus';
    const sessionStatus = shouldClear ? 'active' : 'processing';
    const appliedStatus = !delivered || usedLegacy ? status : sessionStatus;
    const appliedLoadingMessages = !delivered || usedLegacy ? options?.loadingMessages : undefined;

    if (delivered) {
      this.clearPresenceStatusTimer(timerKey);
    }

    if (delivered && status !== '' && duration && duration > 0) {
      const timer = setTimeout(() => {
        if (this.presenceStatusTimers.get(timerKey) !== timer) return;
        this.presenceStatusTimers.delete(timerKey);
        clearTypingStatus({
          client: attachment.actingClient,
          attachment,
          channelId: chatId,
          threadTs,
          logger: this.logger,
        }).catch((err) => {
          this.logger.warn('Slack presence status auto-clear failed', {
            instanceId,
            channelId: chatId,
            threadTs,
            error: String(err),
          });
        });
      }, duration);
      this.presenceStatusTimers.set(timerKey, timer);
      timer.unref?.();
    }

    return delivered
      ? {
          delivered: true,
          method,
          threadId: threadTs,
          status: appliedStatus,
          loadingMessages: appliedLoadingMessages,
        }
      : {
          delivered: false,
          method: method ?? nominalMethod,
          threadId: threadTs,
          status: appliedStatus,
          loadingMessages: appliedLoadingMessages,
          reason: 'slack_status_failed',
        };
  }

  private presenceStatusTimerKey(instanceId: string, channelId: string, threadTs: string): string {
    return `${instanceId}:${channelId}:${threadTs}`;
  }

  private clearPresenceStatusTimer(timerKey: string): void {
    const timer = this.presenceStatusTimers.get(timerKey);
    if (!timer) return;
    clearTimeout(timer);
    this.presenceStatusTimers.delete(timerKey);
  }

  /**
   * Edit a message
   */
  async editMessage(instanceId: string, channelId: string, messageTs: string, newText: string): Promise<void> {
    const attachment = this.getAttachment(instanceId);
    await editSlackMessage(attachment.actingClient, channelId, messageTs, newText, 'convert', this.logger);
  }

  /**
   * Delete a message
   */
  async deleteMessage(instanceId: string, channelId: string, messageTs: string): Promise<void> {
    const attachment = this.getAttachment(instanceId);
    await deleteSlackMessage(attachment.actingClient, channelId, messageTs, this.logger);
  }

  /**
   * Schedule a message natively via chat.scheduleMessage (#889).
   *
   * Returns the scheduled_message_id, which is the cancellation handle — not
   * the eventual message ts. Text only for now: chat.scheduleMessage takes no
   * file upload, so media has to be uploaded at send time by the local path.
   */
  async scheduleMessage(instanceId: string, message: OutgoingMessage, sendAt: Date): Promise<string> {
    const attachment = this.getAttachment(instanceId);
    const config = this.slackConfigs.get(instanceId);

    if (message.content.type !== 'text' || !message.content.text) {
      throw new SlackError(
        SlackErrorCode.SEND_FAILED,
        `Only text messages can be scheduled (got '${message.content.type}') — chat.scheduleMessage carries no attachment.`,
      );
    }

    const threadTs = this.resolveThreadTs(config?.replyToMode ?? 'all', message.replyTo, message.threadId);

    return scheduleTextMessage(
      attachment.actingClient,
      {
        channelId: message.to,
        text: message.content.text,
        threadTs,
        replyBroadcast: message.metadata?.isThreadBroadcast === true,
        username: config?.defaultUsername,
        iconUrl: config?.defaultIconUrl,
        iconEmoji: config?.defaultIconEmoji,
        formatMode: message.metadata?.messageFormatMode,
        postAt: sendAt,
      },
      this.logger,
    );
  }

  /**
   * Resolve (or open) the DM channel with a user (#889).
   *
   * Before this the plugin could only reply to a DM that arrived — there was
   * no way to START one, because nothing mapped a user id to its DM channel.
   * That is the difference between a reactive bot and a consultative agent.
   *
   * Slack's conversations.open is idempotent: calling it for an existing DM
   * returns the same channel rather than creating a second one.
   *
   * @param instanceId - Instance to open as
   * @param userId - Slack user id (`U…`) to open a DM with
   * @returns The DM channel id (`D…`)
   */
  async openDirectMessage(instanceId: string, userId: string): Promise<string> {
    const attachment = this.getAttachment(instanceId);

    try {
      const result = await attachment.actingClient.conversations.open({ users: userId });
      const channelId = (result.channel as { id?: string } | undefined)?.id;
      if (!channelId) {
        throw new SlackError(SlackErrorCode.SEND_FAILED, `conversations.open returned no channel for user ${userId}`);
      }
      return channelId;
    } catch (error) {
      if (error instanceof SlackError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to open DM with ${userId}: ${message}`);
    }
  }

  /**
   * Full-text message search (#889).
   *
   * User token only — `search.messages` requires the `search:read` scope,
   * which a bot token cannot hold. In bot mode this throws rather than
   * returning an empty list, so the caller learns the capability is missing
   * instead of concluding there were no matches.
   *
   * Note results are affected by the search preferences set in that user's
   * Slack UI, so this is not a neutral index query.
   */
  async searchMessages(
    instanceId: string,
    query: string,
    options: { count?: number; page?: number } = {},
  ): Promise<Array<{ channelId?: string; ts?: string; text?: string; permalink?: string; username?: string }>> {
    const attachment = this.getAttachment(instanceId);
    const config = this.slackConfigs.get(instanceId);

    if (config?.authMode !== 'user' || !attachment.userClient) {
      throw new SlackError(
        SlackErrorCode.SEND_FAILED,
        "search.messages needs a user token (search:read); this instance runs in 'bot' auth mode",
      );
    }

    try {
      const result = await attachment.userClient.search.messages({
        query,
        count: options.count ?? 20,
        page: options.page ?? 1,
      });

      const matches = (result.messages as { matches?: unknown[] } | undefined)?.matches ?? [];
      return matches.map((raw) => {
        const m = raw as {
          channel?: { id?: string };
          ts?: string;
          text?: string;
          permalink?: string;
          username?: string;
        };
        return {
          channelId: m.channel?.id,
          ts: m.ts,
          text: m.text,
          permalink: m.permalink,
          username: m.username,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SlackError(SlackErrorCode.SEND_FAILED, `Search failed: ${message}`);
    }
  }

  /** Cancel a natively scheduled message (#889). */
  async cancelScheduledMessage(instanceId: string, channelId: string, scheduledId: string): Promise<void> {
    const attachment = this.getAttachment(instanceId);
    await cancelScheduledSlackMessage(attachment.actingClient, channelId, scheduledId, this.logger);
  }

  /**
   * Resolve a permalink to a message (#889).
   *
   * Slack has no quote API — the client renders the card by unfurling a
   * permalink — so this is the input a quote is built from. Returns null
   * rather than throwing: a missing permalink degrades a quote to a
   * blockquote, it does not fail the send.
   */
  async getPermalink(instanceId: string, channelId: string, messageTs: string): Promise<string | null> {
    const attachment = this.getAttachment(instanceId);
    try {
      const result = await attachment.actingClient.chat.getPermalink({
        channel: channelId,
        message_ts: messageTs,
      });
      return (result.permalink as string | undefined) ?? null;
    } catch (error) {
      this.logger.warn('Failed to resolve permalink', {
        error: error instanceof Error ? error.message : String(error),
        channelId,
        messageTs,
      });
      return null;
    }
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(instanceId: string, channelId: string, messageTs: string, emoji: string): Promise<void> {
    const attachment = this.getAttachment(instanceId);
    const { addReaction } = await import('./tools');
    await addReaction(attachment.actingClient, channelId, messageTs, emoji, this.logger);
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(instanceId: string, channelId: string, messageTs: string, emoji: string): Promise<void> {
    const attachment = this.getAttachment(instanceId);
    const { removeReaction } = await import('./tools');
    await removeReaction(attachment.actingClient, channelId, messageTs, emoji, this.logger);
  }

  /**
   * Get bot profile
   */
  async getProfile(instanceId: string): Promise<{
    name?: string;
    avatarUrl?: string;
    bio?: string;
    ownerIdentifier?: string;
    platformMetadata: Record<string, unknown>;
  }> {
    const attachment = this.getAttachment(instanceId);

    return {
      name: attachment.botName,
      avatarUrl: undefined,
      bio: undefined,
      ownerIdentifier: attachment.botUserId,
      platformMetadata: {
        botUserId: attachment.botUserId,
        teamId: attachment.teamId,
        teamName: attachment.teamName,
      },
    };
  }

  /**
   * Fetch user profile
   */
  async fetchUserProfile(
    instanceId: string,
    userId: string,
  ): Promise<{
    displayName?: string;
    avatarUrl?: string;
    bio?: string;
    phone?: string;
    platformData?: Record<string, unknown>;
  }> {
    const attachment = this.getAttachment(instanceId);

    try {
      const result = await attachment.actingClient.users.info({ user: userId });
      const user = result.user as Record<string, unknown> | undefined;
      if (!user) return {};

      const profile = user.profile as Record<string, unknown> | undefined;
      return {
        displayName: (profile?.display_name as string) || (profile?.real_name as string) || (user.name as string),
        avatarUrl: profile?.image_192 as string | undefined,
        bio: profile?.status_text as string | undefined,
        phone: profile?.phone as string | undefined,
        platformData: {
          username: user.name,
          realName: profile?.real_name,
          isBot: user.is_bot,
          isAdmin: user.is_admin,
          timezone: user.tz,
        },
      };
    } catch (error) {
      this.logger.warn('Failed to fetch user profile', { userId, error: String(error) });
      return {};
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Resolve user display name with caching.
   * Caches both successful and failed lookups to avoid repeated API calls
   * (prevents rate-limit storms when users.info consistently fails for a user).
   */
  private async resolveUserDisplayName(instanceId: string, userId: string): Promise<string | undefined> {
    const cacheKey = `${instanceId}:${userId}`;
    if (this.userNameCache.has(cacheKey)) {
      return this.userNameCache.get(cacheKey) ?? undefined;
    }

    try {
      const profile = await this.fetchUserProfile(instanceId, userId);
      if (profile.displayName) {
        this.userNameCache.set(cacheKey, profile.displayName);
        return profile.displayName;
      }
    } catch {
      // fetchUserProfile already logs the warning
    }
    // Cache the failure (null sentinel) so we don't retry on every message
    this.userNameCache.set(cacheKey, null);
    return undefined;
  }

  /**
   * Resolve a channel's name via conversations.info, cached like user names (#1162).
   * channel_rename overwrites the cache entry, so the next message refreshes the chat row.
   */
  private async resolveChannelName(instanceId: string, channelId: string): Promise<string | undefined> {
    const cacheKey = `${instanceId}:channel:${channelId}`;
    if (this.userNameCache.has(cacheKey)) {
      return this.userNameCache.get(cacheKey) ?? undefined;
    }

    let name: string | undefined;
    try {
      const result = await this.getAttachment(instanceId).actingClient.conversations.info({ channel: channelId });
      name = (result.channel as { name?: string } | undefined)?.name || undefined;
    } catch (error) {
      this.logger.warn('Failed to fetch channel info', { channelId, error: String(error) });
    }
    this.userNameCache.set(cacheKey, name ?? null);
    return name;
  }

  /** channel_rename: overwrite the cached channel name so the next message refreshes the chat row (#1162). */
  private handleChannelRename(instanceId: string, event: unknown): void {
    const channel = (event as { channel?: { id?: string; name?: string } }).channel;
    if (channel?.id && channel.name) this.userNameCache.set(`${instanceId}:channel:${channel.id}`, channel.name);
  }

  /**
   * Resolve thread_ts based on replyToMode config
   *
   * - 'off': Only thread if already in a thread context (threadId set)
   * - 'first': Thread when replyTo is available (first reply creates thread)
   * - 'all': Always use available thread context (replyTo or threadId)
   */
  private resolveThreadTs(
    replyToMode: ReplyToMode,
    replyTo: string | undefined,
    threadId: string | undefined,
  ): string | undefined {
    switch (replyToMode) {
      case 'all':
      case 'first':
        return replyTo ?? threadId;
      default:
        // 'off' or unrecognized: only thread if already in a thread context
        return threadId;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Thread History & Reactions (per_thread collaboration sessions)
  // ─────────────────────────────────────────────────────────────

  /** Map unicode emoji to Slack reaction names */
  private static readonly EMOJI_TO_SLACK: Record<string, string> = {
    '👀': 'eyes',
    '🎧': 'headphones',
    '✅': 'white_check_mark',
    '❌': 'x',
  };

  /**
   * Fetch message history for a Slack thread (conversations.replies).
   * Supports per_thread collaboration session lazy init.
   */
  async fetchHistory(instanceId: string, options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    const attachment = this.getAttachment(instanceId);
    const channelId = options.channelId ?? options.threadId;
    const threadTs = options.threadId;

    if (!channelId || !threadTs) return { totalFetched: 0, messages: [] };

    const botUserId = attachment.botUserId;
    // Read the token off the CONNECTION, not slackConfigs (#889).
    //
    // resolveSlackTokens accepts the token from config OR from `credentials`,
    // but this used to look only at slackConfigs.botToken. An instance
    // configured through credentials therefore returned an empty history with
    // nothing but a warning — a silent hole in per_thread context, not an
    // error anyone would notice. attachment.botToken is whatever was resolved,
    // so it is populated either way.
    const botToken = attachment.botToken;

    const limit = options.limit ?? 200;
    // Always fetch fresh history — the thread-starter cache uses a long TTL (6h)
    // designed for thread root resolution, not full conversation history. Using it
    // here would return stale data missing newer replies.
    const messages = await this.paginateThreadHistory(attachment, channelId, threadTs, botUserId, botToken, limit);

    return { totalFetched: messages.length, messages };
  }

  /** Paginate through conversations.replies and collect HistorySyncMessages. */
  private async paginateThreadHistory(
    attachment: SlackAttachment,
    channelId: string,
    threadTs: string,
    botUserId: string | undefined,
    botToken: string,
    maxMessages: number,
  ): Promise<HistorySyncMessage[]> {
    const messages: HistorySyncMessage[] = [];
    let cursor: string | undefined;

    do {
      const response = await attachment.actingClient.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: Math.min(200, maxMessages - messages.length),
        cursor,
      });

      for (const msg of (response.messages ?? []) as Record<string, unknown>[]) {
        const result = await this.buildHistorySyncMessage(msg, channelId, botUserId, botToken, attachment.botId);
        if (result) messages.push(result);
        if (messages.length >= maxMessages) break;
      }

      cursor = response.response_metadata?.next_cursor ?? undefined;
    } while (cursor && messages.length < maxMessages);

    return messages;
  }

  /** Download a Slack private file to a temp path and return its MIME type + local path. */
  private async downloadSlackMediaToTemp(
    file: Record<string, unknown>,
    botToken: string,
    ts: string,
  ): Promise<{ mimeType: string; localPath: string | undefined }> {
    const mimeType = (file.mimetype as string) ?? 'application/octet-stream';
    const urlPrivate = (file.url_private_download as string | undefined) ?? (file.url_private as string | undefined);

    if (!urlPrivate) return { mimeType, localPath: undefined };

    try {
      const { buffer } = await downloadSlackFile(urlPrivate, botToken, this.logger);
      const ext = (mimeType.split('/')[1]?.split(';')[0] ?? 'bin').replace(/[^a-z0-9]/gi, '');
      const tmpPath = join(tmpdir(), `omni-slack-hist-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
      await writeFile(tmpPath, buffer);
      return { mimeType, localPath: tmpPath };
    } catch (err) {
      this.logger.debug('fetchHistory: file download failed', { error: String(err), ts });
      return { mimeType, localPath: undefined };
    }
  }

  /** Convert a raw Slack message to HistorySyncMessage, or null to skip (bot/own message). */
  private async buildHistorySyncMessage(
    msg: Record<string, unknown>,
    channelId: string,
    botUserId: string | undefined,
    botToken: string,
    ownBotId?: string,
  ): Promise<HistorySyncMessage | null> {
    const userId = msg.user as string | undefined;
    // Same rule as live inbound (#1151): a human posting via an app keeps `user` + `bot_id`.
    if (!userId || shouldSkipMessage(msg, [botUserId], ownBotId)) return null;

    const ts = msg.ts as string;
    const text = (msg.text as string | undefined) ?? '';
    const files = msg.files as Record<string, unknown>[] | undefined;
    const timestamp = new Date(Number.parseFloat(ts) * 1000);

    if (files && files.length > 0) {
      const { mimeType, localPath } = await this.downloadSlackMediaToTemp(
        files[0] as Record<string, unknown>,
        botToken,
        ts,
      );
      return {
        externalId: ts,
        chatId: channelId,
        from: userId,
        timestamp,
        content: {
          type: getContentTypeFromMime(mimeType),
          text: text || undefined,
          mimeType,
          localPath,
          caption: text || undefined,
        },
        isFromMe: false,
        rawPayload: msg,
      };
    }

    return {
      externalId: ts,
      chatId: channelId,
      from: userId,
      timestamp,
      content: { type: 'text', text: text || undefined },
      isFromMe: false,
      rawPayload: msg,
    };
  }

  /**
   * Add a reaction emoji to a Slack message (per_thread media processing feedback).
   */
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const attachment = this.getAttachment(instanceId);
    const slackName = SlackPlugin.EMOJI_TO_SLACK[emoji] ?? emoji.replace(/^:|:$/g, '');
    try {
      await attachment.actingClient.reactions.add({ channel: chatId, timestamp: messageId, name: slackName });
    } catch (err) {
      this.logger.warn('react: failed to add reaction', { chatId, messageId, emoji, error: String(err) });
    }
  }

  /**
   * Remove a reaction emoji from a Slack message.
   */
  async unreact(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const attachment = this.getAttachment(instanceId);
    const slackName = SlackPlugin.EMOJI_TO_SLACK[emoji] ?? emoji.replace(/^:|:$/g, '');
    try {
      await attachment.actingClient.reactions.remove({ channel: chatId, timestamp: messageId, name: slackName });
    } catch (err) {
      this.logger.warn('unreact: failed to remove reaction', { chatId, messageId, emoji, error: String(err) });
    }
  }

  /**
   * Add ack reaction on inbound message receipt.
   * Fire-and-forget — reaction failures don't block message processing.
   */
  private addAckReaction(
    instanceId: string,
    channelId: string,
    messageTs: string,
    attachment: SlackAttachment,
    config: SlackConfig,
  ): void {
    const ackEmoji = config.ackReaction;
    if (!ackEmoji) return;

    const emojiName = typeof ackEmoji === 'string' ? ackEmoji.replace(/^:|:$/g, '') : null;
    if (!emojiName) return;

    // Fire-and-forget
    attachment.actingClient.reactions
      .add({ channel: channelId, timestamp: messageTs, name: emojiName })
      .catch((err) => {
        this.logger.warn('ack reaction: failed to add', { channelId, messageTs, emoji: emojiName, error: String(err) });
      });

    // Track for removal if configured
    if (config.removeAckAfterReply !== false) {
      const key = `${instanceId}:${channelId}:${messageTs}`;
      this.pendingAckReactions.set(key, emojiName);
      // Auto-clean after 1 hour to prevent unbounded growth if the agent never replies
      const timer = setTimeout(() => this.pendingAckReactions.delete(key), 3_600_000);
      timer.unref?.();
    }
  }

  /**
   * Remove pending ack reaction after a reply is sent.
   * Fire-and-forget — failure doesn't block message processing.
   */
  private removeAckReaction(
    instanceId: string,
    channelId: string,
    attachment: SlackAttachment,
    replyTo: string | undefined,
    threadId: string | undefined,
  ): void {
    // Try both replyTo and threadId as the acked message ts
    for (const ts of [replyTo, threadId]) {
      if (!ts) continue;
      const key = `${instanceId}:${channelId}:${ts}`;
      const emojiName = this.pendingAckReactions.get(key);
      if (!emojiName) continue;

      this.pendingAckReactions.delete(key);
      attachment.actingClient.reactions.remove({ channel: channelId, timestamp: ts, name: emojiName }).catch((err) => {
        this.logger.warn('ack reaction: failed to remove', { channelId, ts, emoji: emojiName, error: String(err) });
      });
      break; // Only remove once
    }
  }

  /**
   * Handle Slack's native stop button (`agent_session_stopped`, #914).
   *
   * Publishes `agent.run.cancel_requested` so the agent dispatcher aborts the
   * in-flight provider run, then transitions the session out of `processing`
   * (Slack's contract for this event) by clearing the thread status.
   */
  private async handleAgentSessionStopped(
    instanceId: string,
    attachment: SlackAttachment,
    args: { channelId: string; threadTs?: string; userId?: string; streamingMessageTs?: string[]; eventTs?: string },
  ): Promise<void> {
    // Slack event_ts is "seconds.micro"; the dispatcher compares this against
    // each run's start time so a late-delivered stop cannot abort a run that
    // began after the user pressed the button.
    const parsedEventTs = args.eventTs ? Number.parseFloat(args.eventTs) : Number.NaN;
    const requestedAt = Number.isFinite(parsedEventTs) ? Math.round(parsedEventTs * 1000) : Date.now();

    // Slack already halted these streams; flag them BEFORE the cancel fans
    // out so the sender's stop becomes a no-op instead of an API error.
    this.markStreamsStoppedByPlatform(instanceId, args.channelId, args.streamingMessageTs ?? []);

    try {
      await this.eventBus.publish(
        'agent.run.cancel_requested',
        {
          instanceId,
          chatId: args.channelId,
          threadId: args.threadTs,
          requestedBy: args.userId,
          requestedAt,
          reason: 'user_stop',
        },
        {
          instanceId,
          channelType: this.id,
          source: `channel:${this.id}`,
        },
      );
    } catch (err) {
      this.logger.error('Failed to publish agent.run.cancel_requested', {
        instanceId,
        chatId: args.channelId,
        error: String(err),
      });
    }

    await clearTypingStatus({
      client: attachment.actingClient,
      attachment,
      channelId: args.channelId,
      threadTs: args.threadTs ?? this.activeThreads.get(`${instanceId}:${args.channelId}`),
      logger: this.logger,
      instanceId,
    });
  }

  /** Remember the newest ts per channel and per thread for reconnect backfill (#1151). */
  private recordSeen(instanceId: string, msg: Record<string, unknown>): void {
    const channelId = msg.channel as string | undefined;
    const ts = msg.ts as string | undefined;
    if (!channelId || !ts) return;
    let seen = this.lastSeenTs.get(instanceId);
    if (!seen) {
      seen = new Map();
      this.lastSeenTs.set(instanceId, seen);
    }
    const threadTs = msg.thread_ts as string | undefined;
    const keys = threadTs && threadTs !== ts ? [channelId, `${channelId}:${threadTs}`] : [channelId];
    for (const key of keys) {
      const prev = seen.get(key);
      if (!prev || Number.parseFloat(ts) > Number.parseFloat(prev)) seen.set(key, ts);
    }
  }

  /**
   * Recover events Slack never delivered (#1151). The API-side replay only
   * re-dispatches rows already in the DB, so anything lost by a zombie socket
   * is unrecoverable there. On reconnect, pull conversations.history (and
   * replies for active threads) newer than the last ts seen per conversation
   * and feed them through the normal inbound handler.
   *
   * ponytail: last-seen ts is in-memory — a process restart starts fresh; persist it if restarts become the gap.
   */
  async backfillMissedMessages(instanceId: string, source: Pick<SlackAttachment, 'actingClient'>): Promise<number> {
    const seen = this.lastSeenTs.get(instanceId);
    const handle = this.inboundHandlers.get(instanceId);
    if (!seen?.size || !handle) return 0;

    const missed = new Map<string, Record<string, unknown>>();
    const collect = (channelId: string, oldest: string, msgs: unknown[] | undefined): void => {
      for (const raw of (msgs ?? []) as Record<string, unknown>[]) {
        const ts = raw.ts as string | undefined;
        if (!ts || Number.parseFloat(ts) <= Number.parseFloat(oldest)) continue;
        // History payloads omit channel/channel_type; D-prefixed ids are 1:1 DMs.
        missed.set(`${channelId}:${ts}`, {
          ...raw,
          channel: channelId,
          channel_type: raw.channel_type ?? (channelId.startsWith('D') ? 'im' : undefined),
        });
      }
    };

    for (const [key, oldest] of [...seen]) {
      const [channelId, threadTs] = key.split(':') as [string, string | undefined];
      try {
        if (threadTs) {
          const res = await source.actingClient.conversations.replies({ channel: channelId, ts: threadTs, oldest });
          collect(channelId, oldest, res.messages);
          continue;
        }
        const res = await source.actingClient.conversations.history({ channel: channelId, oldest, limit: 200 });
        collect(channelId, oldest, res.messages);
        for (const parent of (res.messages ?? []) as Record<string, unknown>[]) {
          const latestReply = parent.latest_reply as string | undefined;
          if (!latestReply || Number.parseFloat(latestReply) <= Number.parseFloat(oldest)) continue;
          const replies = await source.actingClient.conversations.replies({
            channel: channelId,
            ts: parent.ts as string,
            oldest,
          });
          collect(channelId, oldest, replies.messages);
        }
      } catch (err) {
        this.logger.warn('Slack backfill fetch failed', { instanceId, channelId, threadTs, error: String(err) });
      }
    }

    const ordered = [...missed.values()].sort(
      (a, b) => Number.parseFloat(a.ts as string) - Number.parseFloat(b.ts as string),
    );
    for (const msg of ordered) {
      this.recordSeen(instanceId, msg);
      try {
        await handle(msg);
      } catch (err) {
        this.logger.warn('Slack backfill dispatch failed', { instanceId, ts: msg.ts, error: String(err) });
      }
    }
    this.logger.info('Slack reconnect backfill complete', {
      instanceId,
      conversations: seen.size,
      recovered: ordered.length,
    });
    return ordered.length;
  }

  /**
   * Track the last active thread for a (instanceId, channelId) pair.
   * Used by sendTyping to call assistant.threads.setStatus on the right thread.
   *
   * Always sets a value — callers should pass `threadTs ?? externalId` so that
   * typing indicators for top-level messages target the thread the bot's reply
   * will create, rather than leaving a stale mapping from a previous message.
   */
  private trackActiveThread(instanceId: string, channelId: string, threadTs: string): void {
    this.activeThreads.set(`${instanceId}:${channelId}`, threadTs);
  }

  /**
   * Clear typing status after a reply is sent or an error occurs.
   * Uses the provided threadTs or falls back to the tracked active thread.
   */
  private async clearActiveTyping(
    instanceId: string,
    channelId: string,
    attachment: SlackAttachment,
    threadTs: string | undefined,
  ): Promise<void> {
    const resolvedThread = threadTs ?? this.activeThreads.get(`${instanceId}:${channelId}`);
    if (!resolvedThread) return;

    await clearTypingStatus({
      client: attachment.actingClient,
      attachment,
      channelId,
      threadTs: resolvedThread,
      logger: this.logger,
    });
    this.clearPresenceStatusTimer(this.presenceStatusTimerKey(instanceId, channelId, resolvedThread));
  }

  /**
   * Get the attachment for an instance — everything outbound acts through.
   */
  private getAttachment(instanceId: string): SlackAttachment {
    const attachment = this.attachments.get(instanceId);
    if (!attachment) {
      throw new SlackError(SlackErrorCode.NOT_CONNECTED, `Instance ${instanceId} not connected`);
    }
    return attachment;
  }

  /**
   * Create per-instance dedup cache + debounce manager.
   * Extracted to keep connect() below cognitive complexity threshold.
   */
  private createReliabilityCaches(
    _instanceId: string,
    debounceDelayMs: number | undefined,
  ): { dedupeCache: DedupeCache; debouncer: DebounceManager } {
    const dedupeCache = createInboundDedupeCache();
    const debouncer = new DebounceManager(
      { mode: 'fixed', delayMs: debounceDelayMs ?? 1500 },
      (_key, messages, _from, instId) => {
        for (const dMsg of messages) {
          const args = dMsg.payload as unknown as SlackDebouncedArgs;
          this.dispatchMessageFromDebounce(instId, args).catch((err) => {
            this.logger.warn('Debounce dispatch error', { instanceId: instId, error: String(err) });
          });
        }
      },
    );
    return { dedupeCache, debouncer };
  }

  /**
   * Dispose all reliability and thread caches for an instance.
   * Called on both clean disconnect and failed connect to prevent resource leaks.
   */
  private disposeInstanceCaches(instanceId: string): void {
    const debouncer = this.debouncers.get(instanceId);
    if (debouncer) {
      debouncer.flushAll();
      this.debouncers.delete(instanceId);
    }
    const dedupeCache = this.dedupeCaches.get(instanceId);
    if (dedupeCache) {
      dedupeCache.dispose();
      this.dedupeCaches.delete(instanceId);
    }
    const threadCache = this.threadCaches.get(instanceId);
    if (threadCache) {
      threadCache.dispose();
      this.threadCaches.delete(instanceId);
    }
  }

  /**
   * Enrich a raw Slack payload with cross-channel identity contract fields.
   * Used by both the debounce dispatch path and the direct onMessage callback.
   */
  private async buildEnrichedPayload(
    instanceId: string,
    from: string,
    chatId: string,
    rawPayload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const displayName = await this.resolveUserDisplayName(instanceId, from);
    const isDm = rawPayload.isDm as boolean;
    const isMpim = rawPayload.isMpim === true;

    // An mpim is a DIRECT conversation with SEVERAL people, so it is both
    // isDm and a group. Deriving isGroup from !isDm alone (as before mpim was
    // recognized) would file a multi-person DM as a 1:1 (#889).
    const isOneToOne = isDm && !isMpim;

    // Only a 1:1 has a single counterpart whose name can stand in for the
    // conversation name. For an mpim it would name the chat after whichever
    // member happened to speak. Channels carry their own name (#1162).
    const chatName = isOneToOne ? displayName : !isDm ? await this.resolveChannelName(instanceId, chatId) : undefined;

    return {
      ...rawPayload,
      displayName,
      senderName: displayName,
      pushName: displayName,
      chatName,
      isGroup: !isOneToOne,
    };
  }

  /**
   * Dispatch a single message from the debounce window to the inbound pipeline.
   * Mirrors the onMessage callback logic without going through the Bolt handler.
   */
  private async dispatchMessageFromDebounce(instanceId: string, args: SlackDebouncedArgs): Promise<void> {
    // Side effects that the debounce path must mirror from onMessage
    const threadTs = args.rawPayload.threadTs as string | undefined;
    this.trackActiveThread(instanceId, args.chatId, threadTs ?? args.externalId);

    const attachment = this.attachments.get(instanceId);
    const config = this.slackConfigs.get(instanceId);
    if (attachment && config) {
      this.addAckReaction(instanceId, args.chatId, args.externalId, attachment, config);
    }

    const enrichedPayload = await this.buildEnrichedPayload(instanceId, args.from, args.chatId, args.rawPayload);

    await this.handleMessageReceived(
      instanceId,
      args.externalId,
      args.chatId,
      args.from,
      args.content,
      args.replyToId,
      enrichedPayload,
      args.platformTimestamp,
    );
  }

  /**
   * Register every Bolt listener of a receiver — once, at its construction.
   *
   * This is the receiver's `registerHandlers` hook, not a per-instance setup.
   * The `App` is shared, so nothing here closes over one instance: the message
   * message, reaction, channel_rename and agent-session listeners resolve the
   * attachments Slack authorized for the event through
   * `receiver.targetsFor(body)`; only the envelope-less ones (pins,
   * interactions, commands) go through {@link fanoutTargets}.
   *
   * `config` is the SlackConfig of whichever instance first needed this
   * receiver. Only the slash-command NAMES are read from it, and those are a
   * property of the Slack app itself, which is exactly what a receiver is.
   * Everything per-instance (DM policy, channel filters, identities, dedupe,
   * debounce) lives on the attachment instead.
   */
  private setupHandlers(app: App, receiver: SlackAppReceiver, config: SlackConfig): void {
    // Revocation. The receiver decides WHICH attachments a revoked token or an
    // uninstall costs; the transition and the detach are the plugin's.
    receiver.onRevocation = (revocation) => this.handleRevocation(revocation);

    // Inbound messages. Each attachment of the event's workspace sees it
    // through its OWN handler, built at connect() by registerInboundHandler.
    app.message(async ({ message, body }) => {
      // Copied into a plain record rather than cast: Bolt's message union is a
      // set of interfaces, none of which carries an index signature.
      const raw: Record<string, unknown> = { ...message };
      for (const target of await receiver.targetsFor(routingEnvelope(body))) {
        // Record the newest ts per conversation BEFORE any filtering, so a
        // reconnect backfill (#1151) resumes exactly where delivery stopped.
        this.recordSeen(target.instanceId, raw);
        await this.inboundHandlers.get(target.instanceId)?.(raw);
      }
    });

    // Reactions. Registered here rather than through handlers/reactions.ts
    // because those listeners are handed no event envelope, and the envelope is
    // what says WHICH attachments the reaction is visible to.
    app.event('reaction_added', async ({ event, body }) => {
      await this.dispatchReaction(receiver, routingEnvelope(body), event, 'add');
    });
    app.event('reaction_removed', async ({ event, body }) => {
      await this.dispatchReaction(receiver, routingEnvelope(body), event, 'remove');
    });

    // Pin handlers (#889) — the manifest subscribes to pin_added/pin_removed;
    // these turn them into message.pinned/unpinned so core records the state.
    setupPinHandlers(
      app,
      receiver.key,
      {
        onPin: async (_instId, messageId, chatId, userId, action) => {
          for (const target of this.fanoutTargets(receiver)) {
            if (action === 'pin') {
              await this.emitMessagePinned({ instanceId: target.instanceId, messageId, chatId, from: userId });
            } else {
              await this.emitMessageUnpinned({ instanceId: target.instanceId, messageId, chatId, from: userId });
            }
          }
        },
      },
      this.logger,
    );

    // channel_rename (#1162) — refresh the cached name; the next message persists it.
    app.event('channel_rename', async ({ event, body }) => {
      for (const target of await receiver.targetsFor(routingEnvelope(body))) {
        this.handleChannelRename(target.instanceId, event);
      }
    });

    // Native stop button (#914). Registered here, and not through
    // handlers/agent-sessions.ts, for the same reason as the reactions above: a
    // stop press belongs to ONE member's session, so the targets have to come
    // from the event envelope rather than from every attachment.
    app.event('agent_session_stopped', async ({ event, body }) => {
      await this.dispatchAgentSessionStopped(receiver, routingEnvelope(body), event);
    });

    // Interaction handlers — handleInteraction is instance-agnostic.
    setupInteractionHandlers(
      app,
      receiver.key,
      {
        onInteraction: async (_instId, payload) => {
          await this.handleInteraction(payload);
        },
      },
      this.logger,
    );

    // Command handlers (if any commands are configured)
    const commands = (config as Record<string, unknown>).slashCommands as string[] | undefined;
    if (commands && commands.length > 0) {
      setupCommandHandlers(
        app,
        receiver.key,
        commands,
        {
          onCommand: async (payload) => {
            for (const target of this.fanoutTargets(receiver)) {
              await this.handleCommand({ ...payload, instanceId: target.instanceId });
            }
            return undefined;
          },
        },
        this.logger,
      );
    }
  }

  /**
   * Attachments a shared listener applies to when the event carries no
   * envelope to narrow by.
   *
   * Every listener that DOES see an envelope — messages, channel_rename,
   * reactions, the agent-session stop — resolves its targets through
   * `receiver.targetsFor(body)` instead, which delivers only to the
   * attachments Slack authorized. The pin, interaction and command modules hand
   * their callback a fixed instance id and no envelope, so there is no
   * workspace to key on there; those still apply to every attachment of the
   * receiver — which, on the single-attachment fast path, is the one instance
   * that used to own the App.
   */
  private fanoutTargets(receiver: SlackAppReceiver): SlackAttachment[] {
    return [...receiver.attachments.values()];
  }

  /**
   * Deliver one reaction event to each attachment it is authorized for, once.
   *
   * The per-target self-filter is what keeps a member's own reaction from
   * coming back to their own instance as inbound: in user mode the acting human
   * posts as themselves, so their user id — not just the bot's — is a self id.
   */
  private async dispatchReaction(
    receiver: SlackAppReceiver,
    envelope: SlackEventBody,
    event: SlackReactionEvent,
    action: 'add' | 'remove',
  ): Promise<void> {
    const userId = event.user;
    const channelId = event.item?.channel;
    const messageTs = event.item?.ts;
    if (!userId || !channelId || !messageTs) return;
    const emoji = event.reaction ?? '';

    for (const target of await receiver.targetsFor(envelope)) {
      if (userId === target.botUserId || userId === target.actingUserId) continue;
      this.logger.debug('Reaction received', {
        instanceId: target.instanceId,
        channelId,
        messageTs,
        emoji,
        userId,
        action,
      });
      await this.handleReactionReceived(target.instanceId, messageTs, channelId, userId, emoji, action);
    }
  }

  /** Cancel the in-flight run of each attachment the stop press is authorized for, once. */
  private async dispatchAgentSessionStopped(
    receiver: SlackAppReceiver,
    envelope: SlackEventBody,
    event: unknown,
  ): Promise<void> {
    const parsed = AgentSessionStoppedEventSchema.safeParse(event);
    if (!parsed.success) {
      // A stop with no channel cannot be routed to any run; anything else
      // malformed is worth a warning rather than a silent drop.
      const channelHint = (event as { channel?: unknown } | null | undefined)?.channel;
      if (typeof channelHint === 'string' && channelHint.length > 0) {
        this.logger.warn('Ignoring malformed agent_session_stopped event', {
          receiver: receiver.key,
          channelId: channelHint,
          issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
      }
      return;
    }

    const args: AgentSessionStoppedArgs = {
      channelId: parsed.data.channel,
      threadTs: parsed.data.thread_ts,
      userId: parsed.data.user,
      eventTs: parsed.data.event_ts,
      streamingMessageTs: parsed.data.streaming_message_ts ?? [],
    };

    for (const target of await receiver.targetsFor(envelope)) {
      this.logger.info('Agent session stopped by user', { instanceId: target.instanceId, ...args });
      await this.handleAgentSessionStopped(target.instanceId, target, args);
    }
  }

  /**
   * Slack revoked a workspace's access: transition every affected instance to
   * `disconnected` carrying the reason, then detach it.
   *
   * The transition goes through the same `updateInstanceStatus` +
   * `instance.disconnected` pair every other Slack disconnect uses, so the
   * instance monitor and the API see a revocation exactly as they see any other
   * disconnect — with `token_revoked` / `app_uninstalled` as the reason.
   */
  private async handleRevocation(revocation: SlackRevocation): Promise<void> {
    for (const attachment of revocation.attachments) {
      const instanceId = attachment.instanceId;
      this.logger.warn('Slack access revoked — disconnecting instance', {
        instanceId,
        teamId: revocation.teamId,
        reason: revocation.reason,
      });

      const config = this.instanceConfigs.get(instanceId);
      if (config) {
        await this.updateInstanceStatus(instanceId, config, {
          state: 'disconnected',
          since: new Date(),
          message: revocation.reason,
        });
      }

      await this.detachInstance(instanceId);
      this.inboundHandlers.delete(instanceId);
      this.disposeInstanceCaches(instanceId);
      await this.emitInstanceDisconnected(instanceId, revocation.reason);
    }
  }

  /**
   * Build one instance's inbound message handler and keep it for the
   * receiver's shared message listener — and for reconnect backfill (#1151) —
   * to call.
   *
   * No Bolt listener is registered here: the receiver owns the single
   * registration, so a second one per instance would deliver every message
   * twice. The attachment supplies the identities (bot user, acting user, bot
   * id) that used to be read off the connection through getters.
   */
  private registerInboundHandler(attachment: SlackAttachment): void {
    const instanceId = attachment.instanceId;
    const config = attachment.config;

    const handleInbound = setupMessageHandlers(
      undefined,
      attachment,
      undefined,
      {
        onMessage: async (_instId, externalId, chatId, from, content, replyToId, rawPayload, platformTimestamp) => {
          // Track active thread for typing indicator resolution.
          // For threaded messages, use threadTs. For top-level messages, use
          // the message's own externalId — the bot's reply will create a thread
          // under that ts, so typing indicators must target it. This also prevents
          // stale thread context from leaking into unrelated channel messages.
          const threadTs = rawPayload.threadTs as string | undefined;
          this.trackActiveThread(instanceId, chatId, threadTs ?? externalId);

          // Add ack reaction on message receipt (fire-and-forget)
          this.addAckReaction(instanceId, chatId, externalId, attachment, config);

          // Enrich rawPayload with cross-channel identity contract
          const enrichedPayload = await this.buildEnrichedPayload(instanceId, from, chatId, rawPayload);

          const files = enrichedPayload.files as unknown[] | undefined;
          if (files && files.length > 0) {
            await this.handleInboundFiles(
              instanceId,
              externalId,
              chatId,
              from,
              content,
              replyToId,
              enrichedPayload,
              platformTimestamp,
            );
            if (!content.text) return;
          }

          await this.handleMessageReceived(
            instanceId,
            externalId,
            chatId,
            from,
            content,
            replyToId,
            enrichedPayload,
            platformTimestamp,
          );
        },
        onDmRejected: async (_instId, channelId, _userId, message) => {
          try {
            await sendTextMessage(
              attachment.actingClient,
              {
                channelId,
                text: message,
                formatMode: 'passthrough',
              },
              this.logger,
            );
          } catch (err) {
            this.logger.warn('Failed to send DM rejection', { error: String(err) });
          }
        },
      },
      {
        policy: config.dmPolicy ?? 'open',
        allowlist: config.dmAllowlist,
        rejectionMessage: config.dmRejectionMessage,
      },
      this.logger,
      {
        channelAllowlist: config.channelAllowlist,
        channelBlocklist: config.channelBlocklist,
        channels: config.channels,
      },
      { dedupeCache: attachment.dedupeCache, debounceManager: attachment.debouncer },
    );
    this.inboundHandlers.set(instanceId, handleInbound);
  }

  /**
   * Dispatch outgoing message by content type
   */
  private async dispatchMessageByType(
    attachment: SlackAttachment,
    channelId: string,
    message: OutgoingMessage,
    config: SlackConfig,
  ): Promise<string> {
    switch (message.content.type) {
      case 'text':
        return this.sendTextContent(attachment, channelId, message, config);
      case 'image':
      case 'audio':
      case 'video':
      case 'document':
        return this.sendMediaContent(attachment, channelId, message, config);
      case 'reaction':
        return this.sendReactionContent(attachment, channelId, message);
      default:
        throw new SlackError(SlackErrorCode.SEND_FAILED, `Unsupported content type: ${message.content.type}`);
    }
  }

  /** Send text content */
  private async sendTextContent(
    attachment: SlackAttachment,
    channelId: string,
    message: OutgoingMessage,
    config: SlackConfig,
  ): Promise<string> {
    const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
    const replyToMode = config.replyToMode ?? 'all';
    const threadTs = this.resolveThreadTs(replyToMode, message.replyTo, message.threadId);

    return sendTextMessage(
      attachment.actingClient,
      {
        channelId,
        text: message.content.text ?? '',
        threadTs,
        username: config.defaultUsername,
        iconUrl: config.defaultIconUrl,
        iconEmoji: config.defaultIconEmoji,
        formatMode,
        ephemeral: message.metadata?.ephemeral === true,
        ephemeralUserId: message.metadata?.ephemeralUserId as string | undefined,
      },
      this.logger,
    );
  }

  /** Send media content (image, audio, video, document) */
  private async sendMediaContent(
    attachment: SlackAttachment,
    channelId: string,
    message: OutgoingMessage,
    config: SlackConfig,
  ): Promise<string> {
    const replyToMode = config.replyToMode ?? 'all';
    const threadTs = this.resolveThreadTs(replyToMode, message.replyTo, message.threadId);

    if (message.metadata?.base64) {
      const buffer = Buffer.from(message.metadata.base64 as string, 'base64');
      const filename = message.content.filename || `file-${Date.now()}`;
      return uploadFile(
        attachment.actingClient,
        {
          channelId,
          content: buffer,
          filename,
          threadTs,
          initialComment: message.content.text || message.content.caption,
        },
        this.logger,
      );
    }

    if (!message.content.mediaUrl) {
      throw new SlackError(SlackErrorCode.SEND_FAILED, 'Media URL or base64 required');
    }

    return uploadFileFromUrl(
      attachment.actingClient,
      {
        channelId,
        url: message.content.mediaUrl,
        filename: message.content.filename || `file-${Date.now()}`,
        threadTs,
        initialComment: message.content.text || message.content.caption,
      },
      this.logger,
    );
  }

  /** Send reaction to a message */
  private async sendReactionContent(
    attachment: SlackAttachment,
    channelId: string,
    message: OutgoingMessage,
  ): Promise<string> {
    const emoji = message.content.emoji;
    const targetTs = message.content.targetMessageId ?? message.replyTo;
    if (!emoji || !targetTs) {
      throw new SlackError(SlackErrorCode.SEND_FAILED, 'Reaction requires emoji and target message');
    }
    const { addReaction } = await import('./tools');
    await addReaction(attachment.actingClient, channelId, targetTs, emoji, this.logger);
    return targetTs;
  }

  /**
   * Emit inbound Slack file attachments.
   *
   * Slack `url_private*` links require bot-token auth.  Rather than downloading
   * the entire file here (which would copy large files entirely into heap memory
   * before base64-encoding them into a data: URI), we pass the private URL as
   * `mediaUrl` and include `_slackAuth.botToken` in `rawPayload`.  The
   * media-processor plugin reads that field and forwards it as an Authorization
   * header when it calls `storeFromUrl`, so the download happens exactly once
   * and never needs to be base64-encoded.
   */
  private async handleInboundFiles(
    instanceId: string,
    externalId: string,
    chatId: string,
    from: string,
    content: { text?: string },
    replyToId: string | undefined,
    rawPayload: Record<string, unknown>,
    platformTimestamp: number | undefined,
  ): Promise<void> {
    const files = rawPayload.files as unknown[] | undefined;
    if (!files || files.length === 0) return;

    const fileInfos = extractFileInfo(files);
    for (const fileInfo of fileInfos) {
      // Guard against oversized files before dispatching the event
      if (fileInfo.size > 0) {
        try {
          downloadGuard.checkSize(fileInfo.size, this.logger, { instanceId, channel: 'slack' });
        } catch {
          this.logger.warn('slack_file_too_large_skipped', { instanceId, fileId: fileInfo.id, size: fileInfo.size });
          continue;
        }
      }

      const contentType = getContentTypeFromMime(fileInfo.mimeType);
      const mediaUrl = fileInfo.urlPrivateDownload ?? fileInfo.urlPrivate;

      await this.handleMessageReceived(
        instanceId,
        `${externalId}-file-${fileInfo.id}`,
        chatId,
        from,
        { type: contentType as ContentType, text: content.text, mediaUrl, mimeType: fileInfo.mimeType },
        replyToId,
        // botToken is NOT included here — media-processor fetches it from the
        // instances table by instanceId so credentials never enter the event/DB
        { ...rawPayload, fileInfo },
        platformTimestamp,
      );
    }
  }

  /**
   * Handle incoming message (delegate to base class)
   */
  private async handleMessageReceived(
    instanceId: string,
    externalId: string,
    chatId: string,
    from: string,
    content: {
      type: ContentType;
      text?: string;
      mediaUrl?: string;
      mimeType?: string;
    },
    replyToId: string | undefined,
    rawPayload: Record<string, unknown>,
    platformTimestamp?: number,
  ): Promise<void> {
    const timings = platformTimestamp ? this.captureInboundTimings(platformTimestamp) : undefined;

    const senderName =
      typeof rawPayload.senderName === 'string'
        ? rawPayload.senderName
        : typeof rawPayload.displayName === 'string'
          ? rawPayload.displayName
          : undefined;
    const chatName = typeof rawPayload.chatName === 'string' ? rawPayload.chatName : undefined;

    // Thread vs reply (#889).
    //
    // Slack has no "reply to a specific message" primitive — threads ARE the
    // reply mechanism. We used to pass `thread_ts` as `replyToId`, which the
    // core stored in `replyToExternalId`, making a Slack thread reply
    // indistinguishable from a WhatsApp quote once persisted.
    //
    // `threadId` now carries `thread_ts` into its own column, and `replyToId`
    // stays empty for Slack. The incoming `replyToId` argument is retained in
    // the signature for the shared callback shape.
    const threadTs = typeof rawPayload.threadTs === 'string' ? rawPayload.threadTs : undefined;
    void replyToId;

    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      senderName,
      chatName,
      content,
      threadId: threadTs,
      rawPayload,
      timings,
    });

    if (timings) {
      this.captureT2(correlationId, timings);
    }
  }

  /**
   * Handle incoming reaction
   */
  private async handleReactionReceived(
    instanceId: string,
    messageId: string,
    chatId: string,
    userId: string,
    emoji: string,
    action: 'add' | 'remove',
  ): Promise<void> {
    if (action === 'add') {
      await this.emitReactionReceived({
        instanceId,
        messageId,
        chatId,
        from: userId,
        emoji,
        isCustomEmoji: false,
      });
    } else {
      await this.emitReactionRemoved({
        instanceId,
        messageId,
        chatId,
        from: userId,
        emoji,
        isCustomEmoji: false,
      });
    }
  }

  /**
   * Handle interaction (button, select, modal)
   */
  private async handleInteraction(payload: SlackInteractionPayload): Promise<void> {
    this.logger.debug('Interaction handled', {
      type: payload.type,
      actionId: payload.actionId,
      userId: payload.userId,
    });
    // Custom events would be published here for downstream processing
  }

  /**
   * Handle slash command — emit as inbound message.received so downstream
   * agents can process the command text just like any other message.
   */
  private async handleCommand(payload: CommandPayload): Promise<void> {
    this.logger.debug('Command received', {
      command: payload.command,
      userId: payload.userId,
      channelId: payload.channelId,
    });

    // Combine command + args into a single text string (e.g. "/remind 5min meeting")
    const text = payload.text ? `${payload.command} ${payload.text}` : payload.command;

    await this.handleMessageReceived(
      payload.instanceId,
      payload.triggerId,
      payload.channelId,
      payload.userId,
      { type: 'text', text },
      undefined,
      { command: payload.command, responseUrl: payload.responseUrl },
    );
  }
}
