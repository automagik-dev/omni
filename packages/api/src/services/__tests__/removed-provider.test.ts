import { afterEach, describe, expect, mock, test } from 'bun:test';
import { PROVIDER_SCHEMAS, ProviderError, REMOVED_OPENCLAW_MESSAGE } from '@omni/core';
import type { AgentProvider, Database } from '@omni/db';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error';
import { __test__ as dispatcher, resolveProvider } from '../../plugins/agent-dispatcher';
import { providersRoutes } from '../../routes/v2/providers';
import { CreateProviderSchema, ProviderSchema } from '../../schemas/openapi/providers';
import type { AppVariables } from '../../types';
import { type AgentRunContext, AgentRunnerService } from '../agent-runner';
import { ProviderService } from '../providers';

const row: AgentProvider = {
  id: 'b74a5ecb-4303-49c5-8d46-481c20b343d2',
  name: 'retained-provider',
  schema: 'openclaw',
  baseUrl: 'ws://127.0.0.1:1',
  apiKey: 'retained-token',
  schemaConfig: { devicePrivateKey: 'retained-private', deviceToken: 'retained-device-token' },
  description: null,
  tags: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  defaultStream: true,
  defaultTimeout: 600,
  supportsStreaming: true,
  supportsImages: false,
  supportsAudio: false,
  supportsDocuments: false,
  lastHealthCheck: null,
  isActive: true,
  lastHealthStatus: 'healthy',
  lastHealthError: null,
};

function fixture(options: { writable?: boolean; provider?: AgentProvider } = {}) {
  const stored = structuredClone(options.provider ?? row);
  let deleted = false;
  const query = {
    from: () => query,
    where: () => query,
    $dynamic: () => query,
    limit: async () => (deleted ? [] : [stored]),
    orderBy: async () => (deleted ? [] : [stored]),
  };
  const writes = mock(() => {
    if (!options.writable) throw new Error('Unexpected database write');
  });
  const db = {
    select: () => query,
    insert: writes,
    update: () => {
      writes();
      return {
        set: (data: Partial<AgentProvider>) => ({
          where: () => {
            Object.assign(stored, data);
            return Object.assign(Promise.resolve(), { returning: async () => [stored] });
          },
        }),
      };
    },
    delete: () => {
      writes();
      return {
        where: () => ({
          returning: async () => {
            deleted = true;
            return [{ id: stored.id }];
          },
        }),
      };
    },
  } as unknown as Database;
  const providers = new ProviderService(db);
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', { providers } as AppVariables['services']);
    await next();
  });
  app.route('/providers', providersRoutes);
  return { db, providers, writes, app };
}

afterEach(() => {
  dispatcher.resetProviderCaches();
});

describe('removed provider compatibility', () => {
  test('retained rows load without a boot error, show the removal, and preserve stored credentials', async () => {
    const { providers, writes } = fixture();
    const snapshot = structuredClone(row);
    const loaded = await providers.getById(row.id);
    expect(loaded).toMatchObject({
      schema: 'openclaw',
      apiKey: row.apiKey,
      schemaConfig: row.schemaConfig,
      lastHealthStatus: 'error',
      lastHealthError: REMOVED_OPENCLAW_MESSAGE,
    });
    expect((await providers.getByName(row.name)).lastHealthError).toBe(REMOVED_OPENCLAW_MESSAGE);
    expect((await providers.list())[0]?.lastHealthError).toBe(REMOVED_OPENCLAW_MESSAGE);
    expect(row).toEqual(snapshot);
    expect(writes).not.toHaveBeenCalled();
  });

  test('health refuses a retained provider without an outbound probe or database mutation', async () => {
    const { providers, writes } = fixture();
    const previousFetch = globalThis.fetch;
    const fetch = mock(async () => {
      throw new Error('Unexpected outbound request');
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    try {
      expect(await providers.checkHealth(row.id)).toEqual({
        healthy: false,
        latency: 0,
        error: REMOVED_OPENCLAW_MESSAGE,
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('dispatch refuses loudly instead of returning null for legacy fallback, including inactive rows', async () => {
    const { db, providers } = fixture();
    const instance = { id: 'instance', agentProviderId: row.id };
    expect(() => resolveProvider(row, instance as never, db)).toThrow(REMOVED_OPENCLAW_MESSAGE);
    await expect(dispatcher.getAgentProvider({ providers } as never, instance as never, db)).rejects.toMatchObject({
      message: REMOVED_OPENCLAW_MESSAGE,
      statusCode: 410,
    });
    const inactive = { getById: async () => ({ ...row, isActive: false }) };
    await expect(dispatcher.getAgentProvider({ providers: inactive } as never, instance as never, db)).rejects.toThrow(
      REMOVED_OPENCLAW_MESSAGE,
    );
  });

  test('an upstream 410 from Agno keeps provider resolution on the legacy fallback path', async () => {
    const { db } = fixture({ provider: { ...row, schema: 'agno' } });
    const instance = { id: 'instance', agentProviderId: row.id };
    const providers = {
      getById: mock(async () => {
        throw new ProviderError('Agno upstream returned HTTP 410', 'SERVER_ERROR', 410, { schema: 'agno' });
      }),
    };

    expect(await dispatcher.getAgentProvider({ providers } as never, instance as never, db)).toBeNull();
    expect(providers.getById).toHaveBeenCalledWith(row.id);
  });

  test('manual agent runs refuse before any outbound call', async () => {
    const { db } = fixture();
    const previousFetch = globalThis.fetch;
    const fetch = mock(async () => {
      throw new Error('Unexpected outbound request');
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    try {
      const runner = new AgentRunnerService(db);
      await expect(
        runner.runChatless({
          agentProviderId: row.id,
          agentInternalId: 'agent',
          sessionKey: 'session',
          messages: ['hello'],
        }),
      ).rejects.toThrow(REMOVED_OPENCLAW_MESSAGE);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test.each(['run', 'stream'] as const)('%s refuses a retained provider before producing a reply', async (mode) => {
    const { db } = fixture();
    const previousFetch = globalThis.fetch;
    const fetch = mock(async () => {
      throw new Error('Unexpected outbound request');
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    try {
      const runner = new AgentRunnerService(db);
      const context: AgentRunContext = {
        instance: { id: 'instance', agentProviderId: row.id, agentInternalId: 'agent' } as AgentRunContext['instance'],
        chatId: 'chat',
        senderId: 'sender',
        chatType: 'dm',
        messages: ['hello'],
      };
      const result = mode === 'stream' ? runner.stream(context).next() : runner.run(context);
      await expect(result).rejects.toMatchObject({ message: REMOVED_OPENCLAW_MESSAGE, statusCode: 410 });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('renaming a retained provider keeps the removal marker and secret masking in the PATCH response', async () => {
    const { app, providers, writes } = fixture({ writable: true });
    const response = await app.request(`/providers/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed-provider' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: AgentProvider };
    expect(body.data).toMatchObject({
      id: row.id,
      name: 'renamed-provider',
      schema: 'openclaw',
      lastHealthStatus: 'error',
      lastHealthError: REMOVED_OPENCLAW_MESSAGE,
      apiKey: '********',
      schemaConfig: { devicePrivateKey: '[REDACTED]', deviceToken: '[REDACTED]' },
    });
    expect((await providers.getByName('renamed-provider')).name).toBe('renamed-provider');
    expect(writes).toHaveBeenCalledTimes(1);
  });

  test('replacing a retained provider with a supported schema removes the read marker', async () => {
    const { app, providers } = fixture({ writable: true });
    const response = await app.request(`/providers/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schema: 'webhook', baseUrl: 'https://example.com/hook' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: AgentProvider };
    expect(body.data).toMatchObject({ id: row.id, schema: 'webhook', baseUrl: 'https://example.com/hook' });
    expect(body.data.lastHealthError).not.toBe(REMOVED_OPENCLAW_MESSAGE);
    expect((await providers.getById(row.id)).schema).toBe('webhook');
  });

  test('a retained provider can be deleted through the management API', async () => {
    const { app, writes } = fixture({ writable: true });
    const response = await app.request(`/providers/${row.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect((await app.request(`/providers/${row.id}`)).status).toBe(404);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['ws://example.com/gateway', 'http://example.com/health'],
    ['wss://example.com/gateway', 'https://example.com/health'],
    ['https://example.com/api', 'https://example.com/health'],
  ])('supported provider health converts %s to %s', async (baseUrl, expectedUrl) => {
    const { providers, writes } = fixture({ writable: true, provider: { ...row, schema: 'webhook', baseUrl } });
    const previousFetch = globalThis.fetch;
    const fetch = mock(async () => new Response('ok'));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    try {
      expect(await providers.checkHealth(row.id)).toMatchObject({ healthy: true });
      expect(fetch).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({ method: 'GET' }));
      expect(writes).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('read APIs keep legacy rows manageable and mask all retained secret fields', async () => {
    const { app } = fixture();
    for (const path of ['/providers', `/providers/${row.id}`]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(REMOVED_OPENCLAW_MESSAGE);
      expect(body).not.toContain('retained-token');
      expect(body).not.toContain('retained-private');
      expect(body).not.toContain('retained-device-token');
    }
  });

  test('new and update inputs refuse the legacy marker while read schemas retain it', async () => {
    const { app, providers, writes } = fixture();
    const data = { name: 'new-provider', schema: 'openclaw', baseUrl: 'https://example.com' };
    expect(CreateProviderSchema.safeParse(data).success).toBe(false);
    expect(ProviderSchema.shape.schema.parse('openclaw')).toBe('openclaw');
    for (const method of ['POST', 'PATCH']) {
      const response = await app.request(method === 'POST' ? '/providers' : `/providers/${row.id}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      expect(response.status).toBe(400);
    }
    await expect(providers.create(data as never)).rejects.toThrow(REMOVED_OPENCLAW_MESSAGE);
    await expect(providers.update(row.id, { schema: 'openclaw' })).rejects.toThrow(REMOVED_OPENCLAW_MESSAGE);
    expect(writes).not.toHaveBeenCalled();
    expect(PROVIDER_SCHEMAS).toEqual(['agno', 'webhook', 'ag-ui', 'claude-code', 'a2a', 'nats-genie']);
    for (const schema of PROVIDER_SCHEMAS) {
      expect(CreateProviderSchema.safeParse({ ...data, schema }).success).toBe(true);
    }
  });
});
