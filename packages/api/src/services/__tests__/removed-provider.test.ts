import { afterEach, describe, expect, mock, test } from 'bun:test';
import { PROVIDER_SCHEMAS, REMOVED_OPENCLAW_MESSAGE } from '@omni/core';
import type { AgentProvider, Database } from '@omni/db';
import { Hono } from 'hono';
import { __test__ as dispatcher, resolveProvider } from '../../plugins/agent-dispatcher';
import { providersRoutes } from '../../routes/v2/providers';
import { CreateProviderSchema, ProviderSchema } from '../../schemas/openapi/providers';
import type { AppVariables } from '../../types';
import { AgentRunnerService } from '../agent-runner';
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

function fixture() {
  const query = {
    from: () => query,
    where: () => query,
    $dynamic: () => query,
    limit: async () => [row],
    orderBy: async () => [row],
  };
  const writes = mock(() => {
    throw new Error('Unexpected database write');
  });
  const db = { select: () => query, insert: writes, update: writes, delete: writes } as unknown as Database;
  const providers = new ProviderService(db);
  const app = new Hono<{ Variables: AppVariables }>();
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
