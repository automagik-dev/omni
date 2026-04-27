/**
 * JWT validation tests for `TeamsPlugin.handleWebhook`.
 *
 * Bot Framework signs every inbound activity with a JWT in the
 * `Authorization` header. The plugin delegates verification to a
 * `CloudAdapter` (built per-instance from the bot's app credentials).
 * `CloudAdapter.process()` reads the header, validates signature / issuer
 * (`https://api.botframework.com`) / audience (the bot's `appId`) /
 * `exp` / `nbf` against Microsoft's published OpenID metadata, and only
 * then runs the supplied logic callback.
 *
 * These tests stub the adapter with a fake that mirrors that contract so
 * we can assert the wiring without orchestrating real JWT signing:
 *
 *  - valid header → adapter calls logic, returns 200, dispatch runs
 *  - missing header → adapter writes 401, dispatch is skipped
 *  - wrong audience → adapter writes 401, dispatch is skipped
 *  - expired token → adapter writes 401, dispatch is skipped
 *
 * Behavioural contract under test (in `plugin.ts`):
 *  1. The `Authorization` header is forwarded to the adapter unchanged.
 *  2. The adapter's response status is propagated to the caller's
 *     `Response` object — including 401 on auth failure.
 *  3. On auth failure the dispatch logic does NOT run (no events emitted).
 *  4. On auth success the dispatch logic runs and events are emitted as
 *     usual.
 */

import { describe, expect, it } from 'bun:test';

import type {
  EventBus,
  GlobalConfig,
  InstanceConfig,
  Logger,
  PluginContext,
  PluginDatabase,
  PluginStorage,
} from '@omni/channel-sdk';

import type { TeamsCloudAdapter } from '../plugin';
import { TeamsPlugin } from '../plugin';
import type { TeamsConnectionOptions } from '../types';

interface PublishedEvent {
  type: string;
  payload: unknown;
}

function makeMockContext(): { context: PluginContext; events: PublishedEvent[] } {
  const events: PublishedEvent[] = [];
  const eventBus: EventBus = {
    publish: async (type: string, payload: unknown) => {
      events.push({ type, payload });
    },
    subscribe: async () => ({ unsubscribe: async () => {} }),
  } as unknown as EventBus;

  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  const storage: PluginStorage = {
    get: async () => null,
    set: async () => {},
    delete: async () => true,
    has: async () => false,
    keys: async () => [],
  };

  const config: GlobalConfig = {
    env: 'development',
    apiBaseUrl: 'http://localhost:3000',
    webhookBaseUrl: 'http://localhost:3000',
    mediaStorage: { type: 'local', basePath: '/tmp/omni' },
  };

  const db: PluginDatabase = {
    execute: async () => [],
    getDrizzle: () => ({}),
  };

  return { context: { eventBus, logger, storage, config, db }, events };
}

function withMockedFetch(handler: (input: unknown, init?: RequestInit) => Response | Promise<Response>): {
  restore: () => void;
} {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => handler(input, init)) as unknown as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const aadTokenResponse = () =>
  new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

interface AdapterCall {
  authorization: string | string[] | undefined;
  body: Record<string, unknown> | undefined;
}

/**
 * Fake CloudAdapter that mimics the real one's auth contract:
 *
 *   if validate(authHeader, body) returns true ⇒ run logic, write 200
 *   else                                       ⇒ skip logic, write 401
 *
 * The validator can simulate any of the failure modes the real adapter
 * surfaces (missing header, wrong audience, expired exp, etc.).
 */
function makeFakeAdapter(
  validator: (authHeader: string | undefined, body: Record<string, unknown> | undefined) => boolean,
  recorder: AdapterCall[],
): TeamsCloudAdapter {
  return {
    async process(req, res, logic) {
      const authHeader = req.headers?.authorization;
      const headerString = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      recorder.push({ authorization: authHeader, body: req.body });

      if (!validator(headerString, req.body)) {
        res.status(401);
        res.send('Unauthorized');
        res.end();
        return;
      }

      await logic({ activity: req.body });
      res.status(200);
      res.end();
    },
  };
}

/**
 * Test seam: subclass of `TeamsPlugin` that swaps `buildCloudAdapter` for a
 * factory provided per-test. Lets us drive every JWT scenario without ever
 * touching real botbuilder code or making a network call to Microsoft.
 */
class StubbedTeamsPlugin extends TeamsPlugin {
  constructor(private readonly factory: (opts: TeamsConnectionOptions) => TeamsCloudAdapter) {
    super();
  }
  protected override buildCloudAdapter(opts: TeamsConnectionOptions): TeamsCloudAdapter {
    return this.factory(opts);
  }
}

const VALID_BOT_APP_ID = 'app-id-123';
const VALID_AUTH_HEADER = `Bearer ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;

const sampleActivity = {
  type: 'message',
  id: 'act-1',
  timestamp: '2026-04-26T12:00:00Z',
  serviceUrl: 'https://smba.trafficmanager.net/teams/',
  from: { id: '29:user', name: 'Ada', aadObjectId: 'aad-ada' },
  conversation: { id: 'conv-1', conversationType: 'personal', tenantId: 'tenant-1' },
  recipient: { id: '28:bot' },
  text: 'hello bot',
};

async function connect(plugin: TeamsPlugin, instanceId: string): Promise<void> {
  const handle = withMockedFetch(() => aadTokenResponse());
  try {
    const cfg: InstanceConfig = {
      instanceId,
      credentials: { appId: VALID_BOT_APP_ID, appPassword: 'secret' },
    };
    await plugin.connect(instanceId, cfg);
  } finally {
    handle.restore();
  }
}

describe('TeamsPlugin.handleWebhook — JWT validation', () => {
  it('accepts an activity when the adapter validates the JWT', async () => {
    const { context, events } = makeMockContext();
    const calls: AdapterCall[] = [];
    const validator = (authHeader: string | undefined) =>
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ');
    const plugin = new StubbedTeamsPlugin(() => makeFakeAdapter(validator, calls));
    await plugin.initialize(context);
    await connect(plugin, 'inst-valid');

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-valid/webhook', {
        method: 'POST',
        headers: { authorization: VALID_AUTH_HEADER, 'content-type': 'application/json' },
        body: JSON.stringify(sampleActivity),
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.authorization).toBe(VALID_AUTH_HEADER);
    // dispatch ran ⇒ message.received emitted
    expect(events.some((e) => e.type === 'message.received')).toBe(true);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const { context, events } = makeMockContext();
    const calls: AdapterCall[] = [];
    const validator = (authHeader: string | undefined) => typeof authHeader === 'string' && authHeader.length > 0;
    const plugin = new StubbedTeamsPlugin(() => makeFakeAdapter(validator, calls));
    await plugin.initialize(context);
    await connect(plugin, 'inst-noauth');

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-noauth/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sampleActivity),
      }),
    );

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.authorization).toBeFalsy();
    // dispatch was skipped ⇒ no message.received event
    expect(events.some((e) => e.type === 'message.received')).toBe(false);
  });

  it('returns 401 when the JWT audience does not match the bot appId', async () => {
    const { context, events } = makeMockContext();
    const calls: AdapterCall[] = [];
    const expectedAudience = VALID_BOT_APP_ID;
    // Simulate an audience-claim check: only accept tokens prefixed with the
    // expected audience marker. A mismatched audience falls through to 401.
    const validator = (authHeader: string | undefined) => {
      if (typeof authHeader !== 'string') return false;
      return authHeader.includes(`aud=${expectedAudience}`);
    };
    const plugin = new StubbedTeamsPlugin(() => makeFakeAdapter(validator, calls));
    await plugin.initialize(context);
    await connect(plugin, 'inst-wrongaud');

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-wrongaud/webhook', {
        method: 'POST',
        headers: {
          authorization: 'Bearer aud=other-tenant-app',
          'content-type': 'application/json',
        },
        body: JSON.stringify(sampleActivity),
      }),
    );

    expect(response.status).toBe(401);
    expect(events.some((e) => e.type === 'message.received')).toBe(false);
  });

  it('returns 401 when the JWT exp claim is in the past', async () => {
    const { context, events } = makeMockContext();
    const calls: AdapterCall[] = [];
    // Simulate an exp-claim check: require a future expiry encoded in the
    // header marker `exp=<unix-seconds>`. An expired marker is rejected.
    const validator = (authHeader: string | undefined) => {
      if (typeof authHeader !== 'string') return false;
      const match = authHeader.match(/exp=(\d+)/);
      if (!match || !match[1]) return false;
      return Number(match[1]) > Math.floor(Date.now() / 1000);
    };
    const plugin = new StubbedTeamsPlugin(() => makeFakeAdapter(validator, calls));
    await plugin.initialize(context);
    await connect(plugin, 'inst-expired');

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-expired/webhook', {
        method: 'POST',
        headers: {
          authorization: 'Bearer exp=1', // 1970-01-01 → very expired
          'content-type': 'application/json',
        },
        body: JSON.stringify(sampleActivity),
      }),
    );

    expect(response.status).toBe(401);
    expect(events.some((e) => e.type === 'message.received')).toBe(false);
  });
});
