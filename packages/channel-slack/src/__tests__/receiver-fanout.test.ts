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
  /** Slash-command listeners per command name. */
  commands: Map<string, FakeListener[]>;
  /** Block-action listeners, in registration order. */
  actions: FakeListener[];
  /** Modal submit/close listeners, in registration order. */
  views: FakeListener[];
}

const constructedApps: FakeAppRecord[] = [];

mock.module('@slack/bolt', () => {
  class FakeApp {
    readonly client = { auth: { test: async () => ({ ok: true }) } };
    readonly record: FakeAppRecord;

    constructor(_options: Record<string, unknown>) {
      this.record = { events: new Map(), messageListeners: [], commands: new Map(), actions: [], views: [] };
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

    // Interactions, modals and slash commands carry no event envelope, so they
    // are routed by workspace and actor instead — recorded here so the tests
    // can drive them exactly as Bolt would.
    action(_constraints: unknown, ...listeners: FakeListener[]): void {
      this.record.actions.push(...listeners);
    }

    view(_constraints: unknown, ...listeners: FakeListener[]): void {
      this.record.views.push(...listeners);
    }

    command(name: unknown, ...listeners: FakeListener[]): void {
      const key = String(name);
      this.record.commands.set(key, [...(this.record.commands.get(key) ?? []), ...listeners]);
    }

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
const OTHER_TEAM = 'T_ELSE';
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
  logger: Logger;
}

/** One event the plugin published, as the tests read the fan-out off it. */
interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
  /** The envelope the base plugin carries the instance id in. */
  metadata: Record<string, unknown>;
}

/** Log lines the plugin wrote, so a routing refusal can be asserted on. */
interface LoggedLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context: Record<string, unknown>;
}

async function makePlugin(configOverrides: Record<string, unknown> = {}): Promise<{
  plugin: InstanceType<typeof SlackPlugin>;
  internals: PluginInternals;
  receiver: SlackAppReceiver;
  app: FakeAppRecord;
  published: PublishedEvent[];
  logged: LoggedLine[];
}> {
  const published: PublishedEvent[] = [];
  const logged: LoggedLine[] = [];
  const capture =
    (level: LoggedLine['level']) =>
    (message: string, context?: Record<string, unknown>): void => {
      logged.push({ level, message, context: context ?? {} });
    };
  const logger: Logger = {
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    child: () => logger,
  };

  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: {
      publish: async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
        published.push({ type, payload, metadata: metadata ?? {} });
        return 'evt-1';
      },
      subscribe: () => {},
    },
    storage: {},
    logger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  const internals = plugin as unknown as PluginInternals;
  const { receiver } = internals.obtainReceiver({ botToken: 'xoxb-bot', appToken: 'xapp-shared' }, {
    ...config,
    ...configOverrides,
  } as SlackConfig);
  const app = constructedApps.at(-1);
  if (!app) throw new Error('no fake App constructed');
  return { plugin, internals, receiver, app, published, logged };
}

/**
 * Instance ids one kind of published event named, in publish order.
 *
 * The base plugin strips `instanceId` out of the payload and into the publish
 * metadata for most events, so both places are read.
 */
const instancesOf = (published: PublishedEvent[], type: string): unknown[] =>
  published
    .filter((event) => event.type === type)
    .map((event) => event.payload.instanceId ?? event.metadata.instanceId);

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

/** A one-click personal install: user mode on the person's own token, with no bot at all. */
const botlessAttachment = (instanceId: string, actingUserId: string): SlackAttachment =>
  makeAttachment(instanceId, {
    authMode: 'user',
    actingUserId,
    botToken: undefined,
    botUserId: undefined,
    botId: undefined,
  });

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
  it('a single user-mode attachment gets its event with no authorization lookup at all', async () => {
    const { internals, receiver, app } = await makePlugin();
    const probe = installAuthorizationsProbe(receiver, async () => {
      throw new Error('the one-attachment path must not look authorizations up');
    });

    // A personal install is the fixture the criterion names: one member of a
    // workspace, behind the deployment's app-level token, alone on its
    // receiver. Nothing is narrowed, so nothing is looked up.
    const only = userAttachment('inst-ana', HUMAN_A);
    receiver.attach(only);
    const spy = inboundSpy();
    internals.inboundHandlers.set(only.instanceId, spy.handler);

    await app.messageListeners[0]?.({
      message: channelMessage('U_OUTSIDER', '1000.0001'),
      body: envelope('EC-solo', [{ team_id: TEAM, user_id: HUMAN_A, is_bot: false }]),
    });

    expect(spy.calls).toHaveLength(1);
    expect(probe.calls).toEqual([]);
  });

  it('a lone bot-less attachment receives only events its own human is authorized for', async () => {
    const { internals, receiver, app } = await makePlugin();
    const probe = installAuthorizationsProbe(receiver, async () => [
      { team_id: TEAM, user_id: BOT_USER, is_bot: true },
    ]);

    const ana = botlessAttachment('inst-ana', HUMAN_A);
    receiver.attach(ana);
    const spy = inboundSpy();
    internals.inboundHandlers.set(ana.instanceId, spy.handler);

    // The app's bot from an earlier install is still in the workspace: another
    // member's DM to that bot is authorized for the bot alone, never for Ana.
    await app.messageListeners[0]?.({
      message: {
        type: 'message',
        channel: 'D_BOT',
        channel_type: 'im',
        user: 'U_OUTSIDER',
        ts: '1000.0101',
        text: 'for the bot only',
      },
      body: envelope('EC-bot-dm', [{ team_id: TEAM, user_id: BOT_USER, is_bot: true }]),
    });
    expect(spy.calls).toHaveLength(0);
    expect(probe.calls).toEqual(['EC-bot-dm']);

    // An event both see: the envelope names the bot, the lookup names Ana too.
    probe.answer = async () => [
      { team_id: TEAM, user_id: BOT_USER, is_bot: true },
      { team_id: TEAM, user_id: HUMAN_A, is_bot: false },
    ];
    await app.messageListeners[0]?.({
      message: channelMessage('U_OUTSIDER', '1000.0102'),
      body: envelope('EC-shared', [{ team_id: TEAM, user_id: BOT_USER, is_bot: true }]),
    });
    expect(spy.calls).toHaveLength(1);

    // An envelope that already names Ana needs no lookup at all.
    await app.messageListeners[0]?.({
      message: channelMessage('U_OUTSIDER', '1000.0103'),
      body: envelope('EC-own', [{ team_id: TEAM, user_id: HUMAN_A, is_bot: false }]),
    });
    expect(spy.calls).toHaveLength(2);
    expect(probe.calls).toEqual(['EC-bot-dm', 'EC-shared']);
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

// ─────────────────────────────────────────────────────────────
// Slash commands, pins and interactions (Group 5 review, HIGH #1)
// ─────────────────────────────────────────────────────────────

/** Drive the slash-command listener the plugin registered, as Bolt would. */
async function fireCommand(
  app: FakeAppRecord,
  command: Record<string, unknown>,
): Promise<{ acks: number; responses: Record<string, unknown>[] }> {
  const listeners = app.commands.get('/omni') ?? [];
  if (listeners.length === 0) throw new Error('no slash-command listener registered');
  const state = { acks: 0, responses: [] as Record<string, unknown>[] };
  for (const listener of listeners) {
    await listener({
      command,
      ack: async () => {
        state.acks += 1;
      },
      respond: async (response: Record<string, unknown>) => {
        state.responses.push(response);
      },
    });
  }
  return state;
}

/** The slash command Slack posts, with the workspace and the human who typed it. */
const slashCommand = (teamId: string, userId: string, text = 'status') => ({
  command: '/omni',
  text,
  user_id: userId,
  team_id: teamId,
  channel_id: 'C_TEAM',
  trigger_id: `trigger-${userId}`,
  response_url: 'https://hooks.slack.test/commands/1',
});

/** A bot-mode attachment of a SECOND workspace on the same Slack app. */
const otherWorkspaceBot = (instanceId: string): SlackAttachment =>
  makeAttachment(instanceId, { teamId: OTHER_TEAM, botUserId: 'U_BOT2', botToken: 'xoxb-other' });

describe('slash-command routing', () => {
  it('reaches only the issuing member, and never another workspace', async () => {
    const { internals, receiver, app, published } = await makePlugin({ slashCommands: ['/omni'] });
    installAuthorizationsProbe(receiver, async () => {
      throw new Error('a slash command carries no event_context to look up');
    });

    const ana = userAttachment('inst-ana', HUMAN_A);
    const ben = userAttachment('inst-ben', HUMAN_B);
    const elsewhere = otherWorkspaceBot('inst-other');
    for (const attachment of [ana, ben, elsewhere]) {
      receiver.attach(attachment);
      internals.attachments.set(attachment.instanceId, attachment);
    }

    const { acks } = await fireCommand(app, slashCommand(TEAM, HUMAN_A));

    // Ana typed it, so only Ana's instance sees the text — Ben's personal
    // install and the other workspace's bot see nothing.
    expect(instancesOf(published, 'message.received')).toEqual(['inst-ana']);
    expect(acks).toBe(1);

    // The other workspace's own command reaches only the other workspace.
    await fireCommand(app, slashCommand(OTHER_TEAM, 'U_STRANGER'));
    expect(instancesOf(published, 'message.received')).toEqual(['inst-ana', 'inst-other']);
  });

  it('falls back to the workspace bot when the issuer has no install, and refuses when nobody owns it', async () => {
    const { internals, receiver, app, published, logged } = await makePlugin({ slashCommands: ['/omni'] });
    const bot = makeAttachment('inst-bot');
    const ana = userAttachment('inst-ana', HUMAN_A);
    for (const attachment of [bot, ana]) {
      receiver.attach(attachment);
      internals.attachments.set(attachment.instanceId, attachment);
    }
    installAuthorizationsProbe(receiver, async () => {
      throw new Error('a slash command carries no event_context to look up');
    });

    // A third member with no install of their own: the workspace's bot install
    // is the one unambiguous owner of the command.
    await fireCommand(app, slashCommand(TEAM, 'U_CARLA'));
    expect(instancesOf(published, 'message.received')).toEqual(['inst-bot']);

    // With the bot gone, every install is personal and none of them is the
    // issuer's: the command is refused rather than fanned out.
    receiver.detach('inst-bot');
    const ben = userAttachment('inst-ben', HUMAN_B);
    receiver.attach(ben);
    internals.attachments.set(ben.instanceId, ben);
    await fireCommand(app, slashCommand(TEAM, 'U_CARLA'));

    expect(instancesOf(published, 'message.received')).toEqual(['inst-bot']);
    expect(
      logged.filter((line) => line.level === 'warn' && line.message.includes('matched no authorized Slack instance')),
    ).toHaveLength(1);
  });

  it('delivers to the single attachment of a workspace whoever typed it', async () => {
    const { internals, receiver, app, published } = await makePlugin({ slashCommands: ['/omni'] });
    const ana = userAttachment('inst-ana', HUMAN_A);
    receiver.attach(ana);
    internals.attachments.set(ana.instanceId, ana);

    // The single-attachment fast path is unchanged: one install for the
    // workspace owns everything that workspace sends.
    await fireCommand(app, slashCommand(TEAM, 'U_CARLA'));
    expect(instancesOf(published, 'message.received')).toEqual(['inst-ana']);
  });
});

describe('pin routing', () => {
  it("reaches only the authorized member of the pin's workspace", async () => {
    const { internals, receiver, app, published } = await makePlugin();
    const probe = installAuthorizationsProbe(receiver, async () => [
      { team_id: TEAM, user_id: HUMAN_A, is_bot: false },
    ]);

    const ana = userAttachment('inst-ana', HUMAN_A);
    const ben = userAttachment('inst-ben', HUMAN_B);
    const elsewhere = otherWorkspaceBot('inst-other');
    for (const attachment of [ana, ben, elsewhere]) {
      receiver.attach(attachment);
      internals.attachments.set(attachment.instanceId, attachment);
    }

    const pinEvent = {
      type: 'pin_added',
      user: HUMAN_A,
      channel_id: 'C_PRIVATE',
      item: { type: 'message', channel: 'C_PRIVATE', message: { ts: '1000.0100', text: 'pinned' } },
      event_ts: '1000.0101',
    };
    await app.events.get('pin_added')?.[0]?.({
      event: pinEvent,
      body: {
        team_id: TEAM,
        event_context: 'EC-pin',
        event_id: 'Ev-pin-1',
        authorizations: [{ team_id: TEAM, user_id: HUMAN_A, is_bot: false }],
      },
    });

    // A pin in a channel only Ana is in is Ana's state change alone; Ben's
    // instance and the other workspace never hear about it.
    expect(instancesOf(published, 'message.pinned')).toEqual(['inst-ana']);
    expect(probe.calls).toEqual(['EC-pin']);

    // An unpin in the OTHER workspace stays in the other workspace.
    await app.events.get('pin_removed')?.[0]?.({
      event: { ...pinEvent, type: 'pin_removed' },
      body: { team_id: OTHER_TEAM, event_context: 'EC-pin-other', event_id: 'Ev-pin-2' },
    });
    expect(instancesOf(published, 'message.unpinned')).toEqual(['inst-other']);
  });
});

describe('interaction routing', () => {
  it('reaches only the member who clicked, and never another workspace', async () => {
    const { internals, receiver, app, logged } = await makePlugin();
    installAuthorizationsProbe(receiver, async () => {
      throw new Error('an interaction carries no event_context to look up');
    });

    const ana = userAttachment('inst-ana', HUMAN_A);
    const ben = userAttachment('inst-ben', HUMAN_B);
    const elsewhere = otherWorkspaceBot('inst-other');
    for (const attachment of [ana, ben, elsewhere]) {
      receiver.attach(attachment);
      internals.attachments.set(attachment.instanceId, attachment);
    }

    const handled = (): unknown[] =>
      logged.filter((line) => line.message === 'Interaction handled').map((line) => line.context.instanceId);

    await app.actions[0]?.({
      action: { action_id: 'omni:approve', type: 'button', value: 'yes' },
      ack: async () => undefined,
      body: { team: { id: TEAM }, user: { id: HUMAN_B }, channel: { id: 'C_TEAM' }, message: { ts: '1000.0200' } },
    });
    expect(handled()).toEqual(['inst-ben']);

    // A modal submitted in the other workspace is the other workspace's.
    await app.views[0]?.({
      ack: async () => undefined,
      view: { callback_id: 'omni:form', private_metadata: '', state: { values: {} } },
      body: { team: { id: OTHER_TEAM }, user: { id: 'U_STRANGER' } },
    });
    expect(handled()).toEqual(['inst-ben', 'inst-other']);
  });
});

describe('redelivery of an event Slack retried', () => {
  it('processes a repeated reaction once per instance', async () => {
    const { internals, receiver, app, published } = await makePlugin();
    const only = userAttachment('inst-ana', HUMAN_A);
    receiver.attach(only);
    internals.attachments.set(only.instanceId, only);

    const event = {
      type: 'reaction_added',
      user: 'U_OUTSIDER',
      reaction: 'eyes',
      item: { type: 'message', channel: 'C_TEAM', ts: '1000.0300' },
    };
    const body = { team_id: TEAM, event_context: 'EC-react', event_id: 'Ev-react-1' };
    const listener = app.events.get('reaction_added')?.[0];

    // Bolt acks only after every listener resolves, so a slow event is
    // redelivered with the SAME event_id. The second delivery is dropped.
    await listener?.({ event, body });
    await listener?.({ event, body });

    expect(instancesOf(published, 'reaction.received')).toEqual(['inst-ana']);

    // A genuinely different reaction on the same message still lands.
    await listener?.({
      event: { ...event, reaction: 'tada' },
      body: { team_id: TEAM, event_context: 'EC-react', event_id: 'Ev-react-2' },
    });
    expect(instancesOf(published, 'reaction.received')).toEqual(['inst-ana', 'inst-ana']);
  });

  it('cancels a run once when the stop press is delivered twice', async () => {
    const { internals, receiver, app, published } = await makePlugin();
    const only = userAttachment('inst-ana', HUMAN_A);
    receiver.attach(only);
    internals.attachments.set(only.instanceId, only);

    const event = { type: 'agent_session_stopped', channel: 'C_TEAM', user: HUMAN_A, event_ts: '1000.0400' };
    const body = { team_id: TEAM, event_context: 'EC-stop', event_id: 'Ev-stop-1' };
    const listener = app.events.get('agent_session_stopped')?.[0];

    await listener?.({ event, body });
    await listener?.({ event, body });

    expect(instancesOf(published, 'agent.run.cancel_requested')).toEqual(['inst-ana']);
  });
});
