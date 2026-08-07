import { afterEach, describe, expect, test } from 'bun:test';
import { type Server, createServer } from 'node:net';
import {
  formatLifecycleFailure,
  runServiceStartSequence,
  waitForDatabaseReady,
  waitForTcpReady,
} from '../service-lifecycle.js';

describe('runServiceStartSequence', () => {
  test('runs dependencies before dependents', async () => {
    const calls: string[] = [];
    const pass = (name: string) => async () => {
      calls.push(name);
      return true;
    };

    const result = await runServiceStartSequence({
      checkDatabase: pass('database'),
      startNats: pass('nats-start'),
      checkNats: pass('nats-ready'),
      startApi: pass('api-start'),
      checkApi: pass('api-health'),
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['database', 'nats-start', 'nats-ready', 'api-start', 'api-health']);
  });

  test.each([
    ['database', 'database'],
    ['nats-start', 'nats-start'],
    ['nats-ready', 'nats-ready'],
    ['api-start', 'api-start'],
    ['api-health', 'api-health'],
  ] as const)('stops immediately when %s fails', async (failedCall, expectedPhase) => {
    const calls: string[] = [];
    const step = (name: string) => async () => {
      calls.push(name);
      return name !== failedCall;
    };

    const result = await runServiceStartSequence({
      checkDatabase: step('database'),
      startNats: step('nats-start'),
      checkNats: step('nats-ready'),
      startApi: step('api-start'),
      checkApi: step('api-health'),
    });

    expect(result).toEqual({ ok: false, phase: expectedPhase });
    expect(calls.at(-1)).toBe(failedCall);
  });

  test('formats an actionable message for every failure phase', () => {
    for (const phase of ['database', 'nats-start', 'nats-ready', 'api-start', 'api-health'] as const) {
      expect(formatLifecycleFailure({ ok: false, phase })).not.toBe('');
    }
  });

  test('stops immediately when a phase throws', async () => {
    const calls: string[] = [];
    const result = await runServiceStartSequence({
      checkDatabase: async () => {
        calls.push('database');
        return true;
      },
      startNats: async () => {
        calls.push('nats-start');
        throw new Error('pm2 failed');
      },
      checkNats: async () => {
        calls.push('nats-ready');
        return true;
      },
      startApi: async () => true,
      checkApi: async () => true,
    });

    expect(result).toEqual({ ok: false, phase: 'nats-start' });
    expect(calls).toEqual(['database', 'nats-start']);
  });
});

describe('readiness probes', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  test('TCP readiness succeeds only after a listener accepts connections', async () => {
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP address');

    expect(await waitForTcpReady('127.0.0.1', address.port, 100)).toBe(true);
  });

  test('TCP readiness times out when no listener is present', async () => {
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP address');
    const port = address.port;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;

    expect(await waitForTcpReady('127.0.0.1', port, 20)).toBe(false);
  });

  test('database readiness fails closed for an invalid URL', async () => {
    expect(await waitForDatabaseReady({ databaseUrl: 'not-a-postgres-url' }, 10)).toBe(false);
  });
});
