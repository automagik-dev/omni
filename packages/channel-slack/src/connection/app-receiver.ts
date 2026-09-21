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
 * through the `registerHandlers` hook; `targetsFor(body)` gives a handler
 * every attachment of the event's `team_id`, with no authorization check —
 * fan-out and visibility filtering live in the plugin.
 *
 * The socket-health watchdog (#941/#1151) is the one in bolt-client.ts,
 * driven through a `BoltConnection`-shaped state so its behavior is shared,
 * not copied.
 */

import { createHash } from 'node:crypto';
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
} from './bolt-client';

/** Default port for Bolt's built-in HTTP receiver, as in startBoltConnection. */
const DEFAULT_HTTP_PORT = 3001;

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
 * The envelope's `team_id` is authoritative; the inner event's `team` is
 * the fallback Slack uses for shared-channel and Slack Connect deliveries.
 */
export interface SlackEventBody {
  team_id?: string;
  api_app_id?: string;
  event?: { team?: string; [key: string]: unknown };
  [key: string]: unknown;
}

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
 * Listener for the revocation events. Bolt skips `authorize` for
 * `tokens_revoked` and `app_uninstalled`, so a receiver with no listener for
 * them logs an "unhandled event" warning per revocation. Registering a no-op
 * keeps the receiver quiet; the real transition arrives with fan-out.
 */
const noopListener = async (): Promise<void> => undefined;

/**
 * One Bolt `App` shared by every instance behind the same app-level token
 * (or the same signing secret and port).
 */
export class SlackAppReceiver {
  readonly key: string;

  private readonly app: App;
  private readonly logger: Logger;
  private readonly mode: 'socket' | 'http';
  private readonly httpPort: number;
  private readonly retryConfig: NonNullable<WebClientOptions['retryConfig']>;
  private readonly attachmentMap = new Map<string, SlackAttachment>();
  private readonly botClients = new Map<string, WebClient>();
  /**
   * Watchdog state, `BoltConnection`-shaped so bolt-client's socket-health
   * helpers drive it unchanged. `client`/`actingClient` are Bolt's tokenless
   * app client and `botToken` is empty: neither is used by the watchdog, and
   * every outbound call goes through the per-workspace clients instead.
   */
  private readonly connection: BoltConnection;
  private running = false;

  constructor(opts: SlackConnectionOptions, registerHandlers: RegisterHandlers, logger: Logger) {
    this.key = receiverKeyFor(opts);
    this.logger = logger;
    this.mode = opts.mode ?? 'socket';
    this.httpPort = opts.httpPort ?? DEFAULT_HTTP_PORT;
    this.retryConfig = buildRetryConfig(opts);

    const { app, socketClient } = this.buildApp(opts);
    this.app = app;
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
    for (const eventName of REVOCATION_EVENTS) {
      app.event(eventName, noopListener);
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
   */
  attach(attachment: SlackAttachment): void {
    // Delete first so Map insertion order reflects attach recency.
    this.attachmentMap.delete(attachment.instanceId);
    this.attachmentMap.set(attachment.instanceId, attachment);
    this.botClients.set(attachment.teamId, new WebClient(attachment.botToken, { retryConfig: this.retryConfig }));
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
      this.botClients.set(
        remainingForTeam.teamId,
        new WebClient(remainingForTeam.botToken, { retryConfig: this.retryConfig }),
      );
    } else {
      this.botClients.delete(removed.teamId);
    }

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
   * Every attachment of the event's workspace, in attach order. The team is
   * the envelope's `team_id`, falling back to the inner event's `team`. No
   * authorization, token or scope check happens here — an unknown or
   * missing team yields an empty list, never a throw.
   */
  async targetsFor(body: SlackEventBody): Promise<SlackAttachment[]> {
    const teamId = body.team_id ?? body.event?.team;
    if (!teamId) return [];
    const targets: SlackAttachment[] = [];
    for (const attachment of this.attachmentMap.values()) {
      if (attachment.teamId === teamId) targets.push(attachment);
    }
    return targets;
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

  /**
   * Build the App for this receiver's transport. The options literal carries
   * `authorize` and never `token`: Bolt treats them as exclusive, and a
   * `token` would pin the receiver to one workspace.
   */
  private buildApp(opts: SlackConnectionOptions): { app: App; socketClient?: BoltConnection['socketClient'] } {
    const authorize = (source: AuthorizeSourceData<boolean>): Promise<AuthorizeResult> => this.authorize(source);
    const clientOptions: AppOptions['clientOptions'] = { retryConfig: this.retryConfig };

    if (this.mode === 'http') {
      if (!opts.signingSecret) {
        throw new SlackError(SlackErrorCode.CONNECTION_FAILED, 'signingSecret is required for HTTP mode');
      }
      const receiver = new HTTPReceiver({ signingSecret: opts.signingSecret });
      const app = new App({ authorize, clientOptions, receiver });
      return { app };
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
