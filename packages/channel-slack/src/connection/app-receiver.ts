/**
 * Shared Bolt receiver: one `App` per Slack app, many instances attached.
 *
 * Today every instance owns a whole Bolt `App` (bolt-client.ts). A personal
 * OAuth install puts N members of one workspace — and N workspaces of one
 * deployment app — behind the SAME app-level token, and Slack load-balances
 * an app's events across its Socket Mode connections. One receiver per
 * app-level token (or per signing secret + port in HTTP mode) is the only
 * arrangement where every attached instance sees every event.
 *
 * The `App` is constructed with `authorize` and never with `token`: Bolt
 * treats the two as exclusive, and per-event `authorize` is what lets one
 * receiver serve several workspaces. `authorize` answers with the bot token
 * of the most recently attached instance of the event's team, so a
 * reinstalled bot token wins. Handlers are registered once, at creation,
 * through the `registerHandlers` hook; `targetsFor(body)` answers with the
 * attachments Slack authorized THIS event for — see its own doc comment.
 *
 * The socket-health watchdog (#941/#1151) is the one in bolt-client.ts,
 * driven through a `BoltConnection`-shaped state so its behavior is shared,
 * not copied.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DedupeCache, Logger } from '@omni/channel-sdk';
import type { DebounceManager } from '@omni/core';
import {
  App,
  type AppOptions,
  type AuthorizeResult,
  type AuthorizeSourceData,
  HTTPReceiver,
  SocketModeReceiver,
} from '@slack/bolt';
import { WebClient, type WebClientOptions } from '@slack/web-api';
import { z } from 'zod';
import { REVOCATION_EVENTS } from '../manifest';
import type { SlackAuthMode, SlackConfig, SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';
import {
  type BoltConnection,
  type SocketConnectionState,
  isSocketOpen,
  isSocketStale,
  waitForSocketOpen,
  watchSocketLifecycle,
  withBodyLimit,
} from './bolt-client';

/** Default port for Bolt's built-in HTTP receiver, as in startBoltConnection. */
const DEFAULT_HTTP_PORT = 3001;

/**
 * How long one `apps.event.authorizations.list` answer is reused, keyed by
 * `event_context`.
 *
 * Slack allows 600 calls/min per app per workspace on that method, and a
 * single Slack event arrives at several listeners (message, reactions, the
 * agent-session stop), each of which resolves its own targets. One cached
 * answer per event context for a minute keeps a busy workspace to a handful of
 * calls while still noticing an install that appears or disappears.
 */
const AUTHORIZATIONS_CACHE_TTL_MS = 60_000;

/**
 * How many pages of `apps.event.authorizations.list` one event is worth.
 *
 * The method is cursor-paginated and answers 100 installations per page by
 * default, so five pages cover 500 installs of one workspace behind one app.
 * The bound exists because the lookup sits in front of event delivery: a
 * pathological workspace must cost a known number of calls, not an unbounded
 * walk. Hitting it is logged and the pages already fetched are used, which
 * narrows delivery rather than widening it.
 */
const MAX_AUTHORIZATIONS_PAGES = 5;

/** Installations per page; Slack's own default, stated so the bound above is arithmetic. */
const AUTHORIZATIONS_PAGE_SIZE = 100;

/**
 * One instance attached to a receiver. Everything a handler needs to act on
 * behalf of that instance; the receiver holds one per instance id.
 */
export interface SlackAttachment {
  instanceId: string;
  /** Slack workspace (team) id the instance is installed in. */
  teamId: string;
  authMode: SlackAuthMode;
  /** Client for outbound ACTIONS: the bot client in bot mode, the user client in user mode. */
  actingClient: WebClient;
  /** User-token (`xoxp`) client when authMode is 'user'; undefined otherwise. */
  userClient?: WebClient;
  /** Slack user id of the authorizing human in user mode. */
  actingUserId?: string;
  botUserId: string;
  botId: string;
  botToken: string;
  /** Bot's display name (auth.test `user`), reported as the instance profile name. */
  botName?: string;
  /**
   * Workspace display name (auth.test `team`), reported in the instance
   * profile. Left unset by the plugin's connect path: the receiver resolves
   * identity through resolveWorkspaceIdentity, whose contract is the four
   * fields `authorize` and the attachment map need, and `team` is not one of
   * them — a workspace name is worth neither a second auth.test nor widening
   * that contract.
   */
  teamName?: string;
  config: SlackConfig;
  dedupeCache: DedupeCache;
  debouncer: DebounceManager;
  /** Wall-clock time of attach; the most recently attached instance of a team answers `authorize`. */
  attachedAt: number;
}

/**
 * The shape of an inbound Slack event body as far as the receiver reads it.
 * Bolt's own body types differ per event family; the receiver only keys on
 * the workspace id, so anything carrying (or lacking) `team_id` is accepted.
 * The envelope's `team_id` is authoritative; `team.id` is how interaction and
 * slash-command payloads spell the same thing, and the inner event's `team` is
 * the fallback Slack uses for shared-channel and Slack Connect deliveries.
 */
export interface SlackEventBody {
  team_id?: string;
  api_app_id?: string;
  team?: { id?: string; [key: string]: unknown };
  event?: { team?: string; [key: string]: unknown };
  /**
   * The installations Slack says this event is visible to. Slack puts at most
   * ONE entry here and expects `apps.event.authorizations.list` to be asked
   * for the rest, which is exactly what {@link SlackAppReceiver.targetsFor}
   * does when more than one instance is attached for the workspace.
   */
  authorizations?: SlackAuthorization[];
  /** Opaque handle Slack mints per event, and the key of the authorizations lookup. */
  event_context?: string;
  /**
   * Slack's per-delivery event id. Stable across the redeliveries Slack sends
   * when an ack is late, which is what makes it a dedupe key.
   */
  event_id?: string;
  [key: string]: unknown;
}

/**
 * The fields of an event envelope that decide routing, in a shape Bolt's own
 * `EnvelopedEvent<…>` is assignable to.
 *
 * {@link SlackEventBody} cannot type a Bolt listener parameter: it describes
 * the inner `event` as an index-signature record, and Bolt's concrete event
 * interfaces are not assignable to that. This is the subset every routing
 * caller actually reads; the plugin widens it to `SlackEventBody`.
 */
export interface SlackRoutingFields {
  team_id?: string;
  authorizations?: SlackAuthorization[];
  event_context?: string;
  event_id?: string;
}

/**
 * One installation an event is authorized for, as both `body.authorizations`
 * and `apps.event.authorizations.list` spell it.
 *
 * Declared here rather than imported: Bolt types the envelope's entries with
 * required `user_id`/`is_bot` and nullable ids, `@slack/web-api` types the
 * listed ones with everything optional, and both are assignable to this.
 */
export interface SlackAuthorization {
  enterprise_id?: string | null;
  team_id?: string | null;
  user_id?: string;
  is_bot?: boolean;
  is_enterprise_install?: boolean;
}

/** Why Slack stopped authorizing a workspace: a revoked token, or an uninstall. */
export type SlackRevocationReason = 'token_revoked' | 'app_uninstalled';

/** One workspace losing access, with the attachments it costs. */
export interface SlackRevocation {
  reason: SlackRevocationReason;
  teamId: string;
  /** Attachments of that workspace the revocation applies to; never empty. */
  attachments: SlackAttachment[];
}

/**
 * Hook the plugin sets to act on a revocation: transition the instances and
 * detach them. A receiver with no listener detaches them itself, so a revoked
 * install never stays attached.
 */
export type RevocationListener = (revocation: SlackRevocation) => Promise<void>;

/** Hook the plugin supplies to register its listeners once per receiver. */
export type RegisterHandlers = (app: App, receiver: SlackAppReceiver) => void;

/** Socket health as seen by the watchdog; every field is undefined in HTTP mode. */
export interface SlackReceiverSocketHealth {
  open: boolean;
  stale: boolean;
  state?: SocketConnectionState;
}

/**
 * Identity of a receiver: instances whose options hash to the same key share
 * one `App`. The secret never appears in the key — only its SHA-256.
 *
 * - Socket Mode: `socket:<sha256(appToken)>`
 * - HTTP mode:   `http:<sha256(signingSecret)>:<httpPort>`
 */
export function receiverKeyFor(opts: SlackConnectionOptions): string {
  const mode = opts.mode ?? 'socket';
  if (mode === 'http') {
    if (!opts.signingSecret) {
      throw new SlackError(SlackErrorCode.CONNECTION_FAILED, 'signingSecret is required for HTTP mode');
    }
    return `http:${sha256(opts.signingSecret)}:${opts.httpPort ?? DEFAULT_HTTP_PORT}`;
  }
  if (!opts.appToken) {
    throw new SlackError(SlackErrorCode.CONNECTION_FAILED, 'appToken (xapp-...) is required for Socket Mode');
  }
  return `socket:${sha256(opts.appToken)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Same retry policy the per-instance Bolt app applies to its Web API client. */
function buildRetryConfig(opts: SlackConnectionOptions): NonNullable<WebClientOptions['retryConfig']> {
  return {
    retries: opts.retryConfig?.retries ?? 2,
    factor: opts.retryConfig?.factor ?? 2,
    minTimeout: opts.retryConfig?.baseDelayMs ?? 500,
    maxTimeout: opts.retryConfig?.maxDelayMs ?? 3000,
    randomize: true,
  };
}

/**
 * The `tokens` object of a `tokens_revoked` event, validated at the boundary.
 *
 * Slack lists the USER ids whose tokens went away: `oauth` the humans whose
 * user tokens were revoked, `bot` the bot users whose bot tokens were. Either
 * list may be absent, and an entry that is not a string is dropped rather than
 * allowed to match an attachment by accident.
 */
const RevokedTokensSchema = z.object({
  oauth: z.array(z.string()).optional(),
  bot: z.array(z.string()).optional(),
});

type RevokedTokens = z.infer<typeof RevokedTokensSchema>;

/**
 * Pick the attachments an event is authorized for out of one workspace's
 * attachments.
 *
 * A user-mode attachment is a target when its authorizing human is among the
 * authorizations; the bot identity is singular per workspace, so at most one
 * bot-mode attachment is a target, and only when some entry is the bot's. The
 * result keeps attach order, which is the order every other fan-out uses.
 */
function selectAuthorizedTargets(
  attachments: readonly SlackAttachment[],
  authorizations: readonly SlackAuthorization[],
): SlackAttachment[] {
  const authorizedUserIds = new Set<string>();
  let botIsAuthorized = false;
  for (const entry of authorizations) {
    if (entry.is_bot === true) {
      botIsAuthorized = true;
      continue;
    }
    if (entry.user_id) authorizedUserIds.add(entry.user_id);
  }

  const selected = new Set<SlackAttachment>();
  let botTarget: SlackAttachment | undefined;
  for (const attachment of attachments) {
    if (attachment.authMode === 'user') {
      if (attachment.actingUserId && authorizedUserIds.has(attachment.actingUserId)) selected.add(attachment);
      continue;
    }
    // Same recency rule `authorize` applies, so the token that answers for the
    // workspace and the instance that handles its events are the same install.
    if (botIsAuthorized && (!botTarget || attachment.attachedAt >= botTarget.attachedAt)) botTarget = attachment;
  }
  if (botTarget) selected.add(botTarget);

  return attachments.filter((attachment) => selected.has(attachment));
}

/** Merge the envelope's authorization with the listed ones, by (user, is_bot). */
function mergeAuthorizations(
  envelope: readonly SlackAuthorization[],
  listed: readonly SlackAuthorization[],
): SlackAuthorization[] {
  const merged = new Map<string, SlackAuthorization>();
  for (const entry of [...envelope, ...listed]) {
    merged.set(`${entry.user_id ?? ''}:${entry.is_bot === true}`, entry);
  }
  return [...merged.values()];
}

/** Whether a failed authorizations lookup failed for want of `authorizations:read`. */
function isMissingScopeFailure(message: string): boolean {
  return message.includes('missing_scope') || message.includes('not_allowed_token_type');
}

/**
 * One Bolt `App` shared by every instance behind the same app-level token
 * (or the same signing secret and port).
 */
export class SlackAppReceiver {
  readonly key: string;

  /** Transport this receiver runs on; the socket watchdog only applies to 'socket'. */
  readonly mode: 'socket' | 'http';
  /**
   * HTTP request handler for HTTP mode, wrapped with the 1 MB body-limit guard
   * (kept for external-server integration, as on BoltConnection). Undefined in
   * Socket Mode.
   */
  readonly httpHandler?: (req: IncomingMessage, res: ServerResponse) => void;

  /**
   * Set by the plugin to act on a revocation. Assigned through the
   * `registerHandlers` hook, like the Bolt listeners themselves.
   */
  onRevocation?: RevocationListener;

  private readonly app: App;
  private readonly logger: Logger;
  private readonly httpPort: number;
  private readonly retryConfig: NonNullable<WebClientOptions['retryConfig']>;
  private readonly attachmentMap = new Map<string, SlackAttachment>();
  private readonly botClients = new Map<string, WebClient>();
  /** Bot-token clients keyed by the token itself, so the identity probe and the attach share one. */
  private readonly clientsByToken = new Map<string, WebClient>();
  /**
   * Watchdog state, `BoltConnection`-shaped so bolt-client's socket-health
   * helpers drive it unchanged. `client`/`actingClient` are Bolt's tokenless
   * app client and `botToken` is empty: neither is used by the watchdog, and
   * every outbound call goes through the per-workspace clients instead.
   */
  private readonly connection: BoltConnection;
  /**
   * Client carrying the APP-LEVEL token (`xapp-…`), which is the only token
   * `apps.event.authorizations.list` accepts. Undefined in HTTP mode, where
   * there is no app-level token and the envelope's own authorization is all
   * the receiver has.
   */
  private readonly appLevelClient?: WebClient;
  /** Authorizations per `event_context`, with the TTL above. */
  private readonly authorizationsCache = new Map<string, { entries: SlackAuthorization[]; expiresAt: number }>();
  /** Set once the app-level token is known to lack `authorizations:read`; the warning is logged once. */
  private authorizationsScopeMissing = false;
  /** Workspaces whose narrowing has already been logged, so it is announced once per workspace. */
  private readonly narrowedTeams = new Set<string>();
  private running = false;

  constructor(opts: SlackConnectionOptions, registerHandlers: RegisterHandlers, logger: Logger) {
    this.key = receiverKeyFor(opts);
    this.logger = logger;
    this.mode = opts.mode ?? 'socket';
    this.httpPort = opts.httpPort ?? DEFAULT_HTTP_PORT;
    this.retryConfig = buildRetryConfig(opts);

    const { app, socketClient, httpHandler } = this.buildApp(opts);
    this.app = app;
    this.httpHandler = httpHandler;
    this.appLevelClient = opts.appToken ? new WebClient(opts.appToken, { retryConfig: this.retryConfig }) : undefined;
    this.connection = {
      app,
      client: app.client,
      actingClient: app.client,
      botToken: '',
      mode: this.mode,
      httpPort: this.httpPort,
      socketClient,
      socketState: socketClient ? 'pending' : undefined,
      socketConnectTimeoutMs: opts.socketConnectTimeoutMs,
    };
    watchSocketLifecycle(this.connection, logger);

    app.error(async (error) => {
      logger.error('Bolt.js global error', { receiver: this.key, error: String(error) });
    });

    // Handlers are registered exactly once per receiver, before any start —
    // Socket Mode drops events that arrive before their listener exists.
    registerHandlers(app, this);

    // Revocation. Registered with no `authorize` override on purpose: Bolt
    // skips `authorize` for these two events, so their listeners get no
    // authorized context at all and read the workspace off the envelope's
    // `team_id` — the one field Slack does send.
    for (const eventName of REVOCATION_EVENTS) {
      app.event(eventName, async ({ body, event }) => {
        const tokens = event.type === 'tokens_revoked' ? event.tokens : undefined;
        await this.handleRevocation(event.type, body.team_id, tokens);
      });
    }
  }

  /** Every attached instance, keyed by instance id. */
  get attachments(): ReadonlyMap<string, SlackAttachment> {
    return this.attachmentMap;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Bot-token client of a workspace, kept per team so no call goes through the tokenless app client. */
  botClientFor(teamId: string): WebClient | undefined {
    return this.botClients.get(teamId);
  }

  /**
   * Client for a bot token whose workspace id is not known yet.
   *
   * The `App` is built with `authorize` and carries no token, so a connecting
   * instance has no token-bearing client to run its identity probe through
   * before `auth.test` tells it which team it is in. The receiver mints one
   * per bot token here and `attach` reuses the very same object, so after the
   * attach `botClientFor(teamId)` hands back this client.
   */
  clientForBotToken(botToken: string): WebClient {
    const existing = this.clientsByToken.get(botToken);
    if (existing) return existing;
    const client = new WebClient(botToken, { retryConfig: this.retryConfig });
    this.clientsByToken.set(botToken, client);
    return client;
  }

  /**
   * Hook for Socket Mode lifecycle transitions, as on BoltConnection: the
   * plugin assigns it after a verified start; `stop()` clears it so a
   * deliberate stop is not reported as a lost socket.
   */
  set onSocketStateChange(handler: ((state: SocketConnectionState) => void) | undefined) {
    this.connection.onSocketStateChange = handler;
  }

  /** Watchdog view of the socket; `open` is always true in HTTP mode. */
  socketHealth(now = Date.now()): SlackReceiverSocketHealth {
    return {
      open: isSocketOpen(this.connection),
      stale: isSocketStale(this.connection, now),
      state: this.connection.socketState,
    };
  }

  /**
   * Attach an instance. A later attach of the same instance id replaces the
   * earlier one; a later attach for the same team makes that instance's bot
   * token the one `authorize` answers with.
   *
   * A SECOND bot-mode attachment for a workspace is refused: both would answer
   * for the same bot user, so every event of that workspace would be acked and
   * dispatched twice, and `authorize` could only name one of their tokens.
   * Personal (user-mode) attachments are never refused — many members of one
   * workspace behind one app is the whole point. `force` is the escape hatch
   * for the case where the second attach is deliberately replacing the first
   * (a reinstalled bot token under a new instance id).
   */
  attach(attachment: SlackAttachment, options: { force?: boolean } = {}): void {
    if (attachment.authMode !== 'user' && !options.force) {
      const existing = this.botAttachmentFor(attachment.teamId);
      if (existing && existing.instanceId !== attachment.instanceId) {
        throw new SlackError(
          SlackErrorCode.BOT_INSTANCE_EXISTS,
          `Slack workspace ${attachment.teamId} already has a bot-mode instance (${existing.instanceId}) on this app; connect as a user (authMode: 'user') or replace that instance`,
        );
      }
    }

    // Delete first so Map insertion order reflects attach recency.
    this.attachmentMap.delete(attachment.instanceId);
    this.attachmentMap.set(attachment.instanceId, attachment);
    // The team's bot client follows the SAME recency rule `authorize` uses.
    // Setting it unconditionally would let an attach that is older by
    // `attachedAt` replace a newer workspace token (Group 2 review, MEDIUM #1).
    const newest = this.latestAttachmentFor(attachment.teamId) ?? attachment;
    this.botClients.set(newest.teamId, this.clientForBotToken(newest.botToken));
    this.logger.debug('Instance attached to Slack receiver', {
      receiver: this.key,
      instanceId: attachment.instanceId,
      teamId: attachment.teamId,
      attachments: this.attachmentMap.size,
    });
  }

  /**
   * Detach an instance. Returns whether it was attached. Detaching the last
   * attachment stops the receiver: nothing is left to receive for.
   */
  detach(instanceId: string): boolean {
    const removed = this.attachmentMap.get(instanceId);
    if (!removed) return false;
    this.attachmentMap.delete(instanceId);

    const remainingForTeam = this.latestAttachmentFor(removed.teamId);
    if (remainingForTeam) {
      this.botClients.set(remainingForTeam.teamId, this.clientForBotToken(remainingForTeam.botToken));
    } else {
      this.botClients.delete(removed.teamId);
    }

    // Drop the token-keyed client once nothing references that token, so a
    // receiver that outlives many reinstalls does not keep one WebClient per
    // historical bot token for its whole lifetime (Group 5 review, LOW #5).
    // A token an in-flight connect has only probed with is re-minted by its
    // attach; only the object identity is lost, never a live client.
    let tokenStillUsed = false;
    for (const attachment of this.attachmentMap.values()) {
      if (attachment.botToken === removed.botToken) {
        tokenStillUsed = true;
        break;
      }
    }
    if (!tokenStillUsed) this.clientsByToken.delete(removed.botToken);

    this.logger.debug('Instance detached from Slack receiver', {
      receiver: this.key,
      instanceId,
      teamId: removed.teamId,
      attachments: this.attachmentMap.size,
    });

    if (this.attachmentMap.size === 0) {
      // stop() never rejects: app.stop errors are logged inside it.
      void this.stop();
    }
    return true;
  }

  /**
   * The attachments of the event's workspace this event is authorized for, in
   * attach order.
   *
   * The team is the envelope's `team_id`, falling back to the inner event's
   * `team`. An unknown or missing team yields an empty list, never a throw.
   *
   * With exactly one attachment for that workspace there is nothing to narrow:
   * the event is delivered to it with no authorization lookup at all, which is
   * both the single-instance fast path and the behavior before this group.
   *
   * With two or more, delivering to all of them would show every member's
   * private conversations to every other member. Slack answers who an event is
   * visible to: `body.authorizations` carries one entry and
   * `apps.event.authorizations.list(event_context)` the rest. The listed users
   * select the user-mode attachments; an `is_bot` entry selects the (single)
   * bot-mode one. The answer is cached per `event_context`, so the several
   * listeners of one event cost one call.
   */
  async targetsFor(body: SlackEventBody): Promise<SlackAttachment[]> {
    const teamId = body.team_id ?? body.team?.id ?? body.event?.team;
    if (!teamId) return [];

    const teamAttachments = this.teamAttachmentsFor(teamId);
    if (teamAttachments.length <= 1) return teamAttachments;

    this.announceNarrowing(teamId, teamAttachments.length);

    return selectAuthorizedTargets(teamAttachments, await this.authorizationsFor(body));
  }

  /**
   * The attachments of an interactive event that carries no event envelope:
   * a slash command, a block action, a modal submission.
   *
   * Slack sends these with `team_id`/`team.id` and the acting human's
   * `user_id`, and with neither `event_context` nor `authorizations`, so
   * {@link targetsFor} has nothing to look up. The acting human IS the
   * authorization here: their own install is the single target when it is
   * attached, which is what keeps one member's slash command out of another
   * member's instance. With no install of their own the event falls back to
   * the same narrowing every other listener uses, against a synthesized
   * authorization set — so a workspace whose only install is the bot still
   * sees its commands, and a workspace of personal installs alone delivers to
   * nobody rather than to everybody.
   *
   * The single-attachment fast path of {@link targetsFor} is preserved: one
   * attachment for the workspace is the target whoever acted.
   */
  async targetsForActor(teamId: string | undefined, actorUserId: string | undefined): Promise<SlackAttachment[]> {
    if (!teamId) return [];

    const teamAttachments = this.teamAttachmentsFor(teamId);
    if (teamAttachments.length <= 1) return teamAttachments;

    const own = actorUserId
      ? teamAttachments.find((attachment) => attachment.authMode === 'user' && attachment.actingUserId === actorUserId)
      : undefined;
    if (own) {
      this.announceNarrowing(teamId, teamAttachments.length);
      return [own];
    }

    return this.targetsFor({
      team_id: teamId,
      authorizations: [
        ...(actorUserId ? [{ team_id: teamId, user_id: actorUserId, is_bot: false }] : []),
        { team_id: teamId, is_bot: true },
      ],
    });
  }

  /** Attachments installed in one workspace, in attach order. */
  private teamAttachmentsFor(teamId: string): SlackAttachment[] {
    const teamAttachments: SlackAttachment[] = [];
    for (const attachment of this.attachmentMap.values()) {
      if (attachment.teamId === teamId) teamAttachments.push(attachment);
    }
    return teamAttachments;
  }

  /**
   * Say once per workspace that delivery is being narrowed — and say WHICH
   * narrowing this receiver can actually do.
   *
   * With an app-level token the narrowing is Slack's own answer. Without one
   * (HTTP mode) or without `authorizations:read`, the only authorization on
   * hand is the single entry Slack puts in the envelope, so delivery narrows
   * to that entry and the other installs of the workspace see nothing. That is
   * a materially different guarantee and the log has to name it, or an
   * operator reads "narrowed to the authorized ones" and believes a lookup
   * happened (Group 5 review, LOW #3).
   */
  private announceNarrowing(teamId: string, attachments: number): void {
    if (this.narrowedTeams.has(teamId)) return;
    this.narrowedTeams.add(teamId);
    const canLookUp = this.appLevelClient !== undefined && !this.authorizationsScopeMissing;
    this.logger.info(
      canLookUp
        ? 'Slack workspace has several instances — delivery is narrowed to the authorized ones'
        : 'Slack workspace has several instances and this receiver cannot look event authorizations up — delivery is narrowed to the single authorization the event envelope carries',
      {
        receiver: this.key,
        teamId,
        attachments,
        mode: this.mode,
        authorizationsLookup: canLookUp,
      },
    );
  }

  /**
   * Start the shared App. In Socket Mode `app.start()` resolving is not
   * proof of a live WebSocket (#941): success is only declared once the
   * socket is verifiably open, within the bounded wait.
   */
  async start(): Promise<void> {
    if (this.running) return;

    if (this.mode === 'http') {
      try {
        await this.app.start(this.httpPort);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('Failed to start shared Slack HTTP receiver', {
          receiver: this.key,
          error: message,
          port: this.httpPort,
        });
        throw new SlackError(
          SlackErrorCode.CONNECTION_FAILED,
          `Failed to start Slack HTTP listener on port ${this.httpPort}: ${message}`,
        );
      }
      this.running = true;
      this.logger.info('Shared Slack HTTP receiver started', { receiver: this.key, port: this.httpPort });
      return;
    }

    try {
      await this.app.start();
      await waitForSocketOpen(this.connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to start shared Slack Socket Mode receiver', { receiver: this.key, error: message });
      await this.app.stop().catch(() => undefined);
      if (error instanceof SlackError) throw error;
      throw new SlackError(SlackErrorCode.CONNECTION_FAILED, `Failed to start Slack connection: ${message}`);
    }
    this.running = true;
    this.logger.info('Shared Slack Socket Mode receiver started (WebSocket verified open)', { receiver: this.key });
  }

  /**
   * Stop the shared App and forget every attachment and client. Never
   * rejects: a failing `app.stop()` is logged, the maps are cleared anyway.
   */
  async stop(): Promise<void> {
    // A deliberate stop must not be reported as a lost socket (#941).
    this.connection.onSocketStateChange = undefined;
    this.connection.lastSocketActivityAt = undefined;

    if (this.running) {
      this.running = false;
      try {
        await this.app.stop();
        this.logger.info('Shared Slack receiver stopped', { receiver: this.key });
      } catch (error) {
        this.logger.warn('Error stopping shared Slack receiver', { receiver: this.key, error: String(error) });
      }
    }

    this.attachmentMap.clear();
    this.botClients.clear();
    this.clientsByToken.clear();
    this.authorizationsCache.clear();
    this.narrowedTeams.clear();
  }

  /**
   * Bolt's per-event authorization: the bot identity of the event's
   * workspace, taken from the most recently attached instance of that team.
   * A team with no attachment is refused — Bolt then drops the event.
   */
  private async authorize(source: AuthorizeSourceData<boolean>): Promise<AuthorizeResult> {
    const teamId = source.teamId;
    const attachment = teamId ? this.latestAttachmentFor(teamId) : undefined;
    if (!attachment) {
      throw new SlackError(
        SlackErrorCode.NOT_CONNECTED,
        `No Slack instance attached for team ${teamId ?? '(none)'} on receiver ${this.key}`,
        true,
      );
    }
    return {
      botToken: attachment.botToken,
      botId: attachment.botId,
      botUserId: attachment.botUserId,
      teamId: attachment.teamId,
    };
  }

  /** The attachment of a team that attached last (by attachedAt, then attach order). */
  private latestAttachmentFor(teamId: string): SlackAttachment | undefined {
    let latest: SlackAttachment | undefined;
    for (const attachment of this.attachmentMap.values()) {
      if (attachment.teamId !== teamId) continue;
      if (!latest || attachment.attachedAt >= latest.attachedAt) latest = attachment;
    }
    return latest;
  }

  /** The bot-mode attachment of a team, of which there is at most one. */
  private botAttachmentFor(teamId: string): SlackAttachment | undefined {
    for (const attachment of this.attachmentMap.values()) {
      if (attachment.teamId === teamId && attachment.authMode !== 'user') return attachment;
    }
    return undefined;
  }

  /**
   * Who this event is authorized for: the envelope's entry, plus the ones
   * `apps.event.authorizations.list` adds, cached per `event_context`.
   *
   * Never throws and never widens: a missing `event_context`, an HTTP-mode
   * receiver with no app-level token, a known-missing `authorizations:read`
   * scope or a failing call all fall back to the single entry the envelope
   * carried, which is the one authorization Slack guarantees.
   */
  private async authorizationsFor(body: SlackEventBody): Promise<SlackAuthorization[]> {
    const envelope = body.authorizations ?? [];
    const eventContext = body.event_context;
    const client = this.appLevelClient;
    if (!eventContext || !client || this.authorizationsScopeMissing) return envelope;

    const now = Date.now();
    const cached = this.authorizationsCache.get(eventContext);
    if (cached && cached.expiresAt > now) return cached.entries;

    try {
      const listed: SlackAuthorization[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const result = await client.apps.event.authorizations.list({
          event_context: eventContext,
          limit: AUTHORIZATIONS_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        listed.push(...(result.authorizations ?? []));
        const nextCursor = result.response_metadata?.next_cursor;
        cursor = nextCursor ? nextCursor : undefined;
        pages += 1;
      } while (cursor && pages < MAX_AUTHORIZATIONS_PAGES);
      if (cursor) {
        this.logger.warn('apps.event.authorizations.list has more pages than one event is allowed to walk', {
          receiver: this.key,
          pages,
          authorizations: listed.length,
        });
      }
      const entries = mergeAuthorizations(envelope, listed);
      for (const [key, value] of this.authorizationsCache) {
        if (value.expiresAt <= now) this.authorizationsCache.delete(key);
      }
      this.authorizationsCache.set(eventContext, { entries, expiresAt: now + AUTHORIZATIONS_CACHE_TTL_MS });
      return entries;
    } catch (error) {
      this.reportAuthorizationsFailure(error);
      return envelope;
    }
  }

  /** Report a failed authorizations lookup — the missing-scope case exactly once. */
  private reportAuthorizationsFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingScopeFailure(message)) {
      if (this.authorizationsScopeMissing) return;
      this.authorizationsScopeMissing = true;
      this.logger.warn(
        'Slack app-level token lacks authorizations:read — event delivery falls back to the envelope authorization',
        { receiver: this.key, error: message },
      );
      return;
    }
    this.logger.warn('apps.event.authorizations.list failed — falling back to the envelope authorization', {
      receiver: this.key,
      error: message,
    });
  }

  /**
   * Apply a `tokens_revoked` or `app_uninstalled` event.
   *
   * `teamId` is the envelope's, because Bolt skips `authorize` for these two
   * and there is no authorized context to read one from. An uninstall costs
   * the workspace every attachment; a revocation costs the attachments whose
   * own identity Slack named — the authorizing human in `tokens.oauth`, the bot
   * user in `tokens.bot`.
   */
  private async handleRevocation(eventName: string, teamId: string | undefined, tokens: unknown): Promise<void> {
    const reason: SlackRevocationReason = eventName === 'app_uninstalled' ? 'app_uninstalled' : 'token_revoked';
    if (!teamId) {
      this.logger.warn('Slack revocation event without a team id — ignored', { receiver: this.key, reason });
      return;
    }

    let revoked: RevokedTokens = {};
    if (reason === 'token_revoked') {
      const parsed = RevokedTokensSchema.safeParse(tokens ?? {});
      if (!parsed.success) {
        this.logger.warn('Ignoring malformed tokens_revoked payload', {
          receiver: this.key,
          teamId,
          issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
        return;
      }
      revoked = parsed.data;
    }

    const attachments = this.attachmentsRevokedBy(teamId, reason, revoked);
    if (attachments.length === 0) {
      this.logger.debug('Slack revocation affects no attachment of this receiver', {
        receiver: this.key,
        teamId,
        reason,
      });
      return;
    }

    this.logger.warn('Slack access revoked for a workspace', {
      receiver: this.key,
      teamId,
      reason,
      instanceIds: attachments.map((attachment) => attachment.instanceId),
    });

    const listener = this.onRevocation;
    if (!listener) {
      // Nothing is going to transition the instances, but a revoked install
      // must not keep receiving: drop the attachments here.
      for (const attachment of attachments) this.detach(attachment.instanceId);
      return;
    }
    await listener({ reason, teamId, attachments });
  }

  /** The attachments of a workspace a revocation applies to. */
  private attachmentsRevokedBy(
    teamId: string,
    reason: SlackRevocationReason,
    tokens: RevokedTokens,
  ): SlackAttachment[] {
    const affected: SlackAttachment[] = [];
    for (const attachment of this.attachmentMap.values()) {
      if (attachment.teamId !== teamId) continue;
      if (reason === 'app_uninstalled') {
        affected.push(attachment);
        continue;
      }
      const revoked =
        attachment.authMode === 'user'
          ? attachment.actingUserId !== undefined && (tokens.oauth?.includes(attachment.actingUserId) ?? false)
          : (tokens.bot?.includes(attachment.botUserId) ?? false);
      if (revoked) affected.push(attachment);
    }
    return affected;
  }

  /**
   * Build the App for this receiver's transport. The options literal carries
   * `authorize` and never `token`: Bolt treats them as exclusive, and a
   * `token` would pin the receiver to one workspace.
   */
  private buildApp(opts: SlackConnectionOptions): {
    app: App;
    socketClient?: BoltConnection['socketClient'];
    httpHandler?: (req: IncomingMessage, res: ServerResponse) => void;
  } {
    const authorize = (source: AuthorizeSourceData<boolean>): Promise<AuthorizeResult> => this.authorize(source);
    const clientOptions: AppOptions['clientOptions'] = { retryConfig: this.retryConfig };

    if (this.mode === 'http') {
      if (!opts.signingSecret) {
        throw new SlackError(SlackErrorCode.CONNECTION_FAILED, 'signingSecret is required for HTTP mode');
      }
      const receiver = new HTTPReceiver({ signingSecret: opts.signingSecret });
      const app = new App({ authorize, clientOptions, receiver });
      // Same 1 MB guard the per-instance HTTP app applies (Group 2 review,
      // MEDIUM #2): an oversized body is refused with 413 before Bolt buffers it.
      return { app, httpHandler: withBodyLimit(receiver.requestListener, this.logger) };
    }

    if (!opts.appToken) {
      throw new SlackError(SlackErrorCode.CONNECTION_FAILED, 'appToken (xapp-...) is required for Socket Mode');
    }
    // Construct the receiver explicitly so the SocketModeClient is reachable
    // in a typed way: the startup assertion and the watchdog need its real
    // WebSocket state (#941).
    const receiver = new SocketModeReceiver({ appToken: opts.appToken });
    const app = new App({ authorize, clientOptions, receiver, socketMode: true });
    return { app, socketClient: receiver.client };
  }
}
