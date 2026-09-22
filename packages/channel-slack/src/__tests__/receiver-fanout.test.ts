/**
 * Per-event fan-out on a shared receiver (slack-personal-oauth, Group 5).
 *
 * Several instances of ONE workspace now share one Bolt `App`, so "deliver to
 * every attachment of the team" would show each member's private conversations
 * to every other member. Delivery is narrowed to the attachments Slack
 * authorized for the event: `body.authorizations` plus
 * `apps.event.authorizations.list(event_context)`, cached per event context.
 *
 * Everything runs against a fake `@slack/bolt` (no network): the fake App
 * records its listeners so the tests can drive them exactly as Bolt would. The
 * authorizations lookup is a probe planted on the receiver's app-level client,
 * so no test can reach a real Slack endpoint; the fake counts its calls, which
 * is what the 60 s cache is judged by.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { DedupeCache, InstanceConfig, Logger, PluginContext } from '@omni/channel-sdk';
import { createInboundDedupeCache } from '@omni/channel-sdk';
import { DebounceManager } from '@omni/core';
import type { WebClient } from '@slack/web-api';
import { SlackError, SlackErrorCode } from '../types';

// ─────────────────────────────────────────────────────────────
// Fake @slack/bolt
// ─────────────────────────────────────────────────────────────

type FakeListener = (args: Record<string, unknown>) => Promise<void>;

interface FakeAppRecord {
  events: Map<string, FakeListener[]>;
  messageListeners: FakeListener[];
}

const constructedApps: FakeAppRecord[] = [];

mock.module('@slack/bolt', () => {
  class FakeApp {
    readonly client = { auth: { test: async () => ({ ok: true }) } };
    readonly record: FakeAppRecord;

    constructor(_options: Record<string, unknown>) {
      this.record = { events: new Map(), messageListeners: [] };
      constructedApps.push(this.record);
    }

    error(_handler: (error: Error) => Promise<void>): void {
      // the global error handler is not under test
    }

    event(name: string, ...listeners: FakeListener[]): void {
      this.record.events.set(name, [...(this.record.events.get(name) ?? []), ...listeners]);
    }

    message(...listeners: FakeListener[]): void {
      this.record.messageListeners.push(...listeners);
    }

    // Interactions, modals and slash commands resolve no targets from an event
    // envelope, so their registrations are accepted and not recorded.
    action(_constraints: unknown, ..._listeners: unknown[]): void {}

    view(_constraints: unknown, ..._listeners: unknown[]): void {}

    command(_name: unknown, ..._listeners: unknown[]): void {}

    shortcut(_constraints: unknown, ..._listeners: unknown[]): void {}

    async start(): Promise<void> {
      // nothing is started in these tests
    }

    async stop(): Promise<void> {
      // nothing is started in these tests
    }
  }

  class FakeSocketModeReceiver {
    readonly client = Object.assign(new EventEmitter(), { websocket: { isActive: () => true } });
  }

  class FakeHTTPReceiver {
    readonly requestListener = (): void => undefined;
  }

  return { App: FakeApp, SocketModeReceiver: FakeSocketModeReceiver, HTTPReceiver: FakeHTTPReceiver };
});

// Imported AFTER mock.module so both bind to the fake Bolt.
const { SlackPlugin } = await import('../plugin');
const { setupMessageHandlers } = await import('../handlers/messages');
type SlackAttachment = import('../connection/app-receiver').SlackAttachment;
type SlackAuthorization = import('../connection/app-receiver').SlackAuthorization;
type SlackAppReceiver = import('../connection/app-receiver').SlackAppReceiver;
type SlackConfig = import('../types').SlackConfig;

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const noop = (): void => undefined;
const noopLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

const TEAM = 'T_WORK';
const BOT_USER = 'U_BOT';
const HUMAN_A = 'U_ANA';
const HUMAN_B = 'U_BEN';

const config: SlackConfig = { botToken: 'xoxb-config', appToken: 'xapp-shared' };

const openCaches: DedupeCache[] = [];
const openDebouncers: DebounceManager[] = [];

/**
 * The plugin internals these tests drive: the receiver factory (so the real
 * Bolt registration under test runs), the per-instance inbound handlers the
 * shared message listener calls, and the attachment map.
 */
interface PluginInternals {
  obtainReceiver(
    options: { botToken: string; appToken?: string },
    config: SlackConfig,
  ): { key: string; receiver: SlackAppReceiver };
  inboundHandlers: Map<string, (msg: Record<string, unknown>) => Promise<void>>;
  attachments: Map<string, SlackAttachment>;
}

async function makePlugin(): Promise<{
  plugin: InstanceType<typeof SlackPlugin>;
  internals: PluginInternals;
  receiver: SlackAppReceiver;
  app: FakeAppRecord;
}> {
  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger: noopLogger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  const internals = plugin as unknown as PluginInternals;
  const { receiver } = internals.obtainReceiver({ botToken: 'xoxb-bot', appToken: 'xapp-shared' }, config);
  const app = constructedApps.at(-1);
  if (!app) throw new Error('no fake App constructed');
  return { plugin, internals, receiver, app };
}

/**
 * Plant the client the receiver hands out for a bot token.
 *
 * `connect()` resolves the workspace identity through `clientForBotToken`,
 * which would otherwise mint a real `WebClient` and call `auth.test` over the
 * network. Seeding the cache keeps the REAL connect path — attach guard and
 * all — entirely offline, and `attach` then reuses this very object.
 */
function plantBotClient(receiver: SlackAppReceiver, botToken: string): void {
  const client = {
    auth: {
      test: async () => ({ ok: true, team_id: TEAM, user_id: BOT_USER, bot_id: 'B_APP', user: 'omni' }),
    },
  } as unknown as WebClient;
  (receiver as unknown as { clientsByToken: Map<string, WebClient> }).clientsByToken.set(botToken, client);
}

/** The `InstanceConfig` a bot-mode connect of the shared workspace arrives with. */
function botConnectConfig(instanceId: string, force?: boolean): InstanceConfig {
  return {
    instanceId,
    credentials: {},
    options: {
      botToken: 'xoxb-bot',
      appToken: 'xapp-shared',
      authMode: 'bot',
      ...(force === undefined ? {} : { force }),
    },
  } as unknown as InstanceConfig;
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

/** A user-mode attachment of the shared workspace, acting as one human. */
const userAttachment = (instanceId: string, actingUserId: string): SlackAttachment =>
  makeAttachment(instanceId, { authMode: 'user', actingUserId });

interface AuthorizationsProbe {
  /** Every `event_context` the receiver looked up, in order. */
  calls: string[];
  answer: () => Promise<SlackAuthorization[]>;
}

/**
 * Replace the receiver's app-level client with a probe.
 *
 * The real one is a `WebClient` carrying the `xapp-…` token — the only token
 * `apps.event.authorizations.list` accepts. Swapping it here is what keeps the
 * test off the network while still exercising the receiver's own caching,
 * failure handling and selection.
 */
function installAuthorizationsProbe(receiver: SlackAppReceiver, answer: () => Promise<SlackAuthorization[]>) {
  const probe: AuthorizationsProbe = { calls: [], answer };
  const client = {
    apps: {
      event: {
        authorizations: {
          list: async ({ event_context }: { event_context: string }) => {
            probe.calls.push(event_context);
            return { authorizations: await probe.answer() };
          },
        },
      },
    },
  };
  (receiver as unknown as { appLevelClient: unknown }).appLevelClient = client;
  return probe;
}

/** The `body` of a message event, as Slack envelopes it. */
const envelope = (eventContext: string, authorizations: SlackAuthorization[]) => ({
  team_id: TEAM,
  event_context: eventContext,
  authorizations,
  type: 'event_callback',
});

const channelMessage = (author: string, ts: string) => ({
  type: 'message',
  channel: 'C_TEAM',
  channel_type: 'channel',
  user: author,
  ts,
  text: 'hello there',
});

function inboundSpy(): { calls: Record<string, unknown>[]; handler: (msg: Record<string, unknown>) => Promise<void> } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    handler: async (msg) => {
      calls.push(msg);
    },
  };
}

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

describe('shared-receiver fan-out', () => {
  it('a single attachment gets a bot-only event with no authorization lookup at all', async () => {
    const { internals, receiver, app } = await makePlugin();
    const probe = installAuthorizationsProbe(receiver, async () => {
      throw new Error('the one-attachment path must not look authorizations up');
    });

    const only = makeAttachment('inst-bot');
    receiver.attach(only);
    const spy = inboundSpy();
    internals.inboundHandlers.set(only.instanceId, spy.handler);

    await app.messageListeners[0]?.({
      message: channelMessage(HUMAN_A, '1000.0001'),
      body: envelope('EC-solo', [{ team_id: TEAM, user_id: BOT_USER, is_bot: true }]),
    });

    expect(spy.calls).toHaveLength(1);
    expect(probe.calls).toEqual([]);
  });

  it('two user-mode attachments: a channel event authorizing both reaches each handler once, on one lookup', async () => {
    const { internals, receiver, app } = await makePlugin();
    const probe = installAuthorizationsProbe(receiver, async () => [
      { team_id: TEAM, user_id: HUMAN_A, is_bot: false },
      { team_id: TEAM, user_id: HUMAN_B, is_bot: false },
    ]);

    const ana = userAttachment('inst-ana', HUMAN_A);
    const ben = userAttachment('inst-ben', HUMAN_B);
    receiver.attach(ana);
    receiver.attach(ben);
    const anaSpy = inboundSpy();
    const benSpy = inboundSpy();
    internals.inboundHandlers.set(ana.instanceId, anaSpy.handler);
    internals.inboundHandlers.set(ben.instanceId, benSpy.handler);

    // Slack puts ONE authorization in the envelope; the rest come from the API.
    const body = envelope('EC-channel', [{ team_id: TEAM, user_id: HUMAN_A, is_bot: false }]);
    await app.messageListeners[0]?.({ message: channelMessage('U_OUTSIDER', '1000.0002'), body });

    expect(anaSpy.calls).toHaveLength(1);
    expect(benSpy.calls).toHaveLength(1);
    expect(probe.calls).toEqual(['EC-channel']);

    // A second event on the same event_context is answered from the cache.
    await app.messageListeners[0]?.({ message: channelMessage('U_OUTSIDER', '1000.0003'), body });
    expect(anaSpy.calls).toHaveLength(2);
    expect(benSpy.calls).toHaveLength(2);
    expect(probe.calls).toEqual(['EC-channel']);

    // A different event context is a different lookup.
    await app.messageListeners[0]?.({
      message: channelMessage('U_OUTSIDER', '1000.0004'),
      body: envelope('EC-other', [{ team_id: TEAM, user_id: HUMAN_A, is_bot: false }]),
    });
    expect(probe.calls).toEqual(['EC-channel', 'EC-other']);
  });

  it('a DM reaches only the member it was authorized for', async () => {
    const { internals, receiver, app } = await makePlugin();
    const probe = installAuthorizationsProbe(receiver, async () => [
      { team_id: TEAM, user_id: HUMAN_B, is_bot: false },
    ]);

    const ana = userAttachment('inst-ana', HUMAN_A);
    const ben = userAttachment('inst-ben', HUMAN_B);
    receiver.attach(ana);
    receiver.attach(ben);
    const anaSpy = inboundSpy();
    const benSpy = inboundSpy();
    internals.inboundHandlers.set(ana.instanceId, anaSpy.handler);
    internals.inboundHandlers.set(ben.instanceId, benSpy.handler);

    await app.messageListeners[0]?.({
      message: {
        type: 'message',
        channel: 'D_BEN',
        channel_type: 'im',
        user: 'U_OUTSIDER',
        ts: '1000.0005',
        text: 'psst',
      },
      body: envelope('EC-dm', [{ team_id: TEAM, user_id: HUMAN_B, is_bot: false }]),
    });

    expect(benSpy.calls).toHaveLength(1);
    expect(anaSpy.calls).toHaveLength(0);
    expect(probe.calls).toEqual(['EC-dm']);
  });

  it("filters a member's own outbound message per attachment, not receiver-wide", async () => {
    const ana = userAttachment('inst-ana', HUMAN_A);
    const ben = userAttachment('inst-ben', HUMAN_B);
    const dispatched: string[] = [];
    const handlerFor = (attachment: SlackAttachment) =>
      setupMessageHandlers(
        undefined,
        attachment,
        undefined,
        {
          onMessage: async (instanceId) => {
            dispatched.push(instanceId);
          },
        },
        { policy: 'open' },
        noopLogger,
      );

    // Ben types from his own phone: his instance must not treat its own
    // principal's message as inbound, while Ana's instance must.
    const ownMessage = { ...channelMessage(HUMAN_B, '1000.0006'), team: TEAM };
    await handlerFor(ana)(ownMessage);
    await handlerFor(ben)(ownMessage);

    expect(dispatched).toEqual(['inst-ana']);
  });

  it('a second bot-mode connect of the workspace is refused without force and accepted with it', async () => {
    // Driven through the PLUGIN, not through `receiver.attach`: the point of
    // this case is that the API's documented `force` escape survives the trip
    // from the connect options down to the receiver's attach-time guard.
    const { plugin, receiver } = await makePlugin();
    plantBotClient(receiver, 'xoxb-bot');

    await plugin.connect('inst-bot-1', botConnectConfig('inst-bot-1'));
    expect(receiver.attachments.has('inst-bot-1')).toBe(true);

    const refusal = await plugin.connect('inst-bot-2', botConnectConfig('inst-bot-2')).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(SlackError);
    expect((refusal as SlackError).channelCode).toBe(SlackErrorCode.BOT_INSTANCE_EXISTS);
    expect(receiver.attachments.has('inst-bot-2')).toBe(false);

    await plugin.connect('inst-bot-2', botConnectConfig('inst-bot-2', true));
    expect(receiver.attachments.has('inst-bot-2')).toBe(true);
    expect(receiver.attachments.has('inst-bot-1')).toBe(true);

    await plugin.disconnect('inst-bot-1');
    await plugin.disconnect('inst-bot-2');
  });

  it('falls back to the envelope authorization when authorizations:read is missing, logging once', async () => {
    const { internals, receiver, app } = await makePlugin();
    const warnings: string[] = [];
    (receiver as unknown as { logger: Logger }).logger = {
      ...noopLogger,
      warn: (message: string) => {
        warnings.push(message);
      },
    };
    const probe = installAuthorizationsProbe(receiver, async () => {
      throw new Error('An API error occurred: missing_scope');
    });

    const ana = userAttachment('inst-ana', HUMAN_A);
    const ben = userAttachment('inst-ben', HUMAN_B);
    receiver.attach(ana);
    receiver.attach(ben);
    const anaSpy = inboundSpy();
    const benSpy = inboundSpy();
    internals.inboundHandlers.set(ana.instanceId, anaSpy.handler);
    internals.inboundHandlers.set(ben.instanceId, benSpy.handler);

    await app.messageListeners[0]?.({
      message: channelMessage('U_OUTSIDER', '1000.0007'),
      body: envelope('EC-noscope-1', [{ team_id: TEAM, user_id: HUMAN_A, is_bot: false }]),
    });
    await app.messageListeners[0]?.({
      message: channelMessage('U_OUTSIDER', '1000.0008'),
      body: envelope('EC-noscope-2', [{ team_id: TEAM, user_id: HUMAN_A, is_bot: false }]),
    });

    // The single entry the envelope carried is delivered to; the other member
    // is not guessed at, the failure never surfaces as a throw, and the missing
    // scope is reported once rather than per event.
    expect(anaSpy.calls).toHaveLength(2);
    expect(benSpy.calls).toHaveLength(0);
    expect(probe.calls).toEqual(['EC-noscope-1']);
    expect(warnings.filter((message) => message.includes('authorizations:read'))).toHaveLength(1);
  });
});
