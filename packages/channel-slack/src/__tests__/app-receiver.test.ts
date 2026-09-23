/**
 * Shared app receiver (slack-personal-oauth, Group 2).
 *
 * One Bolt `App` per app-level token, many instances attached; `authorize`
 * answers per workspace; the last detach stops the App. Everything runs
 * against a fake `@slack/bolt` (no network): the fake App records its
 * constructor options, its `event` registrations and its start/stop calls,
 * and exposes the captured `authorize` so the tests can call it the way
 * Bolt does.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { DedupeCache, Logger } from '@omni/channel-sdk';
import { createInboundDedupeCache } from '@omni/channel-sdk';
import { DebounceManager } from '@omni/core';
import type { AuthorizeResult, AuthorizeSourceData } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import type { SlackConfig, SlackConnectionOptions } from '../types';
import { SlackError, SlackErrorCode } from '../types';

// ─────────────────────────────────────────────────────────────
// Fake @slack/bolt
// ─────────────────────────────────────────────────────────────

type FakeAuthorize = (source: AuthorizeSourceData<boolean>) => Promise<AuthorizeResult>;
type FakeListener = (...args: unknown[]) => Promise<void>;

interface FakeAppRecord {
  options: Record<string, unknown>;
  authorize: FakeAuthorize | undefined;
  events: Map<string, FakeListener[]>;
  messageCalls: number;
  actionCalls: number;
  startCalls: unknown[][];
  stopCalls: number;
}

/** Every fake App constructed since the last `resetFakes()`. */
const constructedApps: FakeAppRecord[] = [];
const socketReceiverOptions: Record<string, unknown>[] = [];
const httpReceiverOptions: Record<string, unknown>[] = [];

function resetFakes(): void {
  constructedApps.length = 0;
  socketReceiverOptions.length = 0;
  httpReceiverOptions.length = 0;
}

mock.module('@slack/bolt', () => {
  class FakeApp {
    readonly client = { auth: { test: async () => ({ ok: true }) } };
    readonly record: FakeAppRecord;

    constructor(options: Record<string, unknown>) {
      const authorize = options.authorize;
      this.record = {
        options,
        authorize: typeof authorize === 'function' ? (authorize as FakeAuthorize) : undefined,
        events: new Map(),
        messageCalls: 0,
        actionCalls: 0,
        startCalls: [],
        stopCalls: 0,
      };
      constructedApps.push(this.record);
    }

    error(_handler: (error: Error) => Promise<void>): void {
      // recorded nowhere: the global error handler is not under test
    }

    event(name: string, ...listeners: FakeListener[]): void {
      const existing = this.record.events.get(name) ?? [];
      this.record.events.set(name, [...existing, ...listeners]);
    }

    message(..._listeners: unknown[]): void {
      this.record.messageCalls += 1;
    }

    action(_constraints: unknown, ..._listeners: unknown[]): void {
      this.record.actionCalls += 1;
    }

    async start(...args: unknown[]): Promise<void> {
      this.record.startCalls.push(args);
    }

    async stop(): Promise<void> {
      this.record.stopCalls += 1;
    }
  }

  class FakeSocketModeReceiver {
    readonly client = Object.assign(new EventEmitter(), {
      websocket: { isActive: () => true },
    });
    constructor(options: Record<string, unknown>) {
      socketReceiverOptions.push(options);
    }
  }

  class FakeHTTPReceiver {
    readonly requestListener = (): void => undefined;
    constructor(options: Record<string, unknown>) {
      httpReceiverOptions.push(options);
    }
  }

  return {
    App: FakeApp,
    SocketModeReceiver: FakeSocketModeReceiver,
    HTTPReceiver: FakeHTTPReceiver,
  };
});

// Import AFTER mock.module so the receiver binds to the fake Bolt.
const { SlackAppReceiver, receiverKeyFor } = await import('../connection/app-receiver');
type SlackAttachment = import('../connection/app-receiver').SlackAttachment;
type SlackAuthorization = import('../connection/app-receiver').SlackAuthorization;
type RegisterHandlers = import('../connection/app-receiver').RegisterHandlers;

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const noop = (): void => undefined;
const noopLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

const SOCKET_OPTS: SlackConnectionOptions = {
  botToken: 'xoxb-unused-by-receiver',
  appToken: 'xapp-shared-app-token',
};

const config: SlackConfig = { botToken: 'xoxb-config', appToken: 'xapp-shared-app-token' };

const createdCaches: DedupeCache[] = [];

function makeAttachment(
  instanceId: string,
  teamId: string,
  botToken: string,
  attachedAt: number,
  overrides: Partial<SlackAttachment> = {},
): SlackAttachment {
  const dedupeCache = createInboundDedupeCache();
  createdCaches.push(dedupeCache);
  const debouncer = new DebounceManager({ mode: 'none' }, noop);
  const actingClient = new WebClient(botToken);
  return {
    instanceId,
    teamId,
    authMode: 'bot',
    actingClient,
    botUserId: `U_${instanceId}`,
    botId: `B_${instanceId}`,
    botToken,
    config,
    dedupeCache,
    debouncer,
    attachedAt,
    ...overrides,
  };
}

/** A one-click personal install: user mode on the person's own token, and no bot at all. */
function botlessAttachment(
  instanceId: string,
  teamId: string,
  actingUserId: string,
  attachedAt: number,
): SlackAttachment {
  const userClient = new WebClient(`xoxp-${instanceId}`);
  return makeAttachment(instanceId, teamId, 'unused', attachedAt, {
    authMode: 'user',
    actingClient: userClient,
    userClient,
    actingUserId,
    botToken: undefined,
    botUserId: undefined,
    botId: undefined,
  });
}

function makeReceiver(
  opts: SlackConnectionOptions = SOCKET_OPTS,
  registerHandlers: RegisterHandlers = () => undefined,
): {
  receiver: InstanceType<typeof SlackAppReceiver>;
  registerCalls: number;
} {
  const counter = { registerCalls: 0 };
  const receiver = new SlackAppReceiver(
    opts,
    (app, owner) => {
      counter.registerCalls += 1;
      registerHandlers(app, owner);
    },
    noopLogger,
  );
  return {
    receiver,
    get registerCalls() {
      return counter.registerCalls;
    },
  };
}

function lastApp(): FakeAppRecord {
  const record = constructedApps.at(-1);
  if (!record) throw new Error('no fake App constructed');
  return record;
}

function authorizeOf(record: FakeAppRecord): FakeAuthorize {
  if (!record.authorize) throw new Error('fake App captured no authorize');
  return record.authorize;
}

/** One answer page of `apps.event.authorizations.list`. */
interface AuthorizationsPage {
  authorizations: SlackAuthorization[];
  nextCursor?: string;
}

/** The arguments one lookup call carried. */
interface AuthorizationsCall {
  event_context: string;
  cursor?: string;
  limit?: number;
}

/**
 * Replace the receiver's app-level client with a paginating fake.
 *
 * The real one carries the `xapp-…` token, the only token the method accepts,
 * so swapping it is what keeps these tests off the network while still
 * exercising the receiver's own cursor walk, bound and caching.
 */
function installAuthorizationsPages(
  receiver: InstanceType<typeof SlackAppReceiver>,
  pages: AuthorizationsPage[],
): AuthorizationsCall[] {
  const calls: AuthorizationsCall[] = [];
  const client = {
    apps: {
      event: {
        authorizations: {
          list: async (args: AuthorizationsCall) => {
            calls.push(args);
            const page = pages[calls.length - 1] ?? { authorizations: [] };
            return {
              authorizations: page.authorizations,
              response_metadata: { next_cursor: page.nextCursor ?? '' },
            };
          },
        },
      },
    },
  };
  (receiver as unknown as { appLevelClient: unknown }).appLevelClient = client;
  return calls;
}

/** Capture what the receiver logged, replacing the logger it was built with. */
function captureLogs(receiver: InstanceType<typeof SlackAppReceiver>): {
  level: string;
  message: string;
  context: Record<string, unknown>;
}[] {
  const lines: { level: string; message: string; context: Record<string, unknown> }[] = [];
  const record =
    (level: string) =>
    (message: string, context?: Record<string, unknown>): void => {
      lines.push({ level, message, context: context ?? {} });
    };
  const logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  } as unknown as Logger;
  (receiver as unknown as { logger: Logger }).logger = logger;
  return lines;
}

const source = (teamId: string): AuthorizeSourceData<boolean> => ({
  teamId,
  enterpriseId: undefined,
  isEnterpriseInstall: false,
});

afterEach(() => {
  for (const cache of createdCaches) cache.dispose();
  createdCaches.length = 0;
  resetFakes();
});

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('SlackAppReceiver', () => {
  it('two attachments on one key share one App, built with authorize and never token', () => {
    // The plugin's hook registers its listeners on the App it is handed.
    const { receiver, registerCalls } = makeReceiver(SOCKET_OPTS, (app, owner) => {
      expect(owner).toBeInstanceOf(SlackAppReceiver);
      app.message(async () => undefined);
      app.action('button_click', async () => undefined);
    });
    expect(constructedApps).toHaveLength(1);

    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));
    // A workspace has one bot identity, so the second instance of T1 is a
    // personal (user-mode) install — the shape this receiver exists for.
    receiver.attach(makeAttachment('inst-b', 'T1', 'xoxb-b', 2, { authMode: 'user', actingUserId: 'U_HUMAN' }));

    // Still exactly one App; handlers were registered once, at creation,
    // never per attachment.
    expect(constructedApps).toHaveLength(1);
    expect(registerCalls).toBe(1);
    expect(lastApp().messageCalls).toBe(1);
    expect(lastApp().actionCalls).toBe(1);
    expect(receiver.attachments.size).toBe(2);
    expect([...receiver.attachments.keys()]).toEqual(['inst-a', 'inst-b']);

    const { options, events } = lastApp();
    expect(typeof options.authorize).toBe('function');
    expect('token' in options).toBe(false);
    expect(options.socketMode).toBe(true);
    expect(socketReceiverOptions).toEqual([{ appToken: 'xapp-shared-app-token' }]);

    // Both revocation events have a listener, registered once for the receiver.
    expect(events.get('tokens_revoked')).toHaveLength(1);
    expect(events.get('app_uninstalled')).toHaveLength(1);

    // Per-workspace bot client, built from the attachment's bot token.
    expect(receiver.botClientFor('T1')).toBeInstanceOf(WebClient);
    expect(receiver.botClientFor('T2')).toBeUndefined();
  });

  it('distinct keys give distinct receivers', () => {
    const first = makeReceiver({ botToken: 'xoxb-1', appToken: 'xapp-one' }).receiver;
    const second = makeReceiver({ botToken: 'xoxb-2', appToken: 'xapp-two' }).receiver;
    const http = makeReceiver({
      botToken: 'xoxb-3',
      mode: 'http',
      signingSecret: 'sekrit',
      httpPort: 3005,
    }).receiver;

    expect(constructedApps).toHaveLength(3);
    expect(first.key).not.toBe(second.key);
    expect(first.key).not.toBe(http.key);

    // The key is stable for equal options and derived from a hash, never the secret.
    expect(receiverKeyFor({ botToken: 'xoxb-other', appToken: 'xapp-one' })).toBe(first.key);
    expect(first.key).toMatch(/^socket:[0-9a-f]{64}$/);
    expect(first.key).not.toContain('xapp-one');
    expect(http.key).toMatch(/^http:[0-9a-f]{64}:3005$/);
    expect(http.key).not.toContain('sekrit');
    expect(httpReceiverOptions).toEqual([{ signingSecret: 'sekrit' }]);
    expect('token' in lastApp().options).toBe(false);

    // Missing transport secrets are typed failures, not silent keys.
    expect(() => receiverKeyFor({ botToken: 'xoxb' })).toThrow(SlackError);
    expect(() => receiverKeyFor({ botToken: 'xoxb', mode: 'http' })).toThrow(SlackError);
  });

  it('authorize returns the most recently attached bot token for the team', async () => {
    const { receiver } = makeReceiver();
    const authorize = authorizeOf(lastApp());

    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));
    await expect(authorize(source('T1'))).resolves.toEqual({
      botToken: 'xoxb-a',
      botId: 'B_inst-a',
      botUserId: 'U_inst-a',
      teamId: 'T1',
    });

    // A later attach for the same team supersedes the earlier one. A second
    // BOT-mode attach for a workspace is refused unless it says it is
    // deliberately replacing the first — a reinstalled bot token.
    expect(() => receiver.attach(makeAttachment('inst-b', 'T1', 'xoxb-b', 2))).toThrow(SlackError);
    receiver.attach(makeAttachment('inst-b', 'T1', 'xoxb-b', 2), { force: true });
    receiver.attach(makeAttachment('inst-c', 'T2', 'xoxb-c', 3));
    await expect(authorize(source('T1'))).resolves.toMatchObject({ botToken: 'xoxb-b', botUserId: 'U_inst-b' });
    await expect(authorize(source('T2'))).resolves.toMatchObject({ botToken: 'xoxb-c' });
    expect(receiver.botClientFor('T1')?.token).toBe('xoxb-b');
    expect(receiver.botClientFor('T2')?.token).toBe('xoxb-c');

    // Detaching the newest attachment of a team falls back to the previous one.
    expect(receiver.detach('inst-b')).toBe(true);
    await expect(authorize(source('T1'))).resolves.toMatchObject({ botToken: 'xoxb-a' });
    expect(receiver.botClientFor('T1')?.token).toBe('xoxb-a');

    // A team with no attachment is refused with a typed error.
    let refused: unknown;
    try {
      await authorize(source('T9'));
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(SlackError);
    expect((refused as SlackError).channelCode).toBe(SlackErrorCode.NOT_CONNECTED);
  });

  it('authorize answers a bot-less workspace with its team alone, and a mixed one with its bot', async () => {
    const { receiver } = makeReceiver();
    const authorize = authorizeOf(lastApp());
    const clientsByToken = (receiver as unknown as { clientsByToken: Map<string, WebClient> }).clientsByToken;

    // Personal installs only: no bot identity to answer with, and no person's
    // token may back the client Bolt hands the listeners of anyone's event.
    receiver.attach(botlessAttachment('inst-ana', 'T1', 'U_ANA', 1));
    const botless = await authorize(source('T1'));
    expect(botless).toEqual({ teamId: 'T1' });
    expect(botless.userToken).toBeUndefined();
    expect(botless.botToken).toBeUndefined();
    expect(receiver.botClientFor('T1')).toBeUndefined();
    expect(clientsByToken.size).toBe(0);

    // A workspace that also has a bot answers with the bot, even when the
    // bot-less attach is the newer one.
    receiver.attach(makeAttachment('inst-bot', 'T2', 'xoxb-bot', 2));
    receiver.attach(botlessAttachment('inst-ben', 'T2', 'U_BEN', 3));
    await expect(authorize(source('T2'))).resolves.toEqual({
      botToken: 'xoxb-bot',
      botId: 'B_inst-bot',
      botUserId: 'U_inst-bot',
      teamId: 'T2',
    });
    expect(receiver.botClientFor('T2')?.token).toBe('xoxb-bot');

    // Once the bot detaches, its client goes with it and the team answers alone.
    expect(receiver.detach('inst-bot')).toBe(true);
    await expect(authorize(source('T2'))).resolves.toEqual({ teamId: 'T2' });
    expect(receiver.botClientFor('T2')).toBeUndefined();
    expect(clientsByToken.size).toBe(0);
  });

  it('detaching the last attachment stops the receiver', async () => {
    const { receiver } = makeReceiver();
    const app = lastApp();

    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));
    receiver.attach(makeAttachment('inst-b', 'T2', 'xoxb-b', 2));

    await receiver.start();
    expect(receiver.isRunning).toBe(true);
    expect(app.startCalls).toEqual([[]]);
    expect(receiver.socketHealth().open).toBe(true);

    // Detaching while others remain keeps the App running.
    expect(receiver.detach('inst-a')).toBe(true);
    await Promise.resolve();
    expect(app.stopCalls).toBe(0);
    expect(receiver.isRunning).toBe(true);
    expect(receiver.botClientFor('T1')).toBeUndefined();
    expect(receiver.botClientFor('T2')?.token).toBe('xoxb-b');

    // Detaching the last one stops it, exactly once, and clears the maps.
    expect(receiver.detach('inst-b')).toBe(true);
    await Promise.resolve();
    expect(app.stopCalls).toBe(1);
    expect(receiver.isRunning).toBe(false);
    expect(receiver.attachments.size).toBe(0);
    expect(receiver.botClientFor('T2')).toBeUndefined();

    // Unknown instance ids are reported, not thrown, and stop nothing.
    expect(receiver.detach('inst-a')).toBe(false);
    await Promise.resolve();
    expect(app.stopCalls).toBe(1);
  });

  it('targetsFor narrows a shared workspace to the authorized attachments', async () => {
    const { receiver } = makeReceiver();
    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));
    receiver.attach(makeAttachment('inst-b', 'T1', 'xoxb-b', 2, { authMode: 'user', actingUserId: 'U_HUMAN' }));
    receiver.attach(makeAttachment('inst-c', 'T2', 'xoxb-c', 3));

    // T1 has two attachments, so the envelope's authorizations decide. No
    // `event_context` here, so nothing is looked up over the API either.
    const both = await receiver.targetsFor({
      team_id: 'T1',
      event: { type: 'message' },
      authorizations: [
        { team_id: 'T1', user_id: 'U_inst-a', is_bot: true },
        { team_id: 'T1', user_id: 'U_HUMAN', is_bot: false },
      ],
    });
    expect(both.map((a) => a.instanceId)).toEqual(['inst-a', 'inst-b']);

    const humanOnly = await receiver.targetsFor({
      team_id: 'T1',
      authorizations: [{ team_id: 'T1', user_id: 'U_HUMAN', is_bot: false }],
    });
    expect(humanOnly.map((a) => a.instanceId)).toEqual(['inst-b']);
    expect(humanOnly[0]?.actingUserId).toBe('U_HUMAN');

    const botOnly = await receiver.targetsFor({
      team_id: 'T1',
      authorizations: [{ team_id: 'T1', user_id: 'U_inst-a', is_bot: true }],
    });
    expect(botOnly.map((a) => a.instanceId)).toEqual(['inst-a']);

    // A workspace with ONE attachment is delivered to unchecked — no
    // authorizations envelope needed, and none consulted.
    const t2 = await receiver.targetsFor({ team_id: 'T2' });
    expect(t2.map((a) => a.instanceId)).toEqual(['inst-c']);

    // Without an envelope team_id the inner event's team is the fallback.
    const viaEvent = await receiver.targetsFor({ event: { type: 'message', team: 'T2' } });
    expect(viaEvent.map((a) => a.instanceId)).toEqual(['inst-c']);

    // An unknown or missing team_id is an empty list, never a throw.
    await expect(receiver.targetsFor({ team_id: 'T9' })).resolves.toEqual([]);
    await expect(receiver.targetsFor({})).resolves.toEqual([]);
  });

  it('refuses a second bot-mode attachment for a workspace, never a user-mode one', () => {
    const { receiver } = makeReceiver();
    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));

    let refused: unknown;
    try {
      receiver.attach(makeAttachment('inst-dup', 'T1', 'xoxb-dup', 2));
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(SlackError);
    expect((refused as SlackError).channelCode).toBe(SlackErrorCode.BOT_INSTANCE_EXISTS);
    expect(receiver.attachments.has('inst-dup')).toBe(false);

    // Personal installs of the same workspace are unlimited.
    receiver.attach(makeAttachment('inst-u1', 'T1', 'xoxb-a', 3, { authMode: 'user', actingUserId: 'U_ONE' }));
    receiver.attach(makeAttachment('inst-u2', 'T1', 'xoxb-a', 4, { authMode: 'user', actingUserId: 'U_TWO' }));
    expect([...receiver.attachments.keys()]).toEqual(['inst-a', 'inst-u1', 'inst-u2']);

    // Another workspace's bot is a different bot identity.
    receiver.attach(makeAttachment('inst-b', 'T2', 'xoxb-b', 5));
    expect(receiver.attachments.has('inst-b')).toBe(true);

    // Re-attaching the SAME instance (a reconnect) is not a second bot.
    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a2', 6));
    expect(receiver.botClientFor('T1')?.token).toBe('xoxb-a2');
  });
});

// ─────────────────────────────────────────────────────────────
// bolt-client helpers the receiver's callers rely on
// ─────────────────────────────────────────────────────────────

// Same post-mock import: bolt-client binds `@slack/bolt` at module load.
const { buildActingClients, resolveWorkspaceIdentity } = await import('../connection/bolt-client');

/** A `WebClient`-shaped stand-in whose `auth.test` answers with `result`. */
function fakeBotClient(result: () => Promise<Record<string, unknown>>): WebClient {
  return { auth: { test: result } } as unknown as WebClient;
}

describe('buildActingClients', () => {
  it('acts as the bot in bot mode and as the human in user mode', () => {
    const botClient = new WebClient('xoxb-bot');

    const bot = buildActingClients({ botToken: 'xoxb-bot', appToken: 'xapp-1' }, botClient);
    expect(bot.actingClient).toBe(botClient);
    expect(bot.userClient).toBeUndefined();

    const user = buildActingClients(
      { botToken: 'xoxb-bot', appToken: 'xapp-1', authMode: 'user', userToken: 'xoxp-human' },
      botClient,
    );
    expect(user.userClient).toBeDefined();
    expect(user.userClient?.token).toBe('xoxp-human');
    expect(user.actingClient).toBe(user.userClient as WebClient);
    expect(user.actingClient).not.toBe(botClient);
  });

  it('refuses user mode without a user token', () => {
    const botClient = new WebClient('xoxb-bot');
    expect(() => buildActingClients({ botToken: 'xoxb-bot', appToken: 'xapp-1', authMode: 'user' }, botClient)).toThrow(
      SlackError,
    );
  });

  it('acts as the human with no bot client at all, and refuses bot mode without one', () => {
    const user = buildActingClients({ appToken: 'xapp-1', authMode: 'user', userToken: 'xoxp-human' });
    expect(user.userClient?.token).toBe('xoxp-human');
    expect(user.actingClient).toBe(user.userClient as WebClient);

    let refused: unknown;
    try {
      buildActingClients({ appToken: 'xapp-1' });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(SlackError);
    expect((refused as SlackError).channelCode).toBe(SlackErrorCode.INVALID_TOKEN);
  });
});

describe('resolveWorkspaceIdentity', () => {
  it('returns the full identity from auth.test', async () => {
    const botClient = fakeBotClient(async () => ({
      ok: true,
      user_id: 'U_BOT',
      bot_id: 'B_BOT',
      user: 'omni',
      team_id: 'T1',
    }));

    await expect(resolveWorkspaceIdentity(botClient)).resolves.toEqual({
      teamId: 'T1',
      botId: 'B_BOT',
      botUserId: 'U_BOT',
      botName: 'omni',
    });
  });

  it('rejects an incomplete identity, naming the missing fields', async () => {
    const botClient = fakeBotClient(async () => ({ ok: true, user_id: 'U_BOT', team_id: 'T1' }));

    const error = await resolveWorkspaceIdentity(botClient).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SlackError);
    expect((error as SlackError).channelCode).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect((error as SlackError).message).toContain('bot_id, user');
  });

  it('wraps a failed auth.test call as CONNECTION_FAILED', async () => {
    const botClient = fakeBotClient(async () => {
      throw new Error('socket hang up');
    });

    const error = await resolveWorkspaceIdentity(botClient).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SlackError);
    expect((error as SlackError).channelCode).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect((error as SlackError).message).toContain('socket hang up');
  });
});

describe('SlackAppReceiver authorizations pagination', () => {
  it('follows the cursor across pages, so an install past the first page is still a target', async () => {
    const { receiver } = makeReceiver();
    const calls = installAuthorizationsPages(receiver, [
      { authorizations: [{ team_id: 'T1', user_id: 'U_ANA', is_bot: false }], nextCursor: 'page-2' },
      { authorizations: [{ team_id: 'T1', user_id: 'U_BEN', is_bot: false }] },
    ]);

    receiver.attach(makeAttachment('inst-ana', 'T1', 'xoxb-a', 1, { authMode: 'user', actingUserId: 'U_ANA' }));
    receiver.attach(makeAttachment('inst-ben', 'T1', 'xoxb-b', 2, { authMode: 'user', actingUserId: 'U_BEN' }));

    const targets = await receiver.targetsFor({ team_id: 'T1', event_context: 'EC-paged', authorizations: [] });

    // Ben is only on the SECOND page: one-page-deep reading starved him.
    expect(targets.map((a) => a.instanceId)).toEqual(['inst-ana', 'inst-ben']);
    expect(calls).toEqual([
      { event_context: 'EC-paged', limit: 100 },
      { event_context: 'EC-paged', limit: 100, cursor: 'page-2' },
    ]);
  });

  it('stops at the page bound, warns, and narrows to what it did read', async () => {
    const { receiver } = makeReceiver();
    // Every page answers with another cursor: the walk has to end somewhere.
    const calls = installAuthorizationsPages(
      receiver,
      Array.from({ length: 9 }, (_, index) => ({
        authorizations: [{ team_id: 'T1', user_id: `U_${index}`, is_bot: false }],
        nextCursor: `page-${index + 2}`,
      })),
    );
    const logs = captureLogs(receiver);

    receiver.attach(makeAttachment('inst-ana', 'T1', 'xoxb-a', 1, { authMode: 'user', actingUserId: 'U_ANA' }));
    receiver.attach(makeAttachment('inst-ben', 'T1', 'xoxb-b', 2, { authMode: 'user', actingUserId: 'U_BEN' }));

    const targets = await receiver.targetsFor({ team_id: 'T1', event_context: 'EC-endless', authorizations: [] });

    expect(calls).toHaveLength(5);
    expect(targets).toEqual([]);
    expect(logs.filter((line) => line.level === 'warn' && line.message.includes('more pages'))).toHaveLength(1);
  });
});

describe('SlackAppReceiver.targetsForActor', () => {
  it('narrows an envelope-less event to the acting human own install', async () => {
    const { receiver } = makeReceiver();
    installAuthorizationsPages(receiver, []);
    receiver.attach(makeAttachment('inst-ana', 'T1', 'xoxb-a', 1, { authMode: 'user', actingUserId: 'U_ANA' }));
    receiver.attach(makeAttachment('inst-ben', 'T1', 'xoxb-b', 2, { authMode: 'user', actingUserId: 'U_BEN' }));
    receiver.attach(makeAttachment('inst-other', 'T2', 'xoxb-c', 3));

    await expect(receiver.targetsForActor('T1', 'U_BEN')).resolves.toMatchObject([{ instanceId: 'inst-ben' }]);

    // Another workspace of the same app is never a target.
    await expect(receiver.targetsForActor('T2', 'U_BEN')).resolves.toMatchObject([{ instanceId: 'inst-other' }]);

    // A workspace with no attachment, and no workspace at all, are empty.
    await expect(receiver.targetsForActor('T9', 'U_ANA')).resolves.toEqual([]);
    await expect(receiver.targetsForActor(undefined, 'U_ANA')).resolves.toEqual([]);
  });

  it('falls back to the workspace bot install, and to nobody when every install is personal', async () => {
    const { receiver } = makeReceiver();
    installAuthorizationsPages(receiver, []);
    receiver.attach(makeAttachment('inst-bot', 'T1', 'xoxb-bot', 1));
    receiver.attach(makeAttachment('inst-ana', 'T1', 'xoxb-a', 2, { authMode: 'user', actingUserId: 'U_ANA' }));

    // A member with no install of their own: the bot install owns the action.
    await expect(receiver.targetsForActor('T1', 'U_CARLA')).resolves.toMatchObject([{ instanceId: 'inst-bot' }]);

    // With the bot gone every install is personal, and none is the actor's.
    receiver.detach('inst-bot');
    receiver.attach(makeAttachment('inst-ben', 'T1', 'xoxb-b', 3, { authMode: 'user', actingUserId: 'U_BEN' }));
    await expect(receiver.targetsForActor('T1', 'U_CARLA')).resolves.toEqual([]);

    // One attachment for the workspace owns everything that workspace sends.
    receiver.detach('inst-ben');
    await expect(receiver.targetsForActor('T1', 'U_CARLA')).resolves.toMatchObject([{ instanceId: 'inst-ana' }]);
  });

  it('gives a lone bot-less install only what its own human did', async () => {
    const { receiver } = makeReceiver();
    installAuthorizationsPages(receiver, []);
    receiver.attach(botlessAttachment('inst-ana', 'T1', 'U_ANA', 1));

    // Another member's command or click is not this person's to answer.
    await expect(receiver.targetsForActor('T1', 'U_CARLA')).resolves.toEqual([]);
    await expect(receiver.targetsForActor('T1', undefined)).resolves.toEqual([]);
    await expect(receiver.targetsForActor('T1', 'U_ANA')).resolves.toMatchObject([{ instanceId: 'inst-ana' }]);
  });
});

describe('SlackAppReceiver client and log hygiene', () => {
  it('prunes the token-keyed client once no attachment references that token', () => {
    const { receiver } = makeReceiver();
    const clientsByToken = (receiver as unknown as { clientsByToken: Map<string, WebClient> }).clientsByToken;

    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));
    receiver.attach(makeAttachment('inst-b', 'T2', 'xoxb-b', 2));
    // A reinstall of T1 under a new instance id, with a new bot token.
    receiver.attach(makeAttachment('inst-a2', 'T1', 'xoxb-a2', 3), { force: true });
    expect([...clientsByToken.keys()]).toEqual(['xoxb-a', 'xoxb-b', 'xoxb-a2']);

    // The superseded install detaches: its historical token goes with it.
    expect(receiver.detach('inst-a')).toBe(true);
    expect([...clientsByToken.keys()]).toEqual(['xoxb-b', 'xoxb-a2']);

    // A token two attachments share survives the first detach.
    receiver.attach(makeAttachment('inst-b2', 'T3', 'xoxb-b', 4));
    expect(receiver.detach('inst-b')).toBe(true);
    expect([...clientsByToken.keys()]).toEqual(['xoxb-b', 'xoxb-a2']);
  });

  it('says which narrowing it can do when there is no app-level token to look authorizations up with', async () => {
    const { receiver } = makeReceiver({
      botToken: 'xoxb-http',
      mode: 'http',
      signingSecret: 'sekrit',
      httpPort: 3007,
    });
    const logs = captureLogs(receiver);

    receiver.attach(makeAttachment('inst-ana', 'T1', 'xoxb-a', 1, { authMode: 'user', actingUserId: 'U_ANA' }));
    receiver.attach(makeAttachment('inst-ben', 'T1', 'xoxb-b', 2, { authMode: 'user', actingUserId: 'U_BEN' }));

    const targets = await receiver.targetsFor({
      team_id: 'T1',
      event_context: 'EC-http',
      authorizations: [{ team_id: 'T1', user_id: 'U_ANA', is_bot: false }],
    });

    // HTTP mode has no app-level token, so the envelope's single entry is the
    // whole answer — and the log has to say so rather than claim a lookup.
    expect(targets.map((a) => a.instanceId)).toEqual(['inst-ana']);
    const narrowing = logs.filter((line) => line.message.startsWith('Slack workspace has several instances'));
    expect(narrowing).toHaveLength(1);
    expect(narrowing[0]?.message).toContain('the single authorization the event envelope carries');
    expect(narrowing[0]?.context).toMatchObject({ mode: 'http', authorizationsLookup: false, teamId: 'T1' });
  });
});
