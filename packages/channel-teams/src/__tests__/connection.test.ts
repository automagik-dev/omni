/**
 * Group 3 acceptance tests for the plugin lifecycle (connect / disconnect /
 * handleWebhook).
 *
 * Real Bot Framework + AAD round-trips are stubbed via `fetch`. The goal is
 * to lock in three behaviours required by the wish:
 *   - Bad credentials → `connect()` throws `TeamsError(AUTH_FAILED)`.
 *   - Missing credentials → `connect()` throws `TeamsError(INVALID_CREDENTIALS)`.
 *   - Successful connect emits `instance.connected` and primes the per-instance state.
 */

import { describe, expect, it, mock } from 'bun:test';

import type {
  EventBus,
  GlobalConfig,
  InstanceConfig,
  Logger,
  PluginContext,
  PluginDatabase,
  PluginStorage,
} from '@omni/channel-sdk';

import { TeamsPlugin } from '../plugin';
import { TeamsError, TeamsErrorCode } from '../types';

// ─────────────────────────────────────────────────────────────
// Mock factories
// ─────────────────────────────────────────────────────────────

interface PublishedEvent {
  type: string;
  payload: unknown;
  metadata: unknown;
}

function makeMockContext(): { context: PluginContext; events: PublishedEvent[] } {
  const events: PublishedEvent[] = [];

  const eventBus: EventBus = {
    publish: async (type: string, payload: unknown, metadata: unknown) => {
      events.push({ type, payload, metadata });
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

function withMockedFetch(handler: (input: unknown, init?: RequestInit) => Response | Promise<Response>): {
  restore: () => void;
} {
  const original = globalThis.fetch;
  globalThis.fetch = mock(async (input: unknown, init?: RequestInit) => {
    return handler(input, init);
  }) as unknown as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Identity & capabilities
// ─────────────────────────────────────────────────────────────

describe('TeamsPlugin identity', () => {
  it('claims the teams channel slot', () => {
    const plugin = new TeamsPlugin();
    expect(plugin.id).toBe('teams');
    expect(plugin.name).toContain('Teams');
    expect(plugin.capabilities.canHandleDMs).toBe(true);
    expect(plugin.capabilities.canHandleThreads).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// connect() — credential validation
// ─────────────────────────────────────────────────────────────

describe('TeamsPlugin.connect — credential validation', () => {
  it('throws TeamsError(INVALID_CREDENTIALS) when appId is missing', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const config: InstanceConfig = {
      instanceId: 'inst-1',
      credentials: { appPassword: 'secret' },
    };

    await expect(plugin.connect('inst-1', config)).rejects.toBeInstanceOf(TeamsError);
    try {
      await plugin.connect('inst-1', config);
    } catch (err) {
      expect((err as TeamsError).channelCode).toBe(TeamsErrorCode.INVALID_CREDENTIALS);
    }
  });

  it('throws TeamsError(INVALID_CREDENTIALS) when appPassword is missing', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const config: InstanceConfig = {
      instanceId: 'inst-2',
      credentials: { appId: 'app' },
    };

    try {
      await plugin.connect('inst-2', config);
      throw new Error('connect should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TeamsError);
      expect((err as TeamsError).channelCode).toBe(TeamsErrorCode.INVALID_CREDENTIALS);
    }
  });

  it('throws TeamsError(INVALID_CREDENTIALS) when SingleTenant config is missing tenantId', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const config: InstanceConfig = {
      instanceId: 'inst-3',
      credentials: { appId: 'app', appPassword: 'secret' },
      options: { appType: 'SingleTenant' },
    };

    try {
      await plugin.connect('inst-3', config);
      throw new Error('connect should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TeamsError);
      expect((err as TeamsError).channelCode).toBe(TeamsErrorCode.INVALID_CREDENTIALS);
    }
  });

  it('throws TeamsError(AUTH_FAILED) when AAD rejects the credentials', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() => textResponse(401, 'AADSTS70011: invalid_client'));

    try {
      await expect(
        plugin.connect('inst-bad', {
          instanceId: 'inst-bad',
          credentials: { appId: 'app', appPassword: 'wrong' },
        }),
      ).rejects.toBeInstanceOf(TeamsError);

      try {
        await plugin.connect('inst-bad', {
          instanceId: 'inst-bad',
          credentials: { appId: 'app', appPassword: 'wrong' },
        });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(TeamsError);
        expect((err as TeamsError).channelCode).toBe(TeamsErrorCode.AUTH_FAILED);
      }
    } finally {
      handle.restore();
    }
  });

  it('connects successfully when AAD returns a valid token', async () => {
    const { context, events } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() =>
      jsonResponse(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
    );

    try {
      await plugin.connect('inst-ok', {
        instanceId: 'inst-ok',
        credentials: { appId: 'app', appPassword: 'secret' },
        options: { defaultBotName: 'Omni Bot' },
      });

      // Connection state recorded
      expect(plugin.getClient('inst-ok')).toBeDefined();
      // Service URL map starts empty (populated only on inbound activity)
      expect(plugin.getServiceUrl('inst-ok', 'whatever')).toBeUndefined();

      // instance.connected emitted with the bot's profile
      const connectedEvent = events.find((e) => e.type === 'instance.connected');
      expect(connectedEvent).toBeDefined();
      const payload = connectedEvent?.payload as { profileName?: string; ownerIdentifier?: string };
      expect(payload.profileName).toBe('Omni Bot');
      expect(payload.ownerIdentifier).toBe('app');
    } finally {
      handle.restore();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// disconnect()
// ─────────────────────────────────────────────────────────────

describe('TeamsPlugin.disconnect', () => {
  it('removes per-instance state and emits instance.disconnected', async () => {
    const { context, events } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() =>
      jsonResponse(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
    );

    try {
      await plugin.connect('inst-x', {
        instanceId: 'inst-x',
        credentials: { appId: 'app', appPassword: 'secret' },
      });
    } finally {
      handle.restore();
    }

    expect(plugin.getClient('inst-x')).toBeDefined();

    await plugin.disconnect('inst-x');

    expect(plugin.getClient('inst-x')).toBeUndefined();
    expect(events.some((e) => e.type === 'instance.disconnected')).toBe(true);
  });

  it('is idempotent — disconnecting a never-connected instance does not throw', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);
    await plugin.disconnect('never-connected');
  });
});

// ─────────────────────────────────────────────────────────────
// handleWebhook()
// ─────────────────────────────────────────────────────────────

describe('TeamsPlugin.handleWebhook', () => {
  it('returns 400 when the path lacks an instanceId', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const response = await plugin.handleWebhook(new Request('http://localhost/api/v2/channels/teams/'));
    expect(response.status).toBe(400);
  });

  it('returns 404 when the instance is not connected', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/missing/webhook', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(response.status).toBe(404);
  });

  it('always 200s for connected instances even on malformed bodies', async () => {
    const { context } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() =>
      jsonResponse(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
    );
    try {
      await plugin.connect('inst-w', {
        instanceId: 'inst-w',
        credentials: { appId: 'app', appPassword: 'secret' },
      });
    } finally {
      handle.restore();
    }

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-w/webhook', {
        method: 'POST',
        body: 'not json',
      }),
    );
    expect(response.status).toBe(200);
  });

  it('emits message.received for an inbound text activity', async () => {
    const { context, events } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() =>
      jsonResponse(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
    );
    try {
      await plugin.connect('inst-msg', {
        instanceId: 'inst-msg',
        credentials: { appId: 'app', appPassword: 'secret' },
      });
    } finally {
      handle.restore();
    }

    const activity = {
      type: 'message',
      id: 'act-1',
      timestamp: '2026-04-26T12:00:00Z',
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      from: { id: '29:user', name: 'Ada', aadObjectId: 'aad-ada' },
      conversation: { id: 'conv-1', conversationType: 'personal', tenantId: 'tenant-1' },
      recipient: { id: '28:bot' },
      text: 'hello bot',
    };

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-msg/webhook', {
        method: 'POST',
        body: JSON.stringify(activity),
      }),
    );
    expect(response.status).toBe(200);

    const received = events.find((e) => e.type === 'message.received');
    expect(received).toBeDefined();
    const payload = received?.payload as Record<string, unknown>;
    expect(payload.externalId).toBe('act-1');
    expect(payload.chatId).toBe('conv-1');
    expect(payload.from).toBe('aad-ada');
    expect((payload.content as { text?: string }).text).toBe('hello bot');

    // Service URL captured on first inbound
    expect(plugin.getServiceUrl('inst-msg', 'conv-1')).toBe('https://smba.trafficmanager.net/teams/');
  });

  it('emits reaction.received for inbound messageReaction activities', async () => {
    const { context, events } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() =>
      jsonResponse(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
    );
    try {
      await plugin.connect('inst-rx', {
        instanceId: 'inst-rx',
        credentials: { appId: 'app', appPassword: 'secret' },
      });
    } finally {
      handle.restore();
    }

    const activity = {
      type: 'messageReaction',
      id: 'react-1',
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      from: { id: '29:user', aadObjectId: 'aad-user' },
      conversation: { id: 'conv-1', conversationType: 'channel' },
      replyToId: 'target-msg',
      reactionsAdded: [{ type: 'like' }],
      channelData: { team: { id: 't1' }, channel: { id: 'chan-x' } },
    };

    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/teams/inst-rx/webhook', {
        method: 'POST',
        body: JSON.stringify(activity),
      }),
    );
    expect(response.status).toBe(200);

    const reactionEvent = events.find((e) => e.type === 'reaction.received');
    expect(reactionEvent).toBeDefined();
    const payload = reactionEvent?.payload as Record<string, unknown>;
    expect(payload.messageId).toBe('target-msg');
    expect(payload.emoji).toBe('like');
    expect(payload.chatId).toBe('chan-x');
  });

  it('dedupes repeated activity IDs within the same conversation', async () => {
    const { context, events } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() =>
      jsonResponse(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
    );
    try {
      await plugin.connect('inst-dup', {
        instanceId: 'inst-dup',
        credentials: { appId: 'app', appPassword: 'secret' },
      });
    } finally {
      handle.restore();
    }

    const activity = {
      type: 'message',
      id: 'act-dup',
      timestamp: '2026-04-26T12:00:00Z',
      serviceUrl: 'https://example/',
      from: { id: '29:user', aadObjectId: 'aad-user' },
      conversation: { id: 'conv-d', conversationType: 'personal' },
      recipient: { id: '28:bot' },
      text: 'duplicate me',
    };

    const body = JSON.stringify(activity);
    const url = 'http://localhost/api/v2/channels/teams/inst-dup/webhook';

    await plugin.handleWebhook(new Request(url, { method: 'POST', body }));
    await plugin.handleWebhook(new Request(url, { method: 'POST', body }));

    const received = events.filter((e) => e.type === 'message.received');
    expect(received).toHaveLength(1);
  });

  it('safely ignores non-message activity types (typing/conversationUpdate/etc.)', async () => {
    const { context, events } = makeMockContext();
    const plugin = new TeamsPlugin();
    await plugin.initialize(context);

    const handle = withMockedFetch(() =>
      jsonResponse(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' }),
    );
    try {
      await plugin.connect('inst-skip', {
        instanceId: 'inst-skip',
        credentials: { appId: 'app', appPassword: 'secret' },
      });
    } finally {
      handle.restore();
    }

    for (const type of ['typing', 'conversationUpdate', 'event', 'invoke', 'endOfConversation']) {
      const activity = {
        type,
        id: `${type}-1`,
        serviceUrl: 'https://example/',
        from: { id: '29:user' },
        conversation: { id: 'conv-skip' },
        recipient: { id: '28:bot' },
      };
      const response = await plugin.handleWebhook(
        new Request('http://localhost/api/v2/channels/teams/inst-skip/webhook', {
          method: 'POST',
          body: JSON.stringify(activity),
        }),
      );
      expect(response.status).toBe(200);
    }

    expect(events.some((e) => e.type === 'message.received')).toBe(false);
    expect(events.some((e) => e.type === 'reaction.received')).toBe(false);
  });
});
