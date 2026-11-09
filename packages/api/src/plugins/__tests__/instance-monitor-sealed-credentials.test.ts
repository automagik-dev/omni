import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChannelRegistry } from '@omni/channel-sdk';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { __resetInstanceOwnerRegistry, rememberInstanceOwners } from '../../tenancy/instance-owner-registry';
import { sealCredentialField } from '../../tenancy/sealed-credentials';
import { InstanceMonitor, reconnectWithPool } from '../instance-monitor';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const MASTER_KEY = Buffer.alloc(32, 7);
const SENDER_ID = '551140000000';

function chain<T>(result: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

function makeDb(rows: unknown[]): Database {
  const tx = { select: () => chain(rows), update: () => chain([]), execute: async () => [] };
  return {
    select: () => chain(rows),
    update: () => chain([]),
    transaction: async <T>(cb: (handle: unknown) => Promise<T>): Promise<T> => cb(tx),
    execute: async () => [],
  } as unknown as Database;
}

interface ConnectCapture {
  options: Array<Record<string, unknown>>;
  connected: Promise<void>;
  registry: ChannelRegistry;
}

function captureConnects(): ConnectCapture {
  const options: Array<Record<string, unknown>> = [];
  let resolveConnected: () => void = () => {};
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });
  const registry = {
    get: () => ({
      getStatus: async () => ({ state: 'disconnected' as const }),
      connect: async (_instanceId: string, config: { options?: Record<string, unknown> }) => {
        options.push(config.options ?? {});
        resolveConnected();
      },
    }),
  } as unknown as ChannelRegistry;
  return { options, connected, registry };
}

function zenviaRow(tenantId: string | null, sealedFor: string | null = tenantId) {
  return {
    id: 'i1',
    name: 'i1',
    channel: 'zenvia',
    ownerIdentifier: 'owner',
    tenantId,
    isActive: true,
    zenviaApiToken: sealCredentialField(sealedFor, 'zv-api-token'),
    zenviaSenderId: SENDER_ID,
    zenviaSalesApiKey: sealCredentialField(sealedFor, 'zv-sales-key'),
    webhookVerifyToken: sealCredentialField(sealedFor, 'zv-verify-token'),
  };
}

beforeEach(() => {
  setTenantSecretMasterKey(MASTER_KEY);
});

afterEach(() => {
  setTenantSecretMasterKey(null);
  __resetInstanceOwnerRegistry();
});

describe('instance-monitor — sealed zenvia credentials reach the plugin opened', () => {
  test('the startup reconnect opens the sealed token, sales key and webhook verify token', async () => {
    const capture = captureConnects();

    await reconnectWithPool(makeDb([zenviaRow(TENANT_A)]), capture.registry, { delayBetweenMs: 0 });

    expect(capture.options).toHaveLength(1);
    expect(capture.options[0]).toMatchObject({
      zenviaApiToken: 'zv-api-token',
      zenviaSenderId: SENDER_ID,
      zenviaSalesApiKey: 'zv-sales-key',
      webhookVerifyToken: 'zv-verify-token',
    });
  });

  test('a queued reconnect opens the sealed token, sales key and webhook verify token', async () => {
    const capture = captureConnects();
    const monitor = new InstanceMonitor(makeDb([zenviaRow(TENANT_A)]), capture.registry, { backoffBaseMs: 1 });
    rememberInstanceOwners([{ id: 'i1', tenantId: TENANT_A }]);

    monitor.scheduleReconnect('i1', 'zenvia', 'down');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await (monitor as unknown as { processReconnectQueue(): Promise<void> }).processReconnectQueue();
    await capture.connected;

    expect(capture.options).toHaveLength(1);
    expect(capture.options[0]).toMatchObject({
      zenviaApiToken: 'zv-api-token',
      zenviaSalesApiKey: 'zv-sales-key',
      webhookVerifyToken: 'zv-verify-token',
    });
  });

  test('a row sealed for another tenant is never handed over as the envelope', async () => {
    const capture = captureConnects();

    await reconnectWithPool(makeDb([zenviaRow(TENANT_B, TENANT_A)]), capture.registry, { delayBetweenMs: 0 });

    expect(capture.options).toHaveLength(1);
    expect(capture.options[0]?.zenviaApiToken).toBeUndefined();
    expect(JSON.stringify(capture.options[0])).not.toContain('"v":');
  });

  test('legacy plaintext rows are still handed over unchanged', async () => {
    const capture = captureConnects();
    const row = { ...zenviaRow(null), zenviaApiToken: 'plain-token', webhookVerifyToken: 'plain-verify' };

    await reconnectWithPool(makeDb([row]), capture.registry, { delayBetweenMs: 0 });

    expect(capture.options[0]).toMatchObject({ zenviaApiToken: 'plain-token', webhookVerifyToken: 'plain-verify' });
  });
});
