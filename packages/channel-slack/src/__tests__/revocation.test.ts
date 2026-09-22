/**
 * Revocation on a shared receiver (slack-personal-oauth, Group 5).
 *
 * Bolt skips `authorize` for `tokens_revoked` and `app_uninstalled`, so those
 * listeners get no authorized context at all: the workspace comes from the
 * envelope's `team_id`, and which member lost access comes from
 * `event.tokens.oauth` (a human's user token) / `event.tokens.bot` (the bot's).
 * The affected attachments are detached and their instances transition to
 * `disconnected` carrying the reason, through the same status + event pair every
 * other Slack disconnect uses.
 *
 * Everything runs against a fake `@slack/bolt` (no network): the tests drive the
 * listener the receiver registered, exactly as Bolt would.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ConnectionStatus, DedupeCache, InstanceConfig, Logger, PluginContext } from '@omni/channel-sdk';
import { createInboundDedupeCache } from '@omni/channel-sdk';
import { DebounceManager } from '@omni/core';
import type { WebClient } from '@slack/web-api';

// ─────────────────────────────────────────────────────────────
// Fake @slack/bolt
// ─────────────────────────────────────────────────────────────

type FakeListener = (args: Record<string, unknown>) => Promise<void>;

interface FakeAppRecord {
  events: Map<string, FakeListener[]>;
}

const constructedApps: FakeAppRecord[] = [];

mock.module('@slack/bolt', () => {
  class FakeApp {
    readonly client = { auth: { test: async () => ({ ok: true }) } };
    readonly record: FakeAppRecord;

    constructor(_options: Record<string, unknown>) {
      this.record = { events: new Map() };
      constructedApps.push(this.record);
    }

    error(_handler: (error: Error) => Promise<void>): void {}

    event(name: string, ...listeners: FakeListener[]): void {
      this.record.events.set(name, [...(this.record.events.get(name) ?? []), ...listeners]);
    }

    message(..._listeners: unknown[]): void {}

    action(_constraints: unknown, ..._listeners: unknown[]): void {}

    view(_constraints: unknown, ..._listeners: unknown[]): void {}

    command(_name: unknown, ..._listeners: unknown[]): void {}

    shortcut(_constraints: unknown, ..._listeners: unknown[]): void {}

    async start(): Promise<void> {}

    async stop(): Promise<void> {}
  }

  class FakeSocketModeReceiver {
    readonly client = Object.assign(new EventEmitter(), { websocket: { isActive: () => true } });
  }

  class FakeHTTPReceiver {
    readonly requestListener = (): void => undefined;
  }

  return { App: FakeApp, SocketModeReceiver: FakeSocketModeReceiver, HTTPReceiver: FakeHTTPReceiver };
});

// Imported AFTER mock.module so the plugin binds to the fake Bolt.
const { SlackPlugin } = await import('../plugin');
type SlackPluginType = InstanceType<typeof SlackPlugin>;
type SlackAttachment = import('../connection/app-receiver').SlackAttachment;
type SlackAppReceiver = import('../connection/app-receiver').SlackAppReceiver;
type SlackConfig = import('../types').SlackConfig;

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const noop = (): void => undefined;
const noopLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

const TEAM = 'T_WORK';
const OTHER_TEAM = 'T_ELSE';
const BOT_USER = 'U_BOT';
const HUMAN_A = 'U_ANA';
const HUMAN_B = 'U_BEN';

const config: SlackConfig = { botToken: 'xoxb-config', appToken: 'xapp-shared' };

const openCaches: DedupeCache[] = [];
const openDebouncers: DebounceManager[] = [];

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface PluginInternals {
  obtainReceiver(
    options: { botToken: string; appToken?: string },
    config: SlackConfig,
  ): { key: string; receiver: SlackAppReceiver };
  attachments: Map<string, SlackAttachment>;
  instanceConfigs: Map<string, InstanceConfig>;
  /** The per-instance state a revocation has to release, as `disconnect()` does. */
  slackConfigs: Map<string, SlackConfig>;
  inboundHandlers: Map<string, (msg: Record<string, unknown>) => Promise<void>>;
  lastSeenTs: Map<string, Map<string, string>>;
  userNameCache: Map<string, string | null>;
  activeThreads: Map<string, string>;
  presenceStatusTimers: Map<string, ReturnType<typeof setTimeout>>;
  pendingAckReactions: Map<string, string>;
  dedupeCaches: Map<string, DedupeCache>;
  debouncers: Map<string, DebounceManager>;
}

/**
 * Fill every per-instance map the plugin keeps, the way a live instance fills
 * them: a resolved display name, an active thread, a status timer, an ack
 * reaction, a last-seen ts, an inbound handler and the reliability caches.
 */
function seedInstanceState(internals: PluginInternals, attachment: SlackAttachment): void {
  const instanceId = attachment.instanceId;
  internals.slackConfigs.set(instanceId, attachment.config);
  internals.inboundHandlers.set(instanceId, async () => undefined);
  internals.lastSeenTs.set(instanceId, new Map([['C_TEAM', '1000.0001']]));
  internals.userNameCache.set(`${instanceId}:U_SOMEONE`, 'Someone');
  internals.activeThreads.set(`${instanceId}:C_TEAM`, '1000.0001');
  internals.presenceStatusTimers.set(
    `${instanceId}:C_TEAM:1000.0001`,
    setTimeout(() => undefined, 60_000),
  );
  internals.pendingAckReactions.set(`${instanceId}:C_TEAM:1000.0001`, 'eyes');
  internals.dedupeCaches.set(instanceId, attachment.dedupeCache);
  internals.debouncers.set(instanceId, attachment.debouncer);
}

/** Every per-instance map key still mentioning an instance. */
function stateKeysFor(internals: PluginInternals, instanceId: string): string[] {
  const keys: string[] = [];
  const prefixed = [
    internals.userNameCache,
    internals.activeThreads,
    internals.presenceStatusTimers,
    internals.pendingAckReactions,
  ];
  for (const map of prefixed) {
    for (const key of map.keys()) if (key.startsWith(`${instanceId}:`)) keys.push(key);
  }
  const keyed = [
    internals.slackConfigs,
    internals.inboundHandlers,
    internals.lastSeenTs,
    internals.dedupeCaches,
    internals.debouncers,
  ];
  for (const map of keyed) {
    if (map.has(instanceId)) keys.push(instanceId);
  }
  return keys;
}

async function makeHarness(): Promise<{
  plugin: SlackPluginType;
  internals: PluginInternals;
  receiver: SlackAppReceiver;
  app: FakeAppRecord;
  published: PublishedEvent[];
}> {
  const published: PublishedEvent[] = [];
  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: {
      publish: async (type: string, payload: Record<string, unknown>) => {
        published.push({ type, payload });
        return 'evt-1';
      },
      subscribe: () => {},
    },
    storage: {},
    logger: noopLogger,
    config: {},
    db: {},
  } as unknown as PluginContext);

  const internals = plugin as unknown as PluginInternals;
  const { receiver } = internals.obtainReceiver({ botToken: 'xoxb-bot', appToken: 'xapp-shared' }, config);
  const app = constructedApps.at(-1);
  if (!app) throw new Error('no fake App constructed');
  return { plugin, internals, receiver, app, published };
}

function makeAttachment(instanceId: string, overrides: Partial<SlackAttachment> = {}): SlackAttachment {
  const dedupeCache = createInboundDedupeCache();
  openCaches.push(dedupeCache);
  const debouncer = new DebounceManager({ mode: 'none' }, noop);
  openDebouncers.push(debouncer);
  return {
    instanceId,
    teamId: TEAM,
    authMode: 'bot',
    actingClient: { auth: { test: async () => ({ ok: true }) } } as unknown as WebClient,
    botUserId: BOT_USER,
    botId: 'B_APP',
    botToken: 'xoxb-bot',
    config,
    dedupeCache,
    debouncer,
    attachedAt: openCaches.length,
    ...overrides,
  };
}

/** Attach an instance to both the receiver and the plugin, as connect() does. */
function install(internals: PluginInternals, receiver: SlackAppReceiver, attachment: SlackAttachment): SlackAttachment {
  receiver.attach(attachment);
  internals.attachments.set(attachment.instanceId, attachment);
  internals.instanceConfigs.set(attachment.instanceId, {
    instanceId: attachment.instanceId,
    channel: 'slack',
    options: {},
  } as unknown as InstanceConfig);
  return attachment;
}

/** Drive the listener Slack's revocation event reaches. */
async function fire(app: FakeAppRecord, eventName: string, event: Record<string, unknown>, teamId = TEAM) {
  const listeners = app.events.get(eventName);
  if (!listeners || listeners.length === 0) throw new Error(`no listener registered for ${eventName}`);
  for (const listener of listeners) {
    await listener({ body: { team_id: teamId, event, type: 'event_callback' }, event });
  }
}

const disconnects = (published: PublishedEvent[]) =>
  published.filter((event) => event.type === 'instance.disconnected').map((event) => event.payload);

afterEach(() => {
  for (const cache of openCaches) cache.dispose();
  openCaches.length = 0;
  for (const debouncer of openDebouncers) debouncer.flushAll();
  openDebouncers.length = 0;
  constructedApps.length = 0;
});

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('tokens_revoked', () => {
  it('detaches and disconnects only the member whose user token Slack revoked', async () => {
    const { plugin, internals, receiver, app, published } = await makeHarness();
    const ana = install(internals, receiver, makeAttachment('inst-ana', { authMode: 'user', actingUserId: HUMAN_A }));
    const ben = install(internals, receiver, makeAttachment('inst-ben', { authMode: 'user', actingUserId: HUMAN_B }));

    await fire(app, 'tokens_revoked', { type: 'tokens_revoked', tokens: { oauth: [HUMAN_B] } });

    // Ben is gone from the receiver AND from the plugin; Ana keeps receiving.
    expect(receiver.attachments.has(ben.instanceId)).toBe(false);
    expect(internals.attachments.has(ben.instanceId)).toBe(false);
    expect(receiver.attachments.has(ana.instanceId)).toBe(true);
    expect(internals.attachments.has(ana.instanceId)).toBe(true);

    const status: ConnectionStatus = await plugin.getStatus(ben.instanceId);
    expect(status.state).toBe('disconnected');
    expect(status.message).toBe('token_revoked');

    expect(disconnects(published)).toEqual([
      { instanceId: ben.instanceId, channelType: 'slack', reason: 'token_revoked', willReconnect: false },
    ]);
  });

  it('detaches the bot instance when the bot token is the one revoked', async () => {
    const { plugin, internals, receiver, app, published } = await makeHarness();
    const bot = install(internals, receiver, makeAttachment('inst-bot'));
    const ana = install(internals, receiver, makeAttachment('inst-ana', { authMode: 'user', actingUserId: HUMAN_A }));

    await fire(app, 'tokens_revoked', { type: 'tokens_revoked', tokens: { bot: [BOT_USER] } });

    expect(receiver.attachments.has(bot.instanceId)).toBe(false);
    expect(receiver.attachments.has(ana.instanceId)).toBe(true);
    expect((await plugin.getStatus(bot.instanceId)).message).toBe('token_revoked');
    expect(disconnects(published).map((payload) => payload.instanceId)).toEqual([bot.instanceId]);
  });

  it('leaves every attachment alone when the revocation is for another workspace', async () => {
    const { internals, receiver, app, published } = await makeHarness();
    install(internals, receiver, makeAttachment('inst-ana', { authMode: 'user', actingUserId: HUMAN_A }));

    await fire(app, 'tokens_revoked', { type: 'tokens_revoked', tokens: { oauth: [HUMAN_A] } }, OTHER_TEAM);

    expect(receiver.attachments.has('inst-ana')).toBe(true);
    expect(disconnects(published)).toEqual([]);
  });

  it('ignores a malformed tokens payload rather than disconnecting on it', async () => {
    const { internals, receiver, app, published } = await makeHarness();
    install(internals, receiver, makeAttachment('inst-ana', { authMode: 'user', actingUserId: HUMAN_A }));

    await fire(app, 'tokens_revoked', { type: 'tokens_revoked', tokens: { oauth: 'not-an-array' } });

    expect(receiver.attachments.has('inst-ana')).toBe(true);
    expect(disconnects(published)).toEqual([]);
  });
});

describe('app_uninstalled', () => {
  it('detaches and disconnects every instance of the workspace, keyed on body.team_id', async () => {
    const { plugin, internals, receiver, app, published } = await makeHarness();
    const bot = install(internals, receiver, makeAttachment('inst-bot'));
    const ana = install(internals, receiver, makeAttachment('inst-ana', { authMode: 'user', actingUserId: HUMAN_A }));
    const elsewhere = install(
      internals,
      receiver,
      makeAttachment('inst-elsewhere', { teamId: OTHER_TEAM, botUserId: 'U_BOT2' }),
    );

    await fire(app, 'app_uninstalled', { type: 'app_uninstalled' });

    expect(receiver.attachments.has(bot.instanceId)).toBe(false);
    expect(receiver.attachments.has(ana.instanceId)).toBe(false);
    // Another workspace on the same app keeps its install.
    expect(receiver.attachments.has(elsewhere.instanceId)).toBe(true);

    expect((await plugin.getStatus(bot.instanceId)).message).toBe('app_uninstalled');
    expect((await plugin.getStatus(ana.instanceId)).message).toBe('app_uninstalled');
    expect(disconnects(published).map((payload) => payload.reason)).toEqual(['app_uninstalled', 'app_uninstalled']);
  });
});

describe('per-instance cleanup', () => {
  it('releases the revoked instance state exactly as a disconnect does, and only its own', async () => {
    const { plugin, internals, receiver, app } = await makeHarness();
    const ana = install(internals, receiver, makeAttachment('inst-ana', { authMode: 'user', actingUserId: HUMAN_A }));
    const ben = install(internals, receiver, makeAttachment('inst-ben', { authMode: 'user', actingUserId: HUMAN_B }));
    seedInstanceState(internals, ana);
    seedInstanceState(internals, ben);
    expect(stateKeysFor(internals, ben.instanceId).length).toBeGreaterThan(0);

    await fire(app, 'tokens_revoked', { type: 'tokens_revoked', tokens: { oauth: [HUMAN_B] } });

    // A revoked install is out of service as definitively as a disconnected
    // one: nothing of Ben's is left behind, and nothing of Ana's is touched.
    expect(stateKeysFor(internals, ben.instanceId)).toEqual([]);
    expect(stateKeysFor(internals, ana.instanceId).length).toBeGreaterThan(0);

    // The same release runs on an ordinary disconnect.
    await plugin.disconnect(ana.instanceId);
    expect(stateKeysFor(internals, ana.instanceId)).toEqual([]);
  });
});
