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

function makeReceiver(opts: SlackConnectionOptions = SOCKET_OPTS): {
  receiver: InstanceType<typeof SlackAppReceiver>;
  registerCalls: number;
} {
  const counter = { registerCalls: 0 };
  const receiver = new SlackAppReceiver(
    opts,
    () => {
      counter.registerCalls += 1;
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
    const { receiver, registerCalls } = makeReceiver();
    expect(constructedApps).toHaveLength(1);

    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));
    receiver.attach(makeAttachment('inst-b', 'T1', 'xoxb-b', 2));

    // Still exactly one App; handlers were registered once, at creation.
    expect(constructedApps).toHaveLength(1);
    expect(registerCalls).toBe(1);
    expect(receiver.attachments.size).toBe(2);
    expect([...receiver.attachments.keys()]).toEqual(['inst-a', 'inst-b']);

    const { options, events } = lastApp();
    expect(typeof options.authorize).toBe('function');
    expect('token' in options).toBe(false);
    expect(options.socketMode).toBe(true);
    expect(socketReceiverOptions).toEqual([{ appToken: 'xapp-shared-app-token' }]);

    // Revocation events are registered as no-op listeners in this group.
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

    // A later attach for the same team supersedes the earlier one.
    receiver.attach(makeAttachment('inst-b', 'T1', 'xoxb-b', 2));
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

  it('targetsFor returns all attachments of the team', async () => {
    const { receiver } = makeReceiver();
    receiver.attach(makeAttachment('inst-a', 'T1', 'xoxb-a', 1));
    receiver.attach(makeAttachment('inst-b', 'T1', 'xoxb-b', 2, { authMode: 'user', actingUserId: 'U_HUMAN' }));
    receiver.attach(makeAttachment('inst-c', 'T2', 'xoxb-c', 3));

    const t1 = await receiver.targetsFor({ team_id: 'T1', event: { type: 'message' } });
    expect(t1.map((a) => a.instanceId)).toEqual(['inst-a', 'inst-b']);
    expect(t1[1]?.actingUserId).toBe('U_HUMAN');

    const t2 = await receiver.targetsFor({ team_id: 'T2' });
    expect(t2.map((a) => a.instanceId)).toEqual(['inst-c']);

    // No authorization check: an unknown or missing team_id is an empty list, never a throw.
    await expect(receiver.targetsFor({ team_id: 'T9' })).resolves.toEqual([]);
    await expect(receiver.targetsFor({})).resolves.toEqual([]);
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
