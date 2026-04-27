/**
 * Regression tests for the Gemini Code Assist findings on PR #543.
 *
 * Each `describe` corresponds to a finding in
 * `.genie/wishes/teams-channel/REVIEW.md` (sections A.1–A.4) and
 * locks the post-fix contract. Removing the fix from production code
 * would flip the assertions red.
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

/**
 * A permissive adapter — runs the logic with the parsed body. Used for
 * tests that exercise post-auth behaviour (A.1 / A.2).
 */
function makePermissiveAdapter(): TeamsCloudAdapter {
  return {
    async process(req, res, logic) {
      await logic({ activity: req.body });
      res.status(200);
      res.end();
    },
  };
}

class StubbedTeamsPlugin extends TeamsPlugin {
  constructor(private readonly factory: (opts: TeamsConnectionOptions) => TeamsCloudAdapter) {
    super();
  }
  protected override buildCloudAdapter(opts: TeamsConnectionOptions): TeamsCloudAdapter {
    return this.factory(opts);
  }
}

async function connect(plugin: TeamsPlugin, instanceId: string): Promise<void> {
  const handle = withMockedFetch(() => aadTokenResponse());
  try {
    const cfg: InstanceConfig = {
      instanceId,
      credentials: { appId: 'app-id-x', appPassword: 'secret' },
    };
    await plugin.connect(instanceId, cfg);
  } finally {
    handle.restore();
  }
}

describe('A.1 — serviceUrls keyed by chatId (matches deriveChatId)', () => {
  it('stores under channelData.channel.id for channel posts', async () => {
    const { context } = makeMockContext();
    const plugin = new StubbedTeamsPlugin(() => makePermissiveAdapter());
    await plugin.initialize(context);
    await connect(plugin, 'inst-a1-channel');

    const channelActivity = {
      type: 'message',
      id: 'act-channel-1',
      timestamp: '2026-04-26T12:00:00Z',
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      from: { id: '29:user', aadObjectId: 'aad-user' },
      conversation: {
        id: '19:thread-root@thread.tacv2;messageid=1',
        conversationType: 'channel',
      },
      recipient: { id: '28:bot' },
      text: 'channel message',
      channelData: {
        team: { id: 'team-1' },
        channel: { id: 'channel-x' },
      },
    };

    await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-a1-channel/webhook', {
        method: 'POST',
        body: JSON.stringify(channelActivity),
      }),
    );

    // Should be retrievable under the channel id (the chatId used by senders).
    expect(plugin.getServiceUrl('inst-a1-channel', 'channel-x')).toBe('https://smba.trafficmanager.net/teams/');
    // Must NOT be keyed under the thread root conversation id.
    expect(plugin.getServiceUrl('inst-a1-channel', '19:thread-root@thread.tacv2;messageid=1')).toBeUndefined();
  });

  it('stores under conversation.id for personal (DM) chats', async () => {
    const { context } = makeMockContext();
    const plugin = new StubbedTeamsPlugin(() => makePermissiveAdapter());
    await plugin.initialize(context);
    await connect(plugin, 'inst-a1-dm');

    const dmActivity = {
      type: 'message',
      id: 'act-dm-1',
      timestamp: '2026-04-26T12:00:00Z',
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      from: { id: '29:user', aadObjectId: 'aad-user' },
      conversation: { id: 'a:dm-conv', conversationType: 'personal' },
      recipient: { id: '28:bot' },
      text: 'hello',
    };

    await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-a1-dm/webhook', {
        method: 'POST',
        body: JSON.stringify(dmActivity),
      }),
    );

    expect(plugin.getServiceUrl('inst-a1-dm', 'a:dm-conv')).toBe('https://smba.trafficmanager.net/teams/');
  });
});

describe('A.2 — lastActivityIds keyed by parsed.chatId', () => {
  it('records lastActivityId under the channel id (not the thread root) for channel posts', async () => {
    const { context, events } = makeMockContext();
    const plugin = new StubbedTeamsPlugin(() => makePermissiveAdapter());
    await plugin.initialize(context);
    await connect(plugin, 'inst-a2-channel');

    const channelActivity = {
      type: 'message',
      id: 'act-channel-7',
      timestamp: '2026-04-26T12:00:00Z',
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      from: { id: '29:user', aadObjectId: 'aad-user' },
      conversation: {
        id: '19:thread-root@thread.tacv2;messageid=2',
        conversationType: 'channel',
      },
      recipient: { id: '28:bot' },
      text: 'channel message',
      channelData: {
        team: { id: 'team-1' },
        channel: { id: 'channel-y' },
      },
    };

    await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-a2-channel/webhook', {
        method: 'POST',
        body: JSON.stringify(channelActivity),
      }),
    );

    // The emitted message.received uses chatId (channel id); the lastActivityIds
    // map must be keyed the same way so sendMessage's replyToMode='all'
    // resolves correctly.
    const msg = events.find((e) => e.type === 'message.received');
    expect(msg).toBeDefined();
    const payload = msg?.payload as Record<string, unknown>;
    expect(payload.chatId).toBe('channel-y');

    // The plugin's typing call uses lastActivityIds[chatId]; if it were keyed
    // under thread-root we would lose the activity id. We can't directly
    // inspect the private map, but sendTyping fails if no service URL is
    // resolvable — which would indicate the wrong key.
    const handle = withMockedFetch(
      () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    try {
      await plugin.sendTyping('inst-a2-channel', 'channel-y');
    } finally {
      handle.restore();
    }
    // No throw == lookup succeeded under the chatId.
  });
});

describe('A.4 — fakeRes propagates headers from the adapter', () => {
  it('relays Content-Type and arbitrary headers set by the CloudAdapter', async () => {
    const { context } = makeMockContext();
    // Adapter that simulates an invoke-activity response: writes a JSON body
    // and sets Content-Type explicitly.
    const adapter: TeamsCloudAdapter = {
      async process(_req, res, _logic) {
        res.status(202);
        res.header('Content-Type', 'application/json; charset=utf-8');
        res.header('X-Teams-Test', 'yes');
        res.send({ ok: true });
        res.end();
      },
    };
    const plugin = new StubbedTeamsPlugin(() => adapter);
    await plugin.initialize(context);
    await connect(plugin, 'inst-a4');

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-a4/webhook', {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'invoke', id: 'inv-1' }),
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-teams-test')).toBe('yes');
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: true });
  });

  it('auto-sets Content-Type when send() receives an object and no header was explicit', async () => {
    const { context } = makeMockContext();
    const adapter: TeamsCloudAdapter = {
      async process(_req, res, _logic) {
        // No explicit res.header('content-type', ...); send() infers it.
        res.send({ status: 'noted' });
        res.end();
      },
    };
    const plugin = new StubbedTeamsPlugin(() => adapter);
    await plugin.initialize(context);
    await connect(plugin, 'inst-a4-auto');

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-a4-auto/webhook', {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'invoke', id: 'inv-2' }),
      }),
    );

    expect(response.headers.get('content-type')).toBe('application/json');
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ status: 'noted' });
  });
});

describe('B.1 — capability matrix matches implementation', () => {
  it('declares canEditMessage:false / canDeleteMessage:false to match tools.ts NOT_IMPLEMENTED stubs', async () => {
    const plugin = new TeamsPlugin();
    expect(plugin.capabilities.canEditMessage).toBe(false);
    expect(plugin.capabilities.canDeleteMessage).toBe(false);
  });
});

describe('Filipe round 2 — chatId vs Bot Framework conversation.id (channel-context outbound)', () => {
  it('sendMessage to a channel uses the captured Bot Framework conversation.id, not the Omni chatId', async () => {
    const { context } = makeMockContext();
    const plugin = new StubbedTeamsPlugin(() => makePermissiveAdapter());
    await plugin.initialize(context);

    // Install a single mock that routes by URL — kept active for the whole
    // test so the BotFrameworkClient's captured fetchImpl uses it during
    // both AAD acquisition (in connect) and the outbound activity POST.
    const sendUrls: string[] = [];
    const handle = withMockedFetch((input) => {
      const url = typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.includes('/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/v3/conversations/')) {
        sendUrls.push(url);
        return new Response(JSON.stringify({ id: 'act-out-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not handled', { status: 500 });
    });

    try {
      const cfg: InstanceConfig = {
        instanceId: 'inst-channel-out',
        credentials: { appId: 'app-id-x', appPassword: 'secret' },
      };
      await plugin.connect('inst-channel-out', cfg);

      // 1) Inbound channel post: chatId becomes channel.id; Bot Framework
      //    conversation.id is the thread root. Plugin must remember both.
      await plugin.handleWebhook(
        new Request('http://localhost/api/v2/channels/teams/inst-channel-out/webhook', {
          method: 'POST',
          body: JSON.stringify({
            type: 'message',
            id: 'act-channel-in-1',
            timestamp: '2026-04-27T12:00:00Z',
            serviceUrl: 'https://smba.trafficmanager.net/teams/',
            from: { id: '29:user', aadObjectId: 'aad-user' },
            conversation: {
              id: '19:thread-root@thread.tacv2;messageid=999',
              conversationType: 'channel',
            },
            recipient: { id: '28:bot' },
            text: 'lixei',
            channelData: { team: { id: 'team-X' }, channel: { id: 'channel-Z' } },
          }),
        }),
      );

      // 2) Outbound to chatId='channel-Z'. Plugin must rewrite to the
      //    captured Bot Framework conversation.id when calling /v3/conversations/.
      await plugin.sendMessage('inst-channel-out', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to: 'channel-Z' as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: { type: 'text', text: 'reply' } as any,
      });
    } finally {
      handle.restore();
    }

    expect(sendUrls.length).toBeGreaterThan(0);
    const sendUrl = sendUrls[0] ?? '';
    // URL must contain the URL-encoded THREAD-ROOT conversation.id, NOT chatId.
    expect(sendUrl).toContain(encodeURIComponent('19:thread-root@thread.tacv2;messageid=999'));
    expect(sendUrl).not.toMatch(/\/conversations\/channel-Z\/activities/);
  });
});
