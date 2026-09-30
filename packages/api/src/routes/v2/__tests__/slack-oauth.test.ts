/**
 * Slack one-click OAuth install (wish: slack-personal-oauth, Group 4).
 *
 * The Slack routes and the public callback handler are mounted on a bare Hono
 * app with in-memory fakes: a settings reader, a stateful instance service
 * (create/update/list, no database), a channel registry whose Slack plugin
 * records `connect` calls, and `globalThis.fetch` stubbed for the two Slack
 * Web API calls. Nothing here reaches the network.
 *
 * Every response body, every Location header and every log line written
 * while a request runs is captured; at the end no `xox` token shape may
 * appear in any of them.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { configureLogging } from '@omni/core';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { SLACK_APP_SETTINGS } from '../../../constants/slack-app';
import { signState, verifyState } from '../../../lib/slack-oauth';
import { errorHandler } from '../../../middleware/error';
import { webhookIngressRateLimitMiddleware } from '../../../middleware/rate-limit';
import { isAllowedReturnTo } from '../../../services/slack-oauth';
import type { TenantAuthContext } from '../../../tenancy/auth-context';
import { currentTenantScope, runInTenantScope } from '../../../tenancy/tenant-scope';
import { buildWorkerTenantContext } from '../../../tenancy/worker-tenant-context';
import type { AppVariables } from '../../../types';
import { slackOAuthCallback, slackRoutes } from '../slack';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = '1234567890.1234567890';
const CLIENT_SECRET = 'client-secret-under-test';
const SIGNING_SECRET = 'signing-secret-under-test';
const APP_TOKEN = 'xapp-1-app-level-token';
const PUBLIC_URL = 'https://omni.example.com';
const REDIRECT_URL = `${PUBLIC_URL}/api/v2/slack/oauth/callback`;
const BOT_TOKEN = 'xoxb-workspace-bot-token';
const USER_TOKEN = 'xoxp-personal-user-token';
const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

const ALL_SETTINGS: Record<string, string> = {
  [SLACK_APP_SETTINGS.clientId.key]: CLIENT_ID,
  [SLACK_APP_SETTINGS.clientSecret.key]: CLIENT_SECRET,
  [SLACK_APP_SETTINGS.signingSecret.key]: SIGNING_SECRET,
  [SLACK_APP_SETTINGS.appToken.key]: APP_TOKEN,
  [SLACK_APP_SETTINGS.publicUrl.key]: PUBLIC_URL,
};
const ALL_KEYS = Object.values(SLACK_APP_SETTINGS).map((s) => s.key);
const ALL_ENVS = Object.values(SLACK_APP_SETTINGS).map((s) => s.env);

/** Slack's answer to a user-mode authorize: the person's token and no bot, since no bot scope was asked for. */
function accessResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    app_id: 'A0123456789',
    team: { id: 'T0123456789', name: 'Acme' },
    enterprise: null,
    is_enterprise_install: false,
    authed_user: { id: 'U0123456789', scope: 'search:read', access_token: USER_TOKEN, token_type: 'user' },
    ...overrides,
  };
}

/** Slack's answer to a bot-mode authorize: the workspace bot token, and no user token. */
function botAccessResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    app_id: 'A0123456789',
    access_token: BOT_TOKEN,
    token_type: 'bot',
    scope: 'chat:write,users:read',
    bot_user_id: 'UBOT0000001',
    team: { id: 'T0123456789', name: 'Acme' },
    enterprise: null,
    is_enterprise_install: false,
    authed_user: { id: 'U0123456789' },
    ...overrides,
  };
}

interface FakeRow extends Record<string, unknown> {
  id: string;
  name: string;
  channel: string;
  isActive: boolean;
  profileMetadata: Record<string, unknown> | null;
}

interface HarnessOptions {
  settings?: Record<string, string | undefined>;
  tenant?: TenantAuthContext;
  /**
   * Tenant the three Slack SECRETS are sealed under, as a tenant-scoped
   * `PUT /settings` seals them: `getSecret` then answers only inside that
   * tenant's scope and reads as unset everywhere else (fail closed), which is
   * exactly what `openCredentialField(null, sealed)` does in production. The
   * two identifiers stay in the clear, as their registry entries say.
   */
  sealedUnder?: string;
  slackResponses?: { access?: () => unknown; usersInfo?: () => unknown };
  connect?: () => Promise<void>;
  createThrows?: (attempt: number) => Error | undefined;
}

/** The fake of `InstanceService.findBySlackIdentity`: OAuth rows only, NULL user = bot identity. */
function findIdentity(rows: FakeRow[], teamId: string, userId: string | null): FakeRow | undefined {
  return rows.find(
    (r) =>
      r.slackConnectionMethod === 'oauth' &&
      r.slackTeamId === teamId &&
      (userId === null ? r.slackUserId == null : r.slackUserId === userId),
  );
}

let rowCounter = 0;
const nextId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++rowCounter).padStart(12, '0')}`;

function makeHarness(opts: HarnessOptions = {}) {
  const settingsValues = opts.settings ?? ALL_SETTINGS;
  const sealOpens = () => opts.sealedUnder === undefined || currentTenantScope()?.tenantId === opts.sealedUnder;
  const settings = {
    getString: mock(async (key: string, env?: string) => settingsValues[key] ?? (env ? process.env[env] : undefined)),
    getSecret: mock(async (key: string, env?: string) =>
      sealOpens() ? (settingsValues[key] ?? (env ? process.env[env] : undefined)) : undefined,
    ),
  };

  const rows: FakeRow[] = [];
  const calls = { create: 0, update: 0, connect: 0, transactions: 0 };
  const connectOptions: Record<string, unknown>[] = [];
  let createAttempts = 0;

  const instances = {
    findBySlackIdentity: mock(async (teamId: string, userId: string | null) => findIdentity(rows, teamId, userId)),
    // ON CONFLICT DO NOTHING on the identity index: null when the identity is taken.
    createSlackOAuth: mock(async (data: Record<string, unknown>) => {
      createAttempts += 1;
      const failure = opts.createThrows?.(createAttempts);
      if (failure) throw failure;
      if (findIdentity(rows, data.slackTeamId as string, (data.slackUserId as string | null) ?? null)) return null;
      calls.create += 1;
      const row = { profileMetadata: null, isActive: true, ...data, id: nextId() } as FakeRow;
      rows.push(row);
      return row;
    }),
    update: mock(async (id: string, data: Record<string, unknown>) => {
      calls.update += 1;
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`no row ${id}`);
      Object.assign(row, data);
      return row;
    }),
  };

  const plugin = {
    id: 'slack',
    connect: mock(async (_instanceId: string, config: { options: Record<string, unknown> }) => {
      calls.connect += 1;
      connectOptions.push(config.options);
      if (opts.connect) await opts.connect();
    }),
  };
  const channelRegistry = { get: mock((channel: string) => (channel === 'slack' ? plugin : undefined)) };

  // Minimal Drizzle transaction surface for runInTenantScope.
  const db = {
    transaction: mock(async (fn: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>) => {
      calls.transactions += 1;
      return fn({ execute: async () => [] });
    }),
  };

  /** Slack grants what the authorize asked for, so the default answer follows the last flow's mode. */
  let requestedMode: 'user' | 'bot' = 'user';
  const defaultGrant = () => (requestedMode === 'bot' ? botAccessResponse() : accessResponse());

  const fetchCalls: { url: string; init?: RequestInit }[] = [];
  const fetchStub = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    fetchCalls.push({ url, init });
    if (url.startsWith('https://slack.com/api/oauth.v2.access')) {
      return Response.json(opts.slackResponses?.access ? opts.slackResponses.access() : defaultGrant());
    }
    if (url.startsWith('https://slack.com/api/users.info')) {
      return Response.json(
        opts.slackResponses?.usersInfo
          ? opts.slackResponses.usersInfo()
          : { ok: true, user: { id: 'U0123456789', name: 'jane', profile: { display_name: 'Jane Doe' } } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', { instances, settings } as never);
    c.set('channelRegistry', channelRegistry as never);
    c.set('db', db as never);
    c.set('apiKey', { id: 'k', name: 'k', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    if (opts.tenant) c.set('authContext', opts.tenant);
    await next();
  });
  app.route('/slack', slackRoutes);
  app.get('/api/v2/slack/oauth/callback', webhookIngressRateLimitMiddleware, slackOAuthCallback);

  /** Every body, Location header and log line produced while requests ran. */
  const captured: string[] = [];

  async function request(path: string, init?: RequestInit): Promise<{ res: Response; text: string }> {
    const originalFetch = globalThis.fetch;
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    const tap =
      (original: (chunk: string | Uint8Array) => boolean) =>
      (chunk: string | Uint8Array): boolean => {
        captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return original(chunk);
      };
    process.stdout.write = tap(originalOut) as typeof process.stdout.write;
    process.stderr.write = tap(originalErr) as typeof process.stderr.write;
    try {
      const res = await app.request(path, init);
      const text = await res.text();
      captured.push(text);
      const location = res.headers.get('location');
      if (location) captured.push(location);
      return { res, text };
    } finally {
      globalThis.fetch = originalFetch;
      process.stdout.write = originalOut as typeof process.stdout.write;
      process.stderr.write = originalErr as typeof process.stderr.write;
    }
  }

  async function start(body: Record<string, unknown> = { entry: 'ui', returnTo: '/instances' }) {
    requestedMode = body.mode === 'bot' ? 'bot' : 'user';
    const { res, text } = await request('/slack/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, body: JSON.parse(text) as { authorizeUrl: string; nonce: string; expiresAt: string } };
  }

  function stateOf(authorizeUrl: string): string {
    const state = new URL(authorizeUrl).searchParams.get('state');
    if (!state) throw new Error('no state in authorize url');
    return state;
  }

  async function callback(query: Record<string, string>) {
    const params = new URLSearchParams(query);
    return request(`/api/v2/slack/oauth/callback?${params.toString()}`);
  }

  async function result(nonce: string) {
    const { res, text } = await request(`/slack/oauth/result/${nonce}`);
    return { res, body: JSON.parse(text) as Record<string, unknown> };
  }

  return { request, start, stateOf, callback, result, rows, calls, connectOptions, fetchCalls, captured, db };
}

/** Full happy path up to and including the callback; returns everything a test needs. */
async function install(harness: ReturnType<typeof makeHarness>, startBody?: Record<string, unknown>) {
  const started = await harness.start(startBody);
  expect(started.res.status).toBe(200);
  const state = harness.stateOf(started.body.authorizeUrl);
  const cb = await harness.callback({ code: 'code-123', state });
  return { ...started, state, cb };
}

const allCaptured: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  configureLogging({ level: 'debug', format: 'json' });
});

afterAll(() => {
  configureLogging({ level: 'silent' });
});

beforeEach(() => {
  for (const env of ALL_ENVS) {
    savedEnv[env] = process.env[env];
    delete process.env[env];
  }
});

afterEach(() => {
  setSystemTime();
  for (const env of ALL_ENVS) {
    if (savedEnv[env] === undefined) delete process.env[env];
    else process.env[env] = savedEnv[env];
  }
});

function harness(opts?: HarnessOptions) {
  const h = makeHarness(opts);
  const captured = h.captured;
  // Push into the file-wide list lazily: afterAll reads it.
  const push = captured.push.bind(captured);
  captured.push = (...items: string[]) => {
    allCaptured.push(...items);
    return push(...items);
  };
  return h;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

describe('signState / verifyState', () => {
  const nonce = 'slackoauth_0f4c2c1e-6a0d-4d7f-9f7e-2b1c3d4e5f60';

  test('round-trips a nonce under the same client secret', () => {
    const state = signState(nonce, CLIENT_SECRET);
    expect(state.startsWith(`${nonce}.`)).toBe(true);
    expect(state.split('.')[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyState(state, CLIENT_SECRET)).toBe(nonce);
  });

  test('rejects a tampered nonce, a tampered signature, another secret and malformed input', () => {
    const state = signState(nonce, CLIENT_SECRET);
    const [n, sig] = state.split('.') as [string, string];
    const flipped = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;

    expect(verifyState(`${n.slice(0, -1)}x.${sig}`, CLIENT_SECRET)).toBeNull();
    expect(verifyState(`${n}.${flipped}`, CLIENT_SECRET)).toBeNull();
    expect(verifyState(state, 'another-secret')).toBeNull();
    expect(verifyState(n, CLIENT_SECRET)).toBeNull();
    expect(verifyState(`${n}.`, CLIENT_SECRET)).toBeNull();
    expect(verifyState('', CLIENT_SECRET)).toBeNull();
  });

  test('refuses to sign something that is not a store handle', () => {
    expect(() => signState('has spaces', CLIENT_SECRET)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// returnTo allowlist
// ---------------------------------------------------------------------------

describe('isAllowedReturnTo', () => {
  test('accepts a single-slash path and a same-origin absolute URL only', () => {
    expect(isAllowedReturnTo('/instances', PUBLIC_URL)).toBe(true);
    expect(isAllowedReturnTo('/', PUBLIC_URL)).toBe(true);
    expect(isAllowedReturnTo(`${PUBLIC_URL}/instances`, PUBLIC_URL)).toBe(true);

    expect(isAllowedReturnTo('//evil.example/x', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('/\\evil.example/x', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('https://evil.example/instances', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('https://omni.example.com.evil.example/x', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('https://omni.example.com:8443/x', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('http://omni.example.com/x', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('instances', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('/instances?tab=1', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('/instances#x', PUBLIC_URL)).toBe(false);
    expect(isAllowedReturnTo('javascript:alert(1)', PUBLIC_URL)).toBe(false);
  });

  test('refuses every absolute URL when server.public_url is unset', () => {
    expect(isAllowedReturnTo(`${PUBLIC_URL}/instances`, null)).toBe(false);
    expect(isAllowedReturnTo('/instances', null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /slack/app + POST /slack/oauth/start
// ---------------------------------------------------------------------------

describe('GET /slack/app', () => {
  test('reports configured with the derived redirect and a manifest link carrying it', async () => {
    const h = harness();
    const { res, text } = await h.request('/slack/app');
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(body).toEqual({ configured: true, missing: [], redirectUrl: REDIRECT_URL, manifestUrl: expect.any(String) });
    const manifestJson = new URL(body.manifestUrl).searchParams.get('manifest_json');
    expect(new URL(body.manifestUrl).origin).toBe('https://api.slack.com');
    const manifest = JSON.parse(manifestJson ?? '{}');
    expect(manifest.oauth_config.redirect_urls).toEqual([REDIRECT_URL]);
    expect(manifest.oauth_config.scopes.user).toBeDefined();
  });

  test('names every missing key and withholds the URLs without a public URL', async () => {
    const h = harness({ settings: {} });
    const { text } = await h.request('/slack/app');
    expect(JSON.parse(text)).toEqual({ configured: false, missing: ALL_KEYS, redirectUrl: null, manifestUrl: null });
  });

  test('reports an http public URL as unset, because Slack refuses a non-HTTPS redirect', async () => {
    const h = harness({ settings: { ...ALL_SETTINGS, [SLACK_APP_SETTINGS.publicUrl.key]: 'http://localhost:8882' } });
    const { text } = await h.request('/slack/app');
    const body = JSON.parse(text);

    expect(body.configured).toBe(false);
    expect(body.missing).toEqual([SLACK_APP_SETTINGS.publicUrl.key]);
    expect(body.redirectUrl).toBeNull();
    expect(body.manifestUrl).toBeNull();

    // And the install cannot start against a URI Slack would reject.
    const { res } = await h.start();
    expect(res.status).toBe(409);
  });

  test('offers the manifest link as soon as the public URL is set', async () => {
    const h = harness({ settings: { [SLACK_APP_SETTINGS.publicUrl.key]: `${PUBLIC_URL}/` } });
    const body = JSON.parse((await h.request('/slack/app')).text);
    expect(body.configured).toBe(false);
    expect(body.missing).not.toContain(SLACK_APP_SETTINGS.publicUrl.key);
    expect(body.redirectUrl).toBe(REDIRECT_URL);
    expect(body.manifestUrl).toContain('manifest_json=');
  });
});

describe('POST /slack/oauth/start', () => {
  test('returns SLACK_APP_NOT_CONFIGURED naming every missing key', async () => {
    const h = harness({ settings: {} });
    const { res, body } = await h.start();
    expect(res.status).toBe(409);
    const error = (body as unknown as { error: { code: string; details: { missing: string[] } } }).error;
    expect(error.code).toBe('SLACK_APP_NOT_CONFIGURED');
    expect(error.details.missing).toEqual(ALL_KEYS);
  });

  test('names only the keys that are missing', async () => {
    const { [SLACK_APP_SETTINGS.publicUrl.key]: _dropped, ...withoutPublicUrl } = ALL_SETTINGS;
    const h = harness({ settings: withoutPublicUrl });
    const { res, body } = await h.start();
    expect(res.status).toBe(409);
    expect((body as unknown as { error: { details: { missing: string[] } } }).error.details.missing).toEqual([
      SLACK_APP_SETTINGS.publicUrl.key,
    ]);
  });

  test('with settings from the env fallback returns a user-mode authorize URL with user_scope and no bot scope, redirect_uri and a signed state', async () => {
    for (const s of Object.values(SLACK_APP_SETTINGS)) process.env[s.env] = ALL_SETTINGS[s.key];
    const h = harness({ settings: {} });
    const { res, body } = await h.start();

    expect(res.status).toBe(200);
    const url = new URL(body.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    // No bot scope: a personal install must not add the app's bot user to the workspace.
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('user_scope')).toContain('search:read');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URL);
    expect(verifyState(url.searchParams.get('state') ?? '', CLIENT_SECRET)).toBe(body.nonce);
    expect(body.nonce.startsWith('slackoauth_')).toBe(true);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  test('bot mode requests the bot scopes and no user_scope', async () => {
    const h = harness();
    const { body } = await h.start({ entry: 'cli', mode: 'bot' });
    const url = new URL(body.authorizeUrl);
    expect(url.searchParams.get('scope')).toContain('chat:write');
    expect(url.searchParams.has('user_scope')).toBe(false);
  });

  test('rejects a returnTo outside the allowlist and an invalid entry', async () => {
    const h = harness();
    for (const returnTo of ['//evil.example', 'https://evil.example/x', '/instances?x=1']) {
      const { res } = await h.start({ entry: 'ui', returnTo });
      expect(res.status).toBe(400);
    }
    const { res } = await h.start({ entry: 'browser' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

describe('GET /api/v2/slack/oauth/callback', () => {
  test('happy path: a user-only grant creates and connects a bot-less instance and redirects with exactly slack=<nonce>', async () => {
    const h = harness();
    const { body, cb } = await install(h);

    expect(cb.res.status).toBe(302);
    const location = cb.res.headers.get('location') ?? '';
    expect(location.startsWith('/instances?')).toBe(true);
    expect(new URL(location, 'http://placeholder').search).toBe(`?slack=${body.nonce}`);
    expect(cb.res.headers.get('cache-control')).toBe('no-store');

    // Exchange, then users.info, each stubbed — and nothing else.
    expect(h.fetchCalls.map((f) => new URL(f.url).pathname)).toEqual(['/api/oauth.v2.access', '/api/users.info']);
    const exchange = h.fetchCalls[0];
    expect(exchange?.init?.method).toBe('POST');
    const form = new URLSearchParams(String(exchange?.init?.body));
    expect(form.get('code')).toBe('code-123');
    expect(form.get('redirect_uri')).toBe(REDIRECT_URL);
    expect(form.get('client_id')).toBe(CLIENT_ID);
    // The name lookup runs on the person's own token: there is no other.
    expect(new Headers(h.fetchCalls[1]?.init?.headers).get('authorization')).toBe(`Bearer ${USER_TOKEN}`);

    expect(h.calls).toEqual({ create: 1, update: 0, connect: 1, transactions: 0 });
    const row = h.rows[0];
    expect(row).toMatchObject({
      channel: 'slack',
      name: 'Slack · Jane Doe @ Acme',
      slackTeamId: 'T0123456789',
      slackUserId: 'U0123456789',
      slackAuthMode: 'user',
      slackConnectionMethod: 'oauth',
      slackBotToken: null,
      slackUserToken: USER_TOKEN,
      slackAppToken: APP_TOKEN,
      slackSigningSecret: SIGNING_SECRET,
      isActive: true,
    });

    // The same options POST /instances/:id/connect hands the plugin — with no
    // bot token among them.
    expect(h.connectOptions[0]).toMatchObject({
      userToken: USER_TOKEN,
      authMode: 'user',
      appToken: APP_TOKEN,
      signingSecret: SIGNING_SECRET,
      forceNewQr: false,
    });
    expect(h.connectOptions[0]).not.toHaveProperty('token');
    expect(h.connectOptions[0]).not.toHaveProperty('botToken');

    // The outcome is read once through the authenticated result endpoint.
    const first = await h.result(body.nonce);
    expect(first.body).toEqual({ status: 'done', instanceId: row?.id });
    const second = await h.result(body.nonce);
    expect(second.body).toEqual({ status: 'pending' });
  });

  test('result is pending before the callback and the poll does not consume the flow', async () => {
    const h = harness();
    const started = await h.start();
    expect((await h.result(started.body.nonce)).body).toEqual({ status: 'pending' });

    const cb = await h.callback({ code: 'code-123', state: h.stateOf(started.body.authorizeUrl) });
    expect(cb.res.status).toBe(302);
    expect((await h.result(started.body.nonce)).body.status).toBe('done');
  });

  test('result for an unknown or malformed nonce is pending / 400 and reveals nothing', async () => {
    const h = harness();
    expect((await h.result('slackoauth_never-issued')).body).toEqual({ status: 'pending' });
    const { res } = await h.request('/slack/oauth/result/not%20a%20handle');
    expect(res.status).toBe(400);
  });

  test('a replayed callback is refused with 400 and keeps the parked outcome', async () => {
    const h = harness();
    const { body, state } = await install(h);
    const fetches = h.fetchCalls.length;

    const replay = await h.callback({ code: 'code-456', state });
    expect(replay.res.status).toBe(400);
    expect(replay.res.headers.get('content-type')).toContain('text/html');
    expect(h.fetchCalls.length).toBe(fetches);
    expect(h.calls.create).toBe(1);
    expect(h.calls.connect).toBe(1);

    expect((await h.result(body.nonce)).body.status).toBe('done');
  });

  test('tampered, expired, unknown and missing state give 400 with no Slack call and no row', async () => {
    const h = harness();
    const started = await h.start();
    const state = h.stateOf(started.body.authorizeUrl);
    const [nonce, sig] = state.split('.') as [string, string];

    const tampered = await h.callback({ code: 'c', state: `${nonce}.${sig.slice(0, -2)}00` });
    expect(tampered.res.status).toBe(400);

    const foreign = await h.callback({ code: 'c', state: `${nonce.slice(0, -1)}z.${sig}` });
    expect(foreign.res.status).toBe(400);

    const unknown = await h.callback({
      code: 'c',
      state: signState('slackoauth_11111111-2222-4333-8444-555555555555', CLIENT_SECRET),
    });
    expect(unknown.res.status).toBe(400);

    const missing = await h.callback({ code: 'c' });
    expect(missing.res.status).toBe(400);

    setSystemTime(new Date(Date.now() + 5 * 60 * 1000 + 1));
    const expired = await h.callback({ code: 'c', state });
    expect(expired.res.status).toBe(400);
    setSystemTime();

    // The real state was consumed by the expiry check: a fresh flow still works.
    expect(h.fetchCalls).toEqual([]);
    expect(h.rows).toEqual([]);
    expect(h.calls).toEqual({ create: 0, update: 0, connect: 0, transactions: 0 });
  });

  test('error=access_denied parks an error outcome and redirects with only slack=<nonce>', async () => {
    const h = harness();
    const started = await h.start();
    const cb = await h.callback({ error: 'access_denied', state: h.stateOf(started.body.authorizeUrl) });

    expect(cb.res.status).toBe(302);
    expect(new URL(cb.res.headers.get('location') ?? '', 'http://placeholder').search).toBe(
      `?slack=${started.body.nonce}`,
    );
    expect(h.fetchCalls).toEqual([]);
    expect(h.rows).toEqual([]);

    const outcome = await h.result(started.body.nonce);
    expect(outcome.body).toMatchObject({ status: 'error', code: 'SLACK_ACCESS_DENIED' });
  });

  test('an Enterprise Grid install is rejected with the same redirect shape and no row', async () => {
    const h = harness({
      slackResponses: {
        access: () => accessResponse({ is_enterprise_install: true, enterprise: { id: 'E01', name: 'Org' } }),
      },
    });
    const { body, cb } = await install(h);

    expect(cb.res.status).toBe(302);
    expect(new URL(cb.res.headers.get('location') ?? '', 'http://placeholder').search).toBe(`?slack=${body.nonce}`);
    expect(h.rows).toEqual([]);
    expect(h.calls.connect).toBe(0);
    expect((await h.result(body.nonce)).body).toMatchObject({
      status: 'error',
      code: 'SLACK_ENTERPRISE_INSTALL_UNSUPPORTED',
    });
  });

  test('a refused exchange parks SLACK_OAUTH_EXCHANGE_FAILED without a row', async () => {
    const h = harness({ slackResponses: { access: () => ({ ok: false, error: 'invalid_code' }) } });
    const { body, cb } = await install(h);
    expect(cb.res.status).toBe(302);
    expect(h.rows).toEqual([]);
    const outcome = await h.result(body.nonce);
    expect(outcome.body).toMatchObject({ status: 'error', code: 'SLACK_OAUTH_EXCHANGE_FAILED' });
    expect(String(outcome.body.message)).toContain('invalid_code');
  });

  test('a response Slack could not have sent fails the Zod boundary, not the handler', async () => {
    const h = harness({ slackResponses: { access: () => ({ ok: true, team: { id: 5 } }) } });
    const { body, cb } = await install(h);
    expect(cb.res.status).toBe(302);
    expect(h.rows).toEqual([]);
    expect((await h.result(body.nonce)).body).toMatchObject({ status: 'error', code: 'SLACK_OAUTH_EXCHANGE_FAILED' });
  });

  test('a user-mode grant without a user token is an error, not a bot instance', async () => {
    // A bot token and no user token: the flow asked for the person, so no instance.
    const h = harness({ slackResponses: { access: () => botAccessResponse() } });
    const { body } = await install(h);
    expect(h.rows).toEqual([]);
    expect((await h.result(body.nonce)).body).toMatchObject({ status: 'error', code: 'SLACK_USER_TOKEN_MISSING' });
  });

  test('a bot token Slack returns to a user-mode flow is neither stored nor connected', async () => {
    const h = harness({
      slackResponses: {
        access: () => accessResponse({ access_token: BOT_TOKEN, token_type: 'bot', bot_user_id: 'UBOT0000001' }),
      },
    });
    const { body } = await install(h);

    expect((await h.result(body.nonce)).body).toEqual({ status: 'done', instanceId: h.rows[0]?.id });
    expect(h.rows[0]).toMatchObject({ slackAuthMode: 'user', slackBotToken: null, slackUserToken: USER_TOKEN });
    expect(h.connectOptions[0]).not.toHaveProperty('token');
    expect(h.connectOptions[0]).not.toHaveProperty('botToken');
    expect(new Headers(h.fetchCalls[1]?.init?.headers).get('authorization')).toBe(`Bearer ${USER_TOKEN}`);
  });

  test('a bot-mode grant without a bot token fails the exchange and saves no row', async () => {
    const h = harness({ slackResponses: { access: () => botAccessResponse({ access_token: undefined }) } });
    const { body } = await install(h, { entry: 'cli', mode: 'bot' });

    expect(h.rows).toEqual([]);
    expect(h.calls.connect).toBe(0);
    expect((await h.result(body.nonce)).body).toMatchObject({
      status: 'error',
      code: 'SLACK_OAUTH_EXCHANGE_FAILED',
      message: 'Slack returned no workspace bot token',
    });
  });

  test('re-authorizing a personal instance drops the bot token an earlier install stored', async () => {
    const h = harness();
    await install(h);
    // What a personal install saved before it stopped requesting bot scopes.
    Object.assign(h.rows[0] ?? {}, { slackBotToken: 'xoxb-earlier-install' });

    await install(h);

    expect(h.rows).toHaveLength(1);
    expect(h.calls.update).toBe(1);
    expect(h.rows[0]).toMatchObject({ slackBotToken: null, slackUserToken: USER_TOKEN });
    expect(h.connectOptions[1]).not.toHaveProperty('botToken');
  });

  test('a second callback for the same (team, user) updates the same row and connects again', async () => {
    const h = harness();
    const first = await install(h);
    const second = await install(h);

    expect(second.cb.res.status).toBe(302);
    expect(h.rows.length).toBe(1);
    expect(h.calls).toEqual({ create: 1, update: 1, connect: 2, transactions: 0 });
    expect((await h.result(first.body.nonce)).body).toEqual({ status: 'done', instanceId: h.rows[0]?.id });
    expect((await h.result(second.body.nonce)).body).toEqual({ status: 'done', instanceId: h.rows[0]?.id });
  });

  test('a second person in the same workspace gets a second instance', async () => {
    const h = harness();
    await install(h);
    const other = harness({
      slackResponses: {
        access: () =>
          accessResponse({
            authed_user: { id: 'U0000000002', access_token: 'xoxp-second-person', token_type: 'user' },
          }),
      },
    });
    // Same in-memory rows: pretend both flows hit one deployment.
    other.rows.push(...h.rows);
    await install(other);
    expect(other.rows.length).toBe(2);
    expect(other.rows.map((r) => r.slackUserId)).toEqual(['U0123456789', 'U0000000002']);
  });

  test('bot mode is keyed by workspace alone and never collides with a personal instance', async () => {
    const h = harness();
    const bot = await install(h, { entry: 'cli', mode: 'bot' });
    expect(bot.cb.res.status).toBe(200);
    expect(h.rows[0]).toMatchObject({
      name: 'Slack · Acme (bot)',
      slackAuthMode: 'bot',
      slackTeamId: 'T0123456789',
      slackUserId: null,
      slackBotToken: BOT_TOKEN,
      slackUserToken: null,
      slackConnectionMethod: 'oauth',
    });
    expect(h.connectOptions[0]).toMatchObject({ token: BOT_TOKEN, botToken: BOT_TOKEN, authMode: 'bot' });
    expect(h.connectOptions[0]).not.toHaveProperty('userToken');
    // No users.info in bot mode: the name comes from the workspace.
    expect(h.fetchCalls.map((f) => new URL(f.url).pathname)).toEqual(['/api/oauth.v2.access']);

    await install(h, { entry: 'cli', mode: 'bot' });
    expect(h.rows.length).toBe(1);
    expect(h.calls.update).toBe(1);

    await install(h);
    expect(h.rows.length).toBe(2);
    expect(h.rows[1]?.slackAuthMode).toBe('user');
  });

  test('CLI entry renders a fixed page carrying no identifiers and parks the outcome', async () => {
    const h = harness();
    const { body, cb } = await install(h, { entry: 'cli' });

    expect(cb.res.status).toBe(200);
    expect(cb.res.headers.get('content-type')).toContain('text/html');
    expect(cb.res.headers.get('location')).toBeNull();
    expect(cb.text).toContain('return to your terminal');
    expect(cb.text).not.toContain(h.rows[0]?.id ?? 'unreachable');
    expect(cb.text).not.toContain('Acme');
    expect(cb.text).not.toContain(body.nonce);
    expect((await h.result(body.nonce)).body).toEqual({ status: 'done', instanceId: h.rows[0]?.id });
  });

  test('a UI entry without returnTo lands on the root path', async () => {
    const h = harness();
    const { body, cb } = await install(h, { entry: 'ui' });
    expect(cb.res.headers.get('location')).toBe(`/?slack=${body.nonce}`);
  });

  test('an absolute same-origin returnTo is honoured and no query is added beyond the nonce', async () => {
    const h = harness();
    const { body, cb } = await install(h, { entry: 'ui', returnTo: `${PUBLIC_URL}/instances` });
    const location = new URL(cb.res.headers.get('location') ?? '');
    expect(location.origin).toBe(PUBLIC_URL);
    expect(location.pathname).toBe('/instances');
    expect(location.search).toBe(`?slack=${body.nonce}`);
  });

  test('a returnTo that stopped being allowed by the time Slack redirects is refused', async () => {
    const settings = { ...ALL_SETTINGS };
    const h = harness({ settings });
    const started = await h.start({ entry: 'ui', returnTo: `${PUBLIC_URL}/instances` });
    settings[SLACK_APP_SETTINGS.publicUrl.key] = 'https://moved.example.com';
    const cb = await h.callback({ code: 'c', state: h.stateOf(started.body.authorizeUrl) });
    expect(cb.res.status).toBe(400);
    expect(h.fetchCalls).toEqual([]);
  });

  test('a failed connect parks SLACK_CONNECT_FAILED but keeps the saved row', async () => {
    const h = harness({
      connect: async () => {
        throw new Error('socket refused');
      },
    });
    const { body } = await install(h);
    expect(h.rows.length).toBe(1);
    const outcome = await h.result(body.nonce);
    expect(outcome.body).toMatchObject({ status: 'error', code: 'SLACK_CONNECT_FAILED' });
    expect(String(outcome.body.message)).toContain(h.rows[0]?.id ?? 'unreachable');
  });

  test('a name collision picks the next numeric suffix', async () => {
    const h = harness({
      createThrows: (attempt) =>
        attempt === 1 ? Object.assign(new Error('duplicate key'), { code: '23505' }) : undefined,
    });
    await install(h);
    expect(h.rows[0]?.name).toBe('Slack · Jane Doe @ Acme 2');
  });

  test('falls back to the user id when users.info is unavailable', async () => {
    const h = harness({ slackResponses: { usersInfo: () => ({ ok: false, error: 'missing_scope' }) } });
    await install(h);
    expect(h.rows[0]?.name).toBe('Slack · U0123456789 @ Acme');
  });

  test('an unconfigured deployment refuses the callback before touching the state', async () => {
    const h = harness({ settings: {} });
    const cb = await h.callback({ code: 'c', state: 'slackoauth_x.deadbeef' });
    expect(cb.res.status).toBe(400);
    expect(h.fetchCalls).toEqual([]);
  });

  test('the unconfigured page is the expired-link page: the browser learns nothing about the deployment', async () => {
    const configured = harness();
    const started = await configured.start();
    const [nonce, sig] = configured.stateOf(started.body.authorizeUrl).split('.') as [string, string];
    // Same nonce, broken signature: a configured deployment answers invalid_state.
    const invalidState = await configured.callback({ code: 'c', state: `${nonce}.${sig.slice(0, -2)}00` });

    const unconfigured = harness({ settings: {} });
    const notConfigured = await unconfigured.callback({ code: 'c', state: `${nonce}.${sig}` });

    expect(notConfigured.res.status).toBe(invalidState.res.status);
    expect(notConfigured.text).toBe(invalidState.text);
  });
});

// ---------------------------------------------------------------------------
// Tenant branch (wish Decision 7)
// ---------------------------------------------------------------------------

describe('tenant context', () => {
  test('a tenant-class start makes the callback read the app keys and run the upsert inside runInTenantScope', async () => {
    const h = harness({ tenant: buildWorkerTenantContext(TENANT_A) });
    const { body, cb } = await install(h);

    expect(cb.res.status).toBe(302);
    // Two tenant-stamped transactions: the settings read that opens the
    // deployment keys as the flow's tenant, then the upsert.
    expect(h.calls).toEqual({ create: 1, update: 0, connect: 1, transactions: 2 });
    expect((await h.result(body.nonce)).body).toEqual({ status: 'done', instanceId: h.rows[0]?.id });
  });

  test('a legacy start runs on the ambient pool with no tenant transaction', async () => {
    const h = harness();
    await install(h);
    expect(h.calls.transactions).toBe(0);
  });

  test('opens deployment keys sealed under the tenant that configured them', async () => {
    const tenant = buildWorkerTenantContext(TENANT_A);
    const h = harness({ tenant, sealedUnder: TENANT_A });
    const db = h.db as unknown as Database;

    // `POST /oauth/start` runs inside the tenancy edge's scope in production;
    // this harness has no such middleware, so the scope is opened around it.
    const started = await runInTenantScope(db, tenant, () => h.start());
    expect(started.res.status).toBe(200);

    // The callback carries NO credential and so no scope of its own. Without
    // the pending record's tenant it would read the sealed secrets as unset —
    // no client secret to verify the state with, and the fixed
    // "expired link" page instead of an install.
    const cb = await h.callback({ code: 'code-123', state: h.stateOf(started.body.authorizeUrl) });
    expect(cb.res.status).toBe(302);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]?.slackSigningSecret).toBe(SIGNING_SECRET);
    expect((await h.result(started.body.nonce)).body).toEqual({ status: 'done', instanceId: h.rows[0]?.id });

    // Three tenant-stamped transactions: the start above, the callback's own
    // scoped settings read, and the upsert it runs in the same tenant.
    expect(h.calls.transactions).toBe(3);
  });

  test('a tenant that cannot open the sealed keys cannot start a flow either', async () => {
    const h = harness({ tenant: buildWorkerTenantContext(TENANT_B), sealedUnder: TENANT_A });
    const started = await runInTenantScope(h.db as unknown as Database, buildWorkerTenantContext(TENANT_B), () =>
      h.start(),
    );

    expect(started.res.status).toBe(409);
    const error = (started.body as unknown as { error: { code: string; details: { missing: string[] } } }).error;
    expect(error.code).toBe('SLACK_APP_NOT_CONFIGURED');
    expect(error.details.missing).toEqual([
      SLACK_APP_SETTINGS.clientSecret.key,
      SLACK_APP_SETTINGS.signingSecret.key,
      SLACK_APP_SETTINGS.appToken.key,
    ]);
  });

  test('a legacy outcome is readable only by a caller with no tenant context', async () => {
    const legacy = harness();
    const { body } = await install(legacy);

    // Same process-local store; a tenant credential knowing the nonce is not
    // the deployment, so the outcome stays parked for the legacy caller.
    const scoped = harness({ tenant: buildWorkerTenantContext(TENANT_A) });
    expect((await scoped.result(body.nonce)).body).toEqual({ status: 'pending' });
    expect((await legacy.result(body.nonce)).body.status).toBe('done');
  });

  test('another tenant cannot read the outcome, and the owner still can', async () => {
    const owner = harness({ tenant: buildWorkerTenantContext(TENANT_A) });
    const { body } = await install(owner);

    // Same process-local store; only the credential differs.
    const intruder = harness({ tenant: buildWorkerTenantContext(TENANT_B) });
    expect((await intruder.result(body.nonce)).body).toEqual({ status: 'pending' });
    expect((await owner.result(body.nonce)).body.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Runs last: every body, Location header and log line captured above
// ---------------------------------------------------------------------------

describe('secrets never leave the server', () => {
  test('no response body, Location header or log line contains a Slack token shape', () => {
    // Positive control: the capture saw the flow's own log lines, so an empty
    // leak list means "checked", not "nothing captured".
    expect(allCaptured.some((line) => line.includes('api:slack-oauth'))).toBe(true);
    expect(allCaptured.some((line) => line.includes('slack='))).toBe(true);
    expect(allCaptured.filter((line) => line.includes('xox'))).toEqual([]);
  });
});
