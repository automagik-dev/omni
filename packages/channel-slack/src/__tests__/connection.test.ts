/**
 * Tests for Slack channel plugin connection and core functionality
 *
 * Tests Group A: Core Connection + Inbound Messages
 *
 * The receiver-sharing group at the bottom drives the REAL connect() path, so
 * @slack/bolt and @slack/web-api are mocked first: the plugin builds a Bolt App
 * and a bot-token WebClient on every connect, and neither may reach Slack here.
 */

import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { InstanceConfig, PluginContext } from '@omni/channel-sdk';

import { SLACK_CAPABILITIES } from '../capabilities';
import { type DmPolicyConfig, shouldAcceptDm } from '../dm-policy';
import { extractMessageMeta } from '../handlers/messages';
import { BOT_EVENTS, REQUIRED_BOT_SCOPES, buildSlackManifest } from '../manifest';
import { SlackError, SlackErrorCode } from '../types';

/** Every listener the shared receiver registers, so a test can deliver an event. */
type Listener = (args: Record<string, unknown>) => Promise<void>;
const messageListeners: Listener[] = [];

/** The token of every WebClient built, so a test can prove no bot client was minted. */
const webClientTokens: (string | undefined)[] = [];

mock.module('@slack/bolt', () => {
  class MockApp {
    client = { auth: { test: async () => ({ ok: true }) } };
    started = 0;
    stopped = 0;
    error(_handler: unknown) {}
    message(listener: Listener) {
      messageListeners.push(listener);
    }
    event(_name: string, _listener: Listener) {}
    action(_pattern: unknown, _listener: Listener) {}
    view(_pattern: unknown, _listener: Listener) {}
    command(_name: string, _listener: Listener) {}
    async start() {
      this.started++;
    }
    async stop() {
      this.stopped++;
    }
  }
  class MockSocketModeReceiver {
    client = Object.assign(new EventEmitter(), { websocket: { isActive: () => true } });
  }
  class MockHTTPReceiver {
    requestListener = (_req: unknown, res: { writeHead: (c: number) => void; end: (b: string) => void }) => {
      res.writeHead(200);
      res.end('ok');
    };
  }
  return { App: MockApp, SocketModeReceiver: MockSocketModeReceiver, HTTPReceiver: MockHTTPReceiver };
});

mock.module('@slack/web-api', () => {
  class MockWebClient {
    token: string | undefined;
    auth: { test: () => Promise<Record<string, unknown>> };
    users?: { info: (args: { user: string }) => Promise<Record<string, unknown>> };
    constructor(token?: string, _opts?: Record<string, unknown>) {
      this.token = token;
      webClientTokens.push(token);
      // 'xoxp-display' is the one human whose Slack profile carries a display
      // name that differs from the username, so the name the instance presents
      // must come from users.info. No other fake has `users`, so every other
      // connect falls back to the auth.test username.
      if (token?.startsWith('xoxp-display')) {
        this.users = {
          info: async ({ user }) => ({
            ok: true,
            user: { id: user, name: 'display', profile: { display_name: 'Display Person', real_name: 'Display Real' } },
          }),
        };
      }
      this.auth = {
        // A user token answers as the human named in it, so two personal
        // installs of one workspace get DISTINCT acting users: 'xoxp-ana' is
        // U_ANA, 'xoxp-human' is U_HUMAN. 'xoxp-nouser' is the token whose
        // auth.test comes back WITHOUT a user_id — the user-mode failure case.
        // 'xoxp-carla@T_SHARED' also names its workspace, as a real user
        // token's auth.test does; a bot-less connect has no other source.
        test: async () => {
          if (this.token?.startsWith('xoxp-nouser')) return { ok: true };
          if (this.token?.startsWith('xoxp-')) {
            const [name = '', teamId] = this.token.slice('xoxp-'.length).split('@');
            return { ok: true, user_id: `U_${name.toUpperCase()}`, user: name, ...(teamId ? { team_id: teamId } : {}) };
          }
          return {
            ok: true,
            user_id: 'U0BOT',
            bot_id: 'B0BOT',
            user: 'omni',
            team_id: 'T_SHARED',
            team: 'shared workspace',
          };
        },
      };
    }
  }
  return { WebClient: MockWebClient };
});

// Only the plugin has to be imported AFTER the mocks — it is what builds a
// Bolt App and a bot-token WebClient. The rest pull in neither.
const { SlackPlugin } = await import('../plugin');
type SlackPlugin = InstanceType<typeof SlackPlugin>;

// ─────────────────────────────────────────────────────────────
// Plugin identity
// ─────────────────────────────────────────────────────────────

describe('SlackPlugin identity', () => {
  it('has correct id and name', () => {
    const plugin = new SlackPlugin();
    expect(plugin.id).toBe('slack');
    expect(plugin.name).toBe('Slack (Bolt.js)');
    expect(plugin.version).toBe('1.0.0');
  });

  it('exposes capabilities', () => {
    const plugin = new SlackPlugin();
    expect(plugin.capabilities.canSendText).toBe(true);
    expect(plugin.capabilities.canSendMedia).toBe(true);
    expect(plugin.capabilities.canEditMessage).toBe(true);
    expect(plugin.capabilities.canDeleteMessage).toBe(true);
    expect(plugin.capabilities.canSendButtons).toBe(true);
    expect(plugin.capabilities.canSendSelectMenu).toBe(true);
    expect(plugin.capabilities.canShowModal).toBe(true);
    expect(plugin.capabilities.canUseSlashCommands).toBe(true);
    expect(plugin.capabilities.canHandleDMs).toBe(true);
    expect(plugin.capabilities.canHandleThreads).toBe(true);
    expect(plugin.capabilities.canStreamResponse).toBe(true);
    expect(plugin.capabilities.maxMessageLength).toBe(4000);
  });
});

// ─────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────

describe('SLACK_CAPABILITIES', () => {
  it('declares correct media support', () => {
    expect(SLACK_CAPABILITIES.canSendMedia).toBe(true);
    expect(SLACK_CAPABILITIES.maxFileSize).toBe(1024 * 1024 * 1024); // 1GB
    expect(SLACK_CAPABILITIES.supportedMediaTypes).toHaveLength(4);
  });

  it('declares streaming support', () => {
    expect(SLACK_CAPABILITIES.canStreamResponse).toBe(true);
  });

  it('declares correct interaction support', () => {
    expect(SLACK_CAPABILITIES.canSendButtons).toBe(true);
    expect(SLACK_CAPABILITIES.canSendSelectMenu).toBe(true);
    expect(SLACK_CAPABILITIES.canShowModal).toBe(true);
    expect(SLACK_CAPABILITIES.canUseSlashCommands).toBe(true);
    expect(SLACK_CAPABILITIES.canUseContextMenu).toBe(false); // Slack doesn't have context menus
  });
});

// ─────────────────────────────────────────────────────────────
// DM Policy
// ─────────────────────────────────────────────────────────────

describe('DM Policy', () => {
  it('open policy accepts all DMs', () => {
    const config: DmPolicyConfig = { policy: 'open' };
    expect(shouldAcceptDm('U12345', config).accepted).toBe(true);
    expect(shouldAcceptDm('U99999', config).accepted).toBe(true);
  });

  it('pairing policy accepts allowlisted users', () => {
    const config: DmPolicyConfig = {
      policy: 'pairing',
      allowlist: ['U12345', 'U67890'],
    };
    expect(shouldAcceptDm('U12345', config).accepted).toBe(true);
    expect(shouldAcceptDm('U67890', config).accepted).toBe(true);
  });

  it('pairing policy rejects non-allowlisted users', () => {
    const config: DmPolicyConfig = {
      policy: 'pairing',
      allowlist: ['U12345'],
    };
    const result = shouldAcceptDm('U99999', config);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('closed policy rejects all DMs', () => {
    const config: DmPolicyConfig = { policy: 'closed' };
    const result = shouldAcceptDm('U12345', config);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('closed policy uses custom rejection message', () => {
    const config: DmPolicyConfig = {
      policy: 'closed',
      rejectionMessage: 'Custom rejection',
    };
    const result = shouldAcceptDm('U12345', config);
    expect(result.reason).toBe('Custom rejection');
  });
});

// ─────────────────────────────────────────────────────────────
// App Manifest
// ─────────────────────────────────────────────────────────────

describe('App Manifest', () => {
  it('includes all required OAuth scopes', () => {
    const manifest = buildSlackManifest();
    const scopes = manifest.oauth_config.scopes.bot;

    // Verify all required scopes
    for (const scope of REQUIRED_BOT_SCOPES) {
      expect(scopes).toContain(scope);
    }

    // Should have at least 18 scopes
    expect(scopes.length).toBeGreaterThanOrEqual(18);
  });

  it('includes all required event subscriptions', () => {
    const manifest = buildSlackManifest();
    const events = manifest.settings.event_subscriptions.bot_events;

    for (const event of BOT_EVENTS) {
      expect(events).toContain(event);
    }
  });

  it('enables Socket Mode', () => {
    const manifest = buildSlackManifest();
    expect(manifest.settings.socket_mode_enabled).toBe(true);
  });

  it('enables interactivity', () => {
    const manifest = buildSlackManifest();
    expect(manifest.settings.interactivity?.is_enabled).toBe(true);
  });

  it('includes slash commands when provided', () => {
    const manifest = buildSlackManifest({
      slashCommands: [{ command: '/omni', description: 'Talk to Omni' }],
    });
    expect(manifest.features.slash_commands).toHaveLength(1);
    expect(manifest.features.slash_commands?.[0]?.command).toBe('/omni');
  });

  it('enables the Agent messaging experience (#914)', () => {
    const manifest = buildSlackManifest();

    // agent_view (not the deprecated assistant_view) with a description
    expect(manifest.features.agent_view).toBeDefined();
    expect(manifest.features.agent_view?.agent_description.length).toBeGreaterThan(0);
    expect(manifest.features.agent_view?.agent_description.length).toBeLessThanOrEqual(300);

    // Subscribing to agent_session_stopped is what makes Slack show the
    // native stop button while a session is processing.
    expect(manifest.settings.event_subscriptions.bot_events).toContain('agent_session_stopped');
  });

  it('carries custom agent description and suggested prompts', () => {
    const manifest = buildSlackManifest({
      agentDescription: 'Reviews code in Slack threads',
      suggestedPrompts: [{ title: 'Review PR', message: 'Review the open PR' }],
    });
    expect(manifest.features.agent_view?.agent_description).toBe('Reviews code in Slack threads');
    expect(manifest.features.agent_view?.suggested_prompts).toEqual([
      { title: 'Review PR', message: 'Review the open PR' },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Message metadata extraction
// ─────────────────────────────────────────────────────────────

describe('extractMessageMeta', () => {
  it('extracts basic message metadata', () => {
    const meta = extractMessageMeta({
      channel: 'C12345',
      ts: '1234567890.123456',
      user: 'U12345',
      team: 'T12345',
      channel_type: 'channel',
    });

    expect(meta.channelId).toBe('C12345');
    expect(meta.ts).toBe('1234567890.123456');
    expect(meta.userId).toBe('U12345');
    expect(meta.teamId).toBe('T12345');
    expect(meta.isDm).toBe(false);
    expect(meta.isThreadReply).toBe(false);
  });

  it('detects DMs', () => {
    const meta = extractMessageMeta({
      channel: 'D12345',
      ts: '1234567890.123456',
      user: 'U12345',
      channel_type: 'im',
    });

    expect(meta.isDm).toBe(true);
  });

  it('detects thread replies', () => {
    const meta = extractMessageMeta({
      channel: 'C12345',
      ts: '1234567890.999999',
      thread_ts: '1234567890.123456',
      user: 'U12345',
      channel_type: 'channel',
    });

    expect(meta.isThreadReply).toBe(true);
    expect(meta.threadTs).toBe('1234567890.123456');
  });

  it('handles thread parent messages (ts === thread_ts)', () => {
    const meta = extractMessageMeta({
      channel: 'C12345',
      ts: '1234567890.123456',
      thread_ts: '1234567890.123456',
      user: 'U12345',
      channel_type: 'channel',
    });

    // Parent message of thread: thread_ts === ts, so it's NOT a reply
    expect(meta.isThreadReply).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────

describe('SlackError', () => {
  it('creates error with code and message', () => {
    const error = new SlackError(SlackErrorCode.NOT_CONNECTED, 'Not connected');
    expect(error.channelCode).toBe(SlackErrorCode.NOT_CONNECTED);
    expect(error.message).toBe('Not connected');
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe('SlackError');
  });

  it('supports recoverable flag', () => {
    const error = new SlackError(SlackErrorCode.RATE_LIMITED, 'Rate limited', true);
    expect(error.recoverable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Rate limiting configuration
// ─────────────────────────────────────────────────────────────

describe('Rate limiting config', () => {
  it('plugin accepts retryConfig in options', () => {
    const plugin = new SlackPlugin();
    // Just verify the type works — actual connection test requires a Slack workspace
    expect(plugin.id).toBe('slack');
  });
});

// ─────────────────────────────────────────────────────────────
// Shared receiver: one Slack app token, one socket, many instances
// ─────────────────────────────────────────────────────────────

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

/** Plugin internals these tests seed or inspect. */
interface SharedInternals {
  receivers: Map<string, { isRunning: boolean; attachments: ReadonlyMap<string, unknown> }>;
  attachments: Map<string, { attachedAt: number; actingUserId?: string; teamId: string; botToken?: string }>;
  inboundHandlers: Map<string, (msg: Record<string, unknown>) => Promise<void>>;
}

const APP_TOKEN = 'xapp-shared';

const ANA = 'U_ANA';
const BEN = 'U_BEN';

function configFor(instanceId: string, appToken = APP_TOKEN): InstanceConfig {
  return {
    instanceId,
    credentials: {},
    options: { botToken: 'xoxb-shared', appToken },
  };
}

/**
 * A personal (user-mode) install of the shared workspace.
 *
 * Two instances of ONE workspace behind one Slack app are personal installs:
 * a second BOT-mode instance of the same workspace is refused at attach time
 * (see app-receiver.test.ts), because both would answer for the same bot user.
 */
function userConfigFor(instanceId: string, userToken: string, appToken = APP_TOKEN): InstanceConfig {
  return {
    instanceId,
    credentials: {},
    options: { botToken: 'xoxb-shared', appToken, authMode: 'user', userToken },
  };
}

async function makeSharedPlugin(): Promise<{ plugin: SlackPlugin; internals: SharedInternals }> {
  messageListeners.length = 0;
  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger: noopLogger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  return { plugin, internals: plugin as unknown as SharedInternals };
}

/**
 * Replace each instance's inbound handler with a recorder, so delivering ONE
 * event to the shared receiver shows exactly which attachments it reached.
 */
function recordInbound(internals: SharedInternals, instanceIds: string[]): string[] {
  const reached: string[] = [];
  for (const instanceId of instanceIds) {
    internals.inboundHandlers.set(instanceId, async () => {
      reached.push(instanceId);
    });
  }
  return reached;
}

/**
 * Deliver one workspace message through every listener the receiver registered.
 *
 * Delivery on a shared workspace is narrowed to the attachments Slack
 * authorized, so the envelope carries an authorization per acting user (and
 * `is_bot` for the bot install). With no `event_context` the receiver takes the
 * envelope as the whole answer and looks nothing up.
 */
async function deliverTeamMessage(teamId = 'T_SHARED', authorizedUserIds: string[] = [ANA, BEN]): Promise<void> {
  const authorizations = authorizedUserIds.map((userId) => ({
    team_id: teamId,
    user_id: userId,
    is_bot: userId === 'U0BOT',
  }));
  for (const listener of messageListeners) {
    await listener({
      message: { channel: 'C1', ts: '1700000000.000100', user: 'U_HUMAN', text: 'hi' },
      body: { team_id: teamId, authorizations },
    });
  }
}

describe('SlackPlugin — instances behind one Slack app share one receiver', () => {
  it('two instances on one app token share a single receiver, and one team event reaches both', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    await plugin.connect('inst-a', userConfigFor('inst-a', 'xoxp-ana'));
    await plugin.connect('inst-b', userConfigFor('inst-b', 'xoxp-ben'));

    // One Slack app ⇒ one receiver ⇒ one socket, with both instances attached.
    expect(internals.receivers.size).toBe(1);
    expect(messageListeners).toHaveLength(1);
    const receiver = [...internals.receivers.values()][0];
    expect(receiver?.attachments.size).toBe(2);
    expect(internals.attachments.get('inst-a')?.actingUserId).toBe(ANA);
    expect(internals.attachments.get('inst-b')?.actingUserId).toBe(BEN);

    const reached = recordInbound(internals, ['inst-a', 'inst-b']);
    await deliverTeamMessage();
    expect(reached).toEqual(['inst-a', 'inst-b']);
  });

  it('a different app token gets its own receiver', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    await plugin.connect('inst-a', configFor('inst-a'));
    await plugin.connect('inst-c', configFor('inst-c', 'xapp-other'));

    expect(internals.receivers.size).toBe(2);
  });

  it('disconnecting one of two attached instances leaves the socket open for the other', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    await plugin.connect('inst-a', userConfigFor('inst-a', 'xoxp-ana'));
    await plugin.connect('inst-b', userConfigFor('inst-b', 'xoxp-ben'));

    await plugin.disconnect('inst-a');

    // The receiver survives its non-last detach, still running and still attached.
    expect(internals.receivers.size).toBe(1);
    const receiver = [...internals.receivers.values()][0];
    expect(receiver?.isRunning).toBe(true);
    expect(receiver?.attachments.size).toBe(1);
    expect(internals.attachments.has('inst-a')).toBe(false);

    const reached = recordInbound(internals, ['inst-a', 'inst-b']);
    await deliverTeamMessage();
    expect(reached).toEqual(['inst-b']);
  });

  it('the last disconnect stops the receiver and drops it from the map', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    await plugin.connect('inst-a', userConfigFor('inst-a', 'xoxp-ana'));
    await plugin.connect('inst-b', userConfigFor('inst-b', 'xoxp-ben'));

    await plugin.disconnect('inst-a');
    await plugin.disconnect('inst-b');

    expect(internals.receivers.size).toBe(0);
    expect(internals.attachments.size).toBe(0);
  });

  it('reconnecting an attached instance detaches it first and re-attaches it newer', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    await plugin.connect('inst-a', userConfigFor('inst-a', 'xoxp-ana'));
    await plugin.connect('inst-b', userConfigFor('inst-b', 'xoxp-ben'));
    const firstAttachedAt = internals.attachments.get('inst-a')?.attachedAt ?? 0;

    await plugin.connect('inst-a', userConfigFor('inst-a', 'xoxp-ana'));

    // Detached before the re-attach: still exactly one attachment for inst-a,
    // on the same still-running receiver, and strictly newer than before.
    expect(internals.receivers.size).toBe(1);
    const receiver = [...internals.receivers.values()][0];
    expect(receiver?.attachments.size).toBe(2);
    expect(receiver?.isRunning).toBe(true);
    expect(internals.attachments.get('inst-a')?.attachedAt).toBeGreaterThan(firstAttachedAt);

    const reached = recordInbound(internals, ['inst-a', 'inst-b']);
    await deliverTeamMessage();
    expect(reached).toEqual(['inst-b', 'inst-a']);
  });
});

describe('SlackPlugin.connect — user mode acting-user invariant (#889)', () => {
  function userConfig(instanceId: string, userToken: string): InstanceConfig {
    return {
      instanceId,
      credentials: {},
      options: { botToken: 'xoxb-shared', appToken: APP_TOKEN, authMode: 'user', userToken },
    };
  }

  it('attaches in user mode once the acting user id resolves', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    await plugin.connect('inst-user', userConfig('inst-user', 'xoxp-human'));

    expect(internals.attachments.get('inst-user')?.actingUserId).toBe('U_HUMAN');
    expect(internals.receivers.size).toBe(1);
  });

  it('presents the profile display name rather than the auth.test username', async () => {
    const { plugin } = await makeSharedPlugin();

    await plugin.connect('inst-user', userConfig('inst-user', 'xoxp-display'));

    const profile = await plugin.getProfile('inst-user');
    expect(profile.name).toBe('Display Person');
    expect(profile.ownerIdentifier).toBe('U_DISPLAY');
  });

  it('presents the auth.test username when the client has no profile lookup', async () => {
    const { plugin } = await makeSharedPlugin();

    await plugin.connect('inst-user', userConfig('inst-user', 'xoxp-human'));

    expect((await plugin.getProfile('inst-user')).name).toBe('human');
  });

  it('refuses to attach or start when the acting user id cannot be resolved', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    const err = await plugin.connect('inst-user', userConfig('inst-user', 'xoxp-nouser')).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).channelCode).toBe(SlackErrorCode.CONNECTION_FAILED);
    // Nothing attached, and the receiver this connect created was dropped again
    // rather than left running for an instance that never became valid.
    expect(internals.attachments.has('inst-user')).toBe(false);
    expect(internals.receivers.size).toBe(0);
    expect((await plugin.getStatus('inst-user')).state).toBe('error');
  });

  it('refuses a user token from another workspace than the bot token', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    // The bot token answers for T_SHARED; this person's token for T_OTHER.
    const err = await plugin.connect('inst-dora', userConfig('inst-dora', 'xoxp-dora@T_OTHER')).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).channelCode).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect((err as SlackError).message).toContain('T_OTHER');
    expect(internals.attachments.has('inst-dora')).toBe(false);
    expect(internals.receivers.size).toBe(0);
  });
});

describe('SlackPlugin.connect — bot-less user mode (one-click OAuth)', () => {
  /** What a one-click user-mode install hands the plugin: no bot token at all. */
  function botlessConfig(instanceId: string, userToken: string): InstanceConfig {
    return {
      instanceId,
      credentials: {},
      options: { appToken: APP_TOKEN, authMode: 'user', userToken },
    };
  }

  it('connects on the user token alone, builds no xoxb client and takes the workspace from auth.test', async () => {
    const { plugin, internals } = await makeSharedPlugin();
    webClientTokens.length = 0;

    await plugin.connect('inst-carla', botlessConfig('inst-carla', 'xoxp-carla@T_SHARED'));

    const attachment = internals.attachments.get('inst-carla');
    expect(attachment).toMatchObject({ teamId: 'T_SHARED', actingUserId: 'U_CARLA' });
    expect(attachment?.botToken).toBeUndefined();
    expect(webClientTokens).toContain('xoxp-carla@T_SHARED');
    expect(webClientTokens.filter((token) => token?.startsWith('xoxb-'))).toEqual([]);
    expect((await plugin.getStatus('inst-carla')).state).toBe('connected');
    expect(await plugin.getProfile('inst-carla')).toMatchObject({ name: 'carla', ownerIdentifier: 'U_CARLA' });

    // Its workspace's events reach it when Slack authorizes them for its human.
    const reached = recordInbound(internals, ['inst-carla']);
    await deliverTeamMessage('T_SHARED', ['U_CARLA']);
    expect(reached).toEqual(['inst-carla']);
  });

  it('refuses to connect when the user token names no workspace', async () => {
    const { plugin, internals } = await makeSharedPlugin();

    const err = await plugin.connect('inst-carla', botlessConfig('inst-carla', 'xoxp-carla')).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).channelCode).toBe(SlackErrorCode.CONNECTION_FAILED);
    expect((err as SlackError).message).toContain('team_id');
    expect(internals.attachments.has('inst-carla')).toBe(false);
    expect(internals.receivers.size).toBe(0);
  });

  it('still refuses a bot-mode connect without a bot token', async () => {
    const { plugin } = await makeSharedPlugin();

    const err = await plugin
      .connect('inst-bot', { instanceId: 'inst-bot', credentials: {}, options: { appToken: APP_TOKEN } })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).channelCode).toBe(SlackErrorCode.INVALID_TOKEN);
  });
});
