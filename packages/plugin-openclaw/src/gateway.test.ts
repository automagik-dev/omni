import { afterEach, describe, expect, mock, test } from 'bun:test';
import { startOmniAccount } from './gateway.js';
import type { ChannelAccountSnapshot, ChannelGatewayContext, ResolvedOmniAccount } from './types.js';

function makeAccount(overrides: Partial<ResolvedOmniAccount> = {}): ResolvedOmniAccount {
  return {
    accountId: 'test-1',
    enabled: true,
    configured: true,
    apiUrl: 'https://omni.example.com',
    apiKey: 'key-123',
    instanceId: 'inst-1',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ChannelGatewayContext> = {}): ChannelGatewayContext & {
  controller: AbortController;
  statuses: ChannelAccountSnapshot[];
  logMessages: { level: string; msg: string }[];
} {
  const controller = new AbortController();
  const statuses: ChannelAccountSnapshot[] = [];
  const logMessages: { level: string; msg: string }[] = [];
  const account = overrides.account ?? makeAccount();
  const ctx: ChannelGatewayContext & {
    controller: AbortController;
    statuses: ChannelAccountSnapshot[];
    logMessages: { level: string; msg: string }[];
  } = {
    cfg: {
      channels: {
        omni: {
          accounts: { 'test-1': { apiUrl: account.apiUrl, apiKey: account.apiKey, instanceId: account.instanceId } },
        },
      },
    },
    accountId: account.accountId,
    account,
    runtime: {},
    abortSignal: controller.signal,
    log: {
      info: (msg: string) => logMessages.push({ level: 'info', msg }),
      warn: (msg: string) => logMessages.push({ level: 'warn', msg }),
      error: (msg: string) => logMessages.push({ level: 'error', msg }),
      debug: (msg: string) => logMessages.push({ level: 'debug', msg }),
    },
    getStatus: () => statuses[statuses.length - 1] ?? { accountId: account.accountId },
    setStatus: (next: ChannelAccountSnapshot) => statuses.push(next),
    controller,
    statuses,
    logMessages,
    ...overrides,
  };
  return ctx;
}

describe('startOmniAccount', () => {
  // We mock global fetch for health check tests
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sets status to running on start', async () => {
    // Arrange: mock fetch to succeed, then immediately abort
    globalThis.fetch = mock(() => Promise.resolve(new Response('ok', { status: 200 }))) as unknown as typeof fetch;

    const ctx = makeCtx();
    // Start the gateway, then abort almost immediately
    const promise = startOmniAccount(ctx);
    // Allow the initial health check to complete
    await Bun.sleep(10);
    ctx.controller.abort();
    await promise;

    // The first setStatus call should mark running: true
    expect(ctx.statuses.length).toBeGreaterThanOrEqual(2);
    expect(ctx.statuses[0]?.running).toBe(true);
    expect(ctx.statuses[0]?.lastStartAt).toBeTypeOf('number');
    expect(ctx.statuses[0]?.baseUrl).toBe('https://omni.example.com');
  });

  test('sets status to not running on abort', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('ok', { status: 200 }))) as unknown as typeof fetch;

    const ctx = makeCtx();
    const promise = startOmniAccount(ctx);
    await Bun.sleep(10);
    ctx.controller.abort();
    await promise;

    // Last status should be running: false
    const last = ctx.statuses[ctx.statuses.length - 1];
    expect(last?.running).toBe(false);
    expect(last?.lastStopAt).toBeTypeOf('number');
  });

  test('calls fetch with health endpoint', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response('ok', { status: 200 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const ctx = makeCtx();
    const promise = startOmniAccount(ctx);
    await Bun.sleep(10);
    ctx.controller.abort();
    await promise;

    expect(fetchMock).toHaveBeenCalled();
    const firstCallArgs = fetchMock.mock.calls[0] as unknown[];
    expect(firstCallArgs[0]).toBe('https://omni.example.com/health');
  });

  test('logs warning on non-ok health response', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('bad', { status: 503 }))) as unknown as typeof fetch;

    const ctx = makeCtx();
    const promise = startOmniAccount(ctx);
    await Bun.sleep(10);
    ctx.controller.abort();
    await promise;

    const warns = ctx.logMessages.filter((m) => m.level === 'warn');
    expect(warns.some((w) => w.msg.includes('503'))).toBe(true);
  });

  test('logs warning on fetch failure without crashing', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;

    const ctx = makeCtx();
    const promise = startOmniAccount(ctx);
    await Bun.sleep(10);
    ctx.controller.abort();
    await promise;

    const warns = ctx.logMessages.filter((m) => m.level === 'warn');
    expect(warns.some((w) => w.msg.includes('network down'))).toBe(true);
  });

  test('resolves immediately if abortSignal is already aborted', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('ok', { status: 200 }))) as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx({ abortSignal: controller.signal });

    // Should not hang
    await startOmniAccount(ctx);

    // Should still have set running then stopped
    const last = ctx.statuses[ctx.statuses.length - 1];
    expect(last?.running).toBe(false);
  });

  test('logs starting message', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('ok', { status: 200 }))) as unknown as typeof fetch;

    const ctx = makeCtx();
    const promise = startOmniAccount(ctx);
    await Bun.sleep(10);
    ctx.controller.abort();
    await promise;

    const infos = ctx.logMessages.filter((m) => m.level === 'info');
    expect(infos.some((i) => i.msg.includes('starting health monitor'))).toBe(true);
  });

  test('logs stopped message on abort', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('ok', { status: 200 }))) as unknown as typeof fetch;

    const ctx = makeCtx();
    const promise = startOmniAccount(ctx);
    await Bun.sleep(10);
    ctx.controller.abort();
    await promise;

    const infos = ctx.logMessages.filter((m) => m.level === 'info');
    expect(infos.some((i) => i.msg.includes('health monitor stopped'))).toBe(true);
  });
});
