/**
 * One-click Slack OAuth, end to end (wish: slack-personal-oauth, Group 8).
 *
 * The route tests in `slack-oauth.test.ts` stop at the channel registry: their
 * Slack plugin is a spy that records `connect`. This file goes the rest of the
 * way and drives the REAL `SlackPlugin` — two members of ONE workspace running
 * `start → callback → result` through the real routes, ending attached to the
 * one shared Bolt receiver their installs share.
 *
 * Nothing here opens a socket or a database connection:
 *
 *   * `@slack/bolt` and `@slack/web-api` are replaced with fakes. Neither is a
 *     dependency of this package, so they are resolved from the
 *     `@omni/channel-slack` package directory and mocked by that resolved
 *     path; everything that reaches them is imported afterwards, dynamically,
 *     so both bind to the fakes.
 *   * `globalThis.fetch` answers `oauth.v2.access` and `users.info` for the
 *     duration of each request and throws on anything else.
 *   * the instance service is an in-memory fake, as in the route tests.
 *
 * Success criteria proved here: 2 (a member installs from a link and lands on
 * a connected user-mode instance), 3 (two members of one workspace share one
 * receiver and one app token) and 9 (no token ever reaches a response body, a
 * redirect target or a log line).
 */

import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { PluginContext } from '@omni/channel-sdk';
import { configureLogging, createLogger } from '@omni/core';
import { Hono } from 'hono';
import { SLACK_APP_SETTINGS } from '../../../constants/slack-app';
import { errorHandler } from '../../../middleware/error';
import { webhookIngressRateLimitMiddleware } from '../../../middleware/rate-limit';
import type { AppVariables } from '../../../types';

// ---------------------------------------------------------------------------
// Fake Slack SDKs
//
// `@slack/bolt` and `@slack/web-api` belong to @omni/channel-slack, not to this
// package, so their specifiers do not resolve from this file. Resolving them
// from the channel-slack package directory gives the very paths that package's
// own imports resolve to, which is what the mock registry keys on.
// ---------------------------------------------------------------------------

const CHANNEL_SLACK_DIR = join(import.meta.dir, '../../../../../channel-slack');

/** One fake Bolt `App`: the listeners it was given, so a test can fire one. */
interface FakeAppRecord {
  events: Map<string, ((args: Record<string, unknown>) => Promise<void>)[]>;
  started: number;
}

const constructedApps: FakeAppRecord[] = [];

mock.module(Bun.resolveSync('@slack/bolt', CHANNEL_SLACK_DIR), () => {
  class FakeApp {
    readonly client = { auth: { test: async () => ({ ok: true }) } };
    readonly record: FakeAppRecord;

    constructor(_options: Record<string, unknown>) {
      this.record = { events: new Map(), started: 0 };
      constructedApps.push(this.record);
    }

    error(_handler: unknown): void {}

    event(name: string, ...listeners: ((args: Record<string, unknown>) => Promise<void>)[]): void {
      this.record.events.set(name, [...(this.record.events.get(name) ?? []), ...listeners]);
    }

    message(..._listeners: unknown[]): void {}

    action(_constraints: unknown, ..._listeners: unknown[]): void {}

    view(_constraints: unknown, ..._listeners: unknown[]): void {}

    command(_name: unknown, ..._listeners: unknown[]): void {}

    shortcut(_constraints: unknown, ..._listeners: unknown[]): void {}

    async start(): Promise<void> {
      this.record.started += 1;
    }

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

mock.module(Bun.resolveSync('@slack/web-api', CHANNEL_SLACK_DIR), () => {
  /**
   * `auth.test` is the only call this fake answers: it has no `users`, so the
   * connect path's `users.info` name lookup falls back to the `auth.test`
   * username. A user token answers
   * as the human named in it (`xoxp-ana` → `U_ANA`), so the two personal
   * installs resolve to DISTINCT acting users; anything else answers as the
   * workspace bot of `T_SHARED`.
   */
  class FakeWebClient {
    readonly token: string | undefined;
    readonly auth: { test: () => Promise<Record<string, unknown>> };

    constructor(token?: string, _options?: Record<string, unknown>) {
      this.token = token;
      this.auth = {
        test: async () => {
          if (this.token?.startsWith('xoxp-')) {
            const name = this.token.slice('xoxp-'.length);
            return { ok: true, user_id: `U_${name.toUpperCase()}`, user: name };
          }
          return { ok: true, user_id: 'U0BOT', bot_id: 'B0BOT', user: 'omni', team_id: TEAM_ID, team: 'Acme' };
        },
      };
    }
  }

  return { WebClient: FakeWebClient };
});

// Imported AFTER the mocks: the routes pull in @omni/channel-slack, which
// builds a Bolt App and a WebClient the moment an instance connects.
const { slackOAuthCallback, slackRoutes } = await import('../slack');
const { SlackPlugin } = await import('@omni/channel-slack');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = '1234567890.1234567890';
const CLIENT_SECRET = 'client-secret-under-test';
const SIGNING_SECRET = 'signing-secret-under-test';
const APP_TOKEN = 'xapp-1-app-level-token';
const PUBLIC_URL = 'https://omni.example.com';
const BOT_TOKEN = 'xoxb-workspace-bot-token';
const TEAM_ID = 'T_SHARED';

/** The two members of the one workspace this file is about. */
const MEMBERS = {
  ana: { userId: 'U_ANA', userToken: 'xoxp-ana', displayName: 'Ana' },
  ben: { userId: 'U_BEN', userToken: 'xoxp-ben', displayName: 'Ben' },
} as const;

const SETTINGS: Record<string, string> = {
  [SLACK_APP_SETTINGS.clientId.key]: CLIENT_ID,
  [SLACK_APP_SETTINGS.clientSecret.key]: CLIENT_SECRET,
  [SLACK_APP_SETTINGS.signingSecret.key]: SIGNING_SECRET,
  [SLACK_APP_SETTINGS.appToken.key]: APP_TOKEN,
  [SLACK_APP_SETTINGS.publicUrl.key]: PUBLIC_URL,
};
const SETTING_ENVS = Object.values(SLACK_APP_SETTINGS).map((setting) => setting.env);

interface FakeRow extends Record<string, unknown> {
  id: string;
  name: string;
  channel: string;
  profileMetadata: Record<string, unknown> | null;
}

let rowCounter = 0;
const nextId = (): string => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++rowCounter).padStart(12, '0')}`;

/** Slack's `oauth.v2.access` answer for the member whose code was exchanged. */
function accessResponse(member: (typeof MEMBERS)[keyof typeof MEMBERS]) {
  return {
    ok: true,
    app_id: 'A0123456789',
    access_token: BOT_TOKEN,
    token_type: 'bot',
    scope: 'chat:write,users:read',
    bot_user_id: 'U0BOT',
    team: { id: TEAM_ID, name: 'Acme' },
    enterprise: null,
    is_enterprise_install: false,
    authed_user: { id: member.userId, scope: 'search:read', access_token: member.userToken, token_type: 'user' },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type PluginInstance = InstanceType<typeof SlackPlugin>;

interface PluginInternals {
  attachments: Map<string, { instanceId: string; teamId: string }>;
  receivers: Map<string, unknown>;
}

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

async function makeHarness() {
  const rows: FakeRow[] = [];
  const published: PublishedEvent[] = [];
  /** Every response body and Location header produced while a request ran. */
  const captured: string[] = [];

  const settings = {
    getString: async (key: string, env?: string) => SETTINGS[key] ?? (env ? process.env[env] : undefined),
    getSecret: async (key: string, env?: string) => SETTINGS[key] ?? (env ? process.env[env] : undefined),
  };

  const instances = {
    list: async (options: { channel?: string[] } = {}) => ({
      items: rows.filter((row) => !options.channel || options.channel.includes(row.channel)),
      hasMore: false,
    }),
    create: async (data: Record<string, unknown>) => {
      const row = { profileMetadata: null, ...data, id: nextId() } as FakeRow;
      rows.push(row);
      return row;
    },
    update: async (id: string, data: Record<string, unknown>) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`no row ${id}`);
      Object.assign(row, data);
      return row;
    },
  };

  // The REAL logger at debug, so the plugin's own lines are produced and land
  // in `captured` through the stdout/stderr tap below. A no-op logger would
  // make the "no token in any log line" assertion vacuous for the one place
  // that actually holds the tokens.
  const logger = createLogger('channel-slack');

  const plugin: PluginInstance = new SlackPlugin();
  await plugin.initialize({
    eventBus: {
      publish: async (type: string, payload: Record<string, unknown>) => {
        published.push({ type, payload });
      },
      subscribe: () => {},
    },
    storage: {},
    logger,
    config: {},
    db: {},
  } as unknown as PluginContext);

  const channelRegistry = { get: (channel: string) => (channel === 'slack' ? plugin : undefined) };

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', { instances, settings } as never);
    c.set('channelRegistry', channelRegistry as never);
    c.set('db', { transaction: async () => undefined } as never);
    c.set('apiKey', { id: 'k', name: 'k', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/api/v2/slack', slackRoutes);
  app.get('/api/v2/slack/oauth/callback', webhookIngressRateLimitMiddleware, slackOAuthCallback);

  /** Whose code is being exchanged right now; the fetch stub answers for them. */
  let exchanging: (typeof MEMBERS)[keyof typeof MEMBERS] = MEMBERS.ana;

  const fetchStub = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://slack.com/api/oauth.v2.access')) return Response.json(accessResponse(exchanging));
    if (url.startsWith('https://slack.com/api/users.info')) {
      return Response.json({
        ok: true,
        user: {
          id: exchanging.userId,
          name: exchanging.displayName,
          profile: { display_name: exchanging.displayName },
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  /**
   * Run `body` with every stdout/stderr write appended to `captured` — that is
   * where the logger writes, so this is what makes the plugin's own log lines
   * part of the leak scan.
   */
  async function capturingLogs<T>(body: () => Promise<T>): Promise<T> {
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    const tap =
      (original: (chunk: string | Uint8Array) => boolean) =>
      (chunk: string | Uint8Array): boolean => {
        captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return original(chunk);
      };
    process.stdout.write = tap(originalOut) as typeof process.stdout.write;
    process.stderr.write = tap(originalErr) as typeof process.stderr.write;
    try {
      return await body();
    } finally {
      process.stdout.write = originalOut as typeof process.stdout.write;
      process.stderr.write = originalErr as typeof process.stderr.write;
    }
  }

  async function request(path: string, init?: RequestInit): Promise<{ res: Response; text: string }> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    try {
      const res = await capturingLogs(async () => app.request(path, init));
      const text = await res.text();
      captured.push(text);
      const location = res.headers.get('location');
      if (location) captured.push(location);
      return { res, text };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  /** `start → callback → result` for one member, all three through the real routes. */
  async function install(
    member: (typeof MEMBERS)[keyof typeof MEMBERS],
    entry: 'ui' | 'cli',
    returnTo?: string,
  ): Promise<{ callbackRes: Response; result: Record<string, unknown> }> {
    exchanging = member;

    const started = await request('/api/v2/slack/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'user', entry, ...(returnTo ? { returnTo } : {}) }),
    });
    expect(started.res.status).toBe(200);
    const { authorizeUrl, nonce } = JSON.parse(started.text) as { authorizeUrl: string; nonce: string };

    const state = new URL(authorizeUrl).searchParams.get('state');
    expect(state).toBeTruthy();
    const callback = await request(
      `/api/v2/slack/oauth/callback?${new URLSearchParams({ code: `code-${member.userId}`, state: state as string })}`,
    );

    const outcome = await request(`/api/v2/slack/oauth/result/${nonce}`);
    return { callbackRes: callback.res, result: JSON.parse(outcome.text) as Record<string, unknown> };
  }

  const internals = plugin as unknown as PluginInternals;

  return { plugin, internals, install, rows, published, captured, capturingLogs };
}

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  // Debug + json: the install is driven with the plugin logging for real, so
  // the token scan at the end has something to scan.
  configureLogging({ level: 'debug', format: 'json' });
  for (const env of SETTING_ENVS) {
    savedEnv[env] = process.env[env];
    delete process.env[env];
  }
});

afterAll(() => {
  configureLogging({ level: 'silent' });
  for (const env of SETTING_ENVS) {
    if (savedEnv[env] === undefined) delete process.env[env];
    else process.env[env] = savedEnv[env];
  }
});

afterEach(() => {
  constructedApps.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Slack one-click OAuth, end to end', () => {
  test('two members of one workspace install, share one receiver, and a revocation costs only one of them', async () => {
    const harness = await makeHarness();

    // ── Member one: the dashboard entry, which ends in a redirect ──────────
    const ana = await harness.install(MEMBERS.ana, 'ui', '/instances');
    expect(ana.callbackRes.status).toBe(302);
    const location = ana.callbackRes.headers.get('location');
    expect(location?.startsWith('/instances?slack=')).toBe(true);
    expect(ana.result.status).toBe('done');

    // ── Member two: the CLI entry, which ends on a fixed page ─────────────
    const ben = await harness.install(MEMBERS.ben, 'cli');
    expect(ben.callbackRes.status).toBe(200);
    expect(ben.callbackRes.headers.get('content-type')).toContain('text/html');
    expect(ben.result.status).toBe('done');

    // ── Two instances, both user mode, both installed through OAuth ───────
    expect(harness.rows).toHaveLength(2);
    const anaRow = harness.rows.find((row) => row.slackUserId === MEMBERS.ana.userId);
    const benRow = harness.rows.find((row) => row.slackUserId === MEMBERS.ben.userId);
    expect(anaRow?.id).toBe(ana.result.instanceId as string);
    expect(benRow?.id).toBe(ben.result.instanceId as string);
    for (const row of harness.rows) {
      expect(row.channel).toBe('slack');
      expect(row.slackAuthMode).toBe('user');
      expect(row.slackConnectionMethod).toBe('oauth');
      expect(row.slackTeamId).toBe(TEAM_ID);
      expect(row.slackAppToken).toBe(APP_TOKEN);
    }

    // ── One workspace, one app token, ONE Bolt App for both members ───────
    expect(constructedApps).toHaveLength(1);
    expect(constructedApps[0]?.started).toBe(1);
    expect(harness.internals.receivers.size).toBe(1);
    expect([...harness.internals.attachments.keys()].sort()).toEqual([anaRow?.id, benRow?.id].sort() as string[]);

    const connected = harness.published.filter((event) => event.type === 'instance.connected');
    expect(connected.map((event) => event.payload.instanceId).sort()).toEqual(
      [anaRow?.id, benRow?.id].sort() as string[],
    );
    expect(connected.map((event) => event.payload.actingUserId).sort()).toEqual([
      MEMBERS.ana.userId,
      MEMBERS.ben.userId,
    ]);

    // ── One member's token is revoked: only that instance goes down ───────
    const revocation = constructedApps[0]?.events.get('tokens_revoked')?.[0];
    expect(revocation).toBeDefined();
    await harness.capturingLogs(async () => {
      await revocation?.({
        body: { team_id: TEAM_ID },
        event: { type: 'tokens_revoked', tokens: { oauth: [MEMBERS.ana.userId] } },
      });
    });

    const disconnected = harness.published.filter((event) => event.type === 'instance.disconnected');
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]?.payload.instanceId).toBe(anaRow?.id as string);
    expect(disconnected[0]?.payload.reason).toBe('token_revoked');

    // Ben keeps his install: the receiver still carries exactly his attachment.
    expect([...harness.internals.attachments.keys()]).toEqual([benRow?.id as string]);
    expect((await harness.plugin.getStatus(benRow?.id as string)).state).toBe('connected');
    expect((await harness.plugin.getStatus(anaRow?.id as string)).state).toBe('disconnected');

    await harness.capturingLogs(async () => {
      await harness.plugin.disconnect(benRow?.id as string);
    });

    // ── Success criterion 9: no secret in any response body, redirect target
    // or LOG LINE — the plugin logged at debug for the whole install above.
    //
    // Positive control first: the scan saw the real plugin's own lines, so an
    // empty leak list means "checked", not "nothing captured".
    const scanned = harness.captured.join('\n');
    expect(scanned).toContain('"module":"channel-slack"');
    expect(scanned).toContain('slack=');

    const secrets: Record<string, string> = {
      'bot token': BOT_TOKEN,
      'app-level token': APP_TOKEN,
      'client secret': CLIENT_SECRET,
      'signing secret': SIGNING_SECRET,
      "ana's user token": MEMBERS.ana.userToken,
      "ben's user token": MEMBERS.ben.userToken,
    };
    for (const [name, secret] of Object.entries(secrets)) {
      const leaked = harness.captured.filter((text) => text.includes(secret));
      expect(leaked, `${name} leaked`).toEqual([]);
    }
    // Token shapes and sealed-credential envelopes, whether or not they match
    // a fixture: nothing of this shape may appear at all.
    for (const shape of ['xox', 'xapp', 'SC:v1:']) {
      expect(harness.captured.filter((text) => text.includes(shape))).toEqual([]);
    }
  });
});
