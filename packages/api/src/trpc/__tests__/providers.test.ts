/** Provider procedure responses and scopes match their REST counterparts. */
import { describe, expect, mock, test } from 'bun:test';
import type { AgentProvider } from '@omni/db';
import { Hono } from 'hono';
import { DEFAULT_TURN_SCOPES } from '../../constants/scopes';
import { scopeEnforcerMiddleware } from '../../middleware/scope-enforcer';
import { providersRoutes } from '../../routes/v2/providers';
import type { AppVariables } from '../../types';
import type { TrpcContext } from '../context';
import { appRouter } from '../router';

const ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER = Object.freeze({
  id: ID,
  name: 'example',
  schema: 'agno',
  baseUrl: 'https://provider.example.test',
  apiKey: 'example-api-key',
  schemaConfig: Object.freeze({
    agentId: 'assistant',
    model: 'example-model',
    devicePrivateKey: 'example-private-key',
    deviceToken: 'example-device-token',
    password: 'example-password',
    api_key: 'example-config-key',
    apiKey: 'example-camel-key',
    clientSecret: 'example-client-secret',
  }),
  isActive: true,
  defaultStream: true,
  defaultTimeout: 600,
  supportsStreaming: true,
  supportsImages: false,
  supportsAudio: false,
  supportsDocuments: false,
  description: null,
  tags: null,
  lastHealthCheck: null,
  lastHealthStatus: null,
  lastHealthError: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
}) satisfies AgentProvider;

const MASKED = {
  ...PROVIDER,
  apiKey: '********',
  schemaConfig: {
    agentId: 'assistant',
    model: 'example-model',
    devicePrivateKey: '[REDACTED]',
    deviceToken: '[REDACTED]',
    password: '[REDACTED]',
    api_key: '[REDACTED]',
    apiKey: '[REDACTED]',
    clientSecret: '[REDACTED]',
  },
};

function harness(scopes: string[] | null, provider: AgentProvider = PROVIDER) {
  const providers = {
    list: mock(async (_options: { active?: boolean }) => [provider]),
    getById: mock(async (_id: string) => provider),
    create: mock(async (_data: unknown) => provider),
    checkHealth: mock(async (_id: string) => ({ healthy: true, latency: 12 })),
  };
  const ctx = {
    services: { providers },
    apiKey: scopes ? { id: 'key', name: 'agent:example', scopes, instanceIds: [ID] } : null,
    eventBus: null,
    requestId: 'provider-test',
  } as unknown as TrpcContext;
  const caller = appRouter.createCaller(ctx);
  const rest = new Hono<{ Variables: AppVariables }>();
  rest.use('*', async (c, next) => {
    c.set('services', ctx.services);
    if (ctx.apiKey) c.set('apiKey', { ...ctx.apiKey, expiresAt: null });
    await next();
  });
  rest.use('*', scopeEnforcerMiddleware);
  rest.route('/api/v2/providers', providersRoutes);
  return { caller, providers, rest };
}

const createInput = {
  name: 'example',
  schema: 'agno' as const,
  baseUrl: 'https://provider.example.test',
  apiKey: 'example-api-key',
  schemaConfig: { api_key: 'example-config-key' },
};

describe('provider response parity', () => {
  test('list masks credentials and matches REST without modifying the service row', async () => {
    const { caller, providers, rest } = harness(['providers:read']);
    const result = await caller.providers.list({ active: true });
    expect(result).toEqual([MASKED]);
    expect(providers.list).toHaveBeenCalledWith({ active: true });
    const response = await rest.request('/api/v2/providers?active=true');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: JSON.parse(JSON.stringify(result)) });
    expect(PROVIDER.apiKey).toBe('example-api-key');
    expect(PROVIDER.schemaConfig?.deviceToken).toBe('example-device-token');
  });

  test('get masks credentials and matches REST', async () => {
    const { caller, providers, rest } = harness(['providers:read']);
    const result = await caller.providers.get({ id: ID });
    expect(result).toEqual(MASKED);
    expect(providers.getById).toHaveBeenCalledWith(ID);
    const response = await rest.request(`/api/v2/providers/${ID}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: JSON.parse(JSON.stringify(result)) });
  });

  for (const apiKey of [null, '']) {
    test(`list/get retain REST's absent-key shape (${JSON.stringify(apiKey)})`, async () => {
      const { caller } = harness(['providers:read'], { ...PROVIDER, apiKey, schemaConfig: null });
      expect((await caller.providers.list({}))[0]).toMatchObject({ apiKey: null, schemaConfig: null });
      expect(await caller.providers.get({ id: ID })).toMatchObject({ apiKey: null, schemaConfig: null });
    });
  }

  test('create accepts the REST write scope, persists input unchanged, and returns the masked row', async () => {
    const { caller, providers } = harness(['providers:write']);
    expect(await caller.providers.create(createInput)).toEqual(MASKED);
    expect(providers.create).toHaveBeenCalledWith(expect.objectContaining(createInput));
  });

  test('health uses the REST read scope and retains its result', async () => {
    const { caller, providers } = harness(['providers:read']);
    expect(await caller.providers.checkHealth({ id: ID })).toEqual({ healthy: true, latency: 12 });
    expect(providers.checkHealth).toHaveBeenCalledWith(ID);
  });
});

const calls = {
  list: (caller: ReturnType<typeof appRouter.createCaller>) => caller.providers.list({}),
  get: (caller: ReturnType<typeof appRouter.createCaller>) => caller.providers.get({ id: ID }),
  create: (caller: ReturnType<typeof appRouter.createCaller>) => caller.providers.create(createInput),
  checkHealth: (caller: ReturnType<typeof appRouter.createCaller>) => caller.providers.checkHealth({ id: ID }),
};

for (const [name, call] of Object.entries(calls)) {
  test(`narrow agent scope refuses providers.${name} before calling the service`, async () => {
    const { caller, providers } = harness([...DEFAULT_TURN_SCOPES]);
    await expect(call(caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const service of Object.values(providers)) expect(service).not.toHaveBeenCalled();
  });

  test(`providers.${name} requires authentication`, async () => {
    const { caller, providers } = harness(null);
    await expect(call(caller)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    for (const service of Object.values(providers)) expect(service).not.toHaveBeenCalled();
  });

  for (const scopes of [['providers:*'], ['*']]) {
    test(`${scopes[0]} covers providers.${name}`, async () => {
      const { caller } = harness(scopes);
      await expect(call(caller)).resolves.toBeDefined();
    });
  }
}

for (const scopes of [['providers:write'], ['admin:*']]) {
  for (const read of ['list', 'get', 'checkHealth'] as const) {
    test(`${scopes[0]} alone does not grant providers.${read}`, async () => {
      const { caller } = harness(scopes);
      await expect(calls[read](caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  }
}

for (const scopes of [['providers:read'], ['admin:*']]) {
  test(`${scopes[0]} alone does not grant provider creation`, async () => {
    const { caller, providers } = harness(scopes);
    await expect(caller.providers.create(createInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(providers.create).not.toHaveBeenCalled();
  });
}
