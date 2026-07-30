/**
 * The shared OpenClaw WS client pool is a CREDENTIAL cache (G5; ADR-0008).
 *
 * DEC-3 gave the dispatcher one WS connection per provider, keyed by
 * `provider.id` alone. That key was written before `agent_providers` carried
 * tenant-bound secrets. The cached `OpenClawClient` holds the Ed25519
 * `devicePrivateKey` and the `deviceToken` it was BUILT with, and signs every
 * connect with them (`@omni/core` `openclaw/client.ts`) — so the pooled object
 * is the credential, not merely a socket.
 *
 * `agent_providers` is a G0-`split` table with no `tenant_id`, so ONE provider
 * row is reachable from instances of different tenants, and `ProviderService`
 * binds its secrets to the ACTIVE SCOPE: tenant A opens the device key, every
 * other context fails closed to null ("fails closed to a null secret rather
 * than to someone else's key", providers.ts). A pool keyed by provider id alone
 * short-circuits exactly that null — the reachable path being
 * `routes/v2/chats.ts` → `session-cleaner.ts` `resolveProvider`, which builds
 * the client from secrets OPENED inside a tenant scope and then pools it
 * globally.
 *
 * So the key must carry the tenant the secrets were opened under. These probes
 * pin that, plus the two properties the change must not break: the scope-less
 * legacy world still shares ONE client per provider, and invalidation still
 * evicts EVERY tenant's client for a provider.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { __test__, invalidateProviderCache, resolveProvider } from '../agent-dispatcher';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';

interface CapturedClient {
  config: { token?: string; device?: { privateKey: string; token: string } };
  started: boolean;
  stopped: boolean;
}

const built: CapturedClient[] = [];

/** Stand-in for `OpenClawClient` — captures what it was built with, opens nothing. */
class FakeOpenClawClient {
  readonly captured: CapturedClient;
  constructor(config: CapturedClient['config']) {
    this.captured = { config, started: false, stopped: false };
    built.push(this.captured);
  }
  start(): void {
    this.captured.started = true;
  }
  stop(): void {
    this.captured.stopped = true;
  }
}

/** A provider row as `ProviderService` returns it AFTER opening under `tenant`. */
function providerOpenedFor(tenant: 'A' | 'foreign') {
  const owned = tenant === 'A';
  return {
    id: PROVIDER_ID,
    name: 'openclaw-provider',
    schema: 'openclaw',
    baseUrl: 'ws://openclaw.invalid',
    // Fail-closed nulls are exactly what a non-owning tenant sees.
    apiKey: owned ? 'sk-tenant-a' : null,
    isActive: true,
    defaultTimeout: 600,
    schemaConfig: {
      deviceId: 'device-1',
      devicePublicKey: 'ed25519-pub',
      devicePrivateKey: owned ? 'ed25519-priv-A' : null,
      deviceToken: owned ? 'device-token-A' : null,
      origin: 'https://openclaw.invalid',
      defaultAgentId: 'agent-1',
    },
  } as unknown as Parameters<typeof resolveProvider>[0];
}

function instance(id: string) {
  return {
    id,
    channel: 'discord',
    agentInternalId: 'agent-1',
    agentProviderId: PROVIDER_ID,
  } as unknown as Parameters<typeof resolveProvider>[1];
}

/** Worker-scope harness: `runInWorkerTenantScope` needs a transaction-capable handle. */
const db = {
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({ execute: async () => [] }),
  execute: async () => undefined,
} as unknown as Database;

afterEach(() => {
  built.length = 0;
  __test__.resetProviderCaches();
  __test__.resetOpenClawClientClass();
});

function useFakeClient(): void {
  __test__.OpenClawClientClass = FakeOpenClawClient as never;
}

describe('openclaw client pool — one client per (provider, tenant)', () => {
  test('tenant B never reaches tenant A’s device identity through the pool', async () => {
    useFakeClient();

    await runInWorkerTenantScope(db, TENANT_A, async () => {
      resolveProvider(providerOpenedFor('A'), instance('inst-a'), db);
    });
    await runInWorkerTenantScope(db, TENANT_B, async () => {
      // B's read of the same provider row fails closed to null secrets.
      resolveProvider(providerOpenedFor('foreign'), instance('inst-b'), db);
    });

    // Two clients, not one: the pool must not hand B the object A's key is in.
    expect(built.length).toBe(2);
    const forB = built[1];
    expect(forB?.config.device).toBeUndefined();
    expect(JSON.stringify(built[1])).not.toContain('ed25519-priv-A');
    expect(JSON.stringify(built[1])).not.toContain('device-token-A');
    expect(JSON.stringify(built[1])).not.toContain('sk-tenant-a');
    // And the pool says so structurally.
    expect(__test__.openclawPoolKeys().sort()).toEqual(
      [`${PROVIDER_ID}::${TENANT_A}`, `${PROVIDER_ID}::${TENANT_B}`].sort(),
    );
  });

  test('the NATS-consumer shape (tenant THREADED, no ambient scope) is partitioned too', () => {
    useFakeClient();

    // `session-cleaner.ts` opens the provider record inside `runTenantWorkDb`
    // and then resolves the provider OUTSIDE that scope, threading the trusted
    // tenant — so `currentTenantScope()` is null here for BOTH tenants. Keyed on
    // the ambient scope alone, A's device key would sit in the legacy bucket and
    // be handed straight to B.
    resolveProvider(providerOpenedFor('A'), instance('inst-a'), db, TENANT_A);
    resolveProvider(providerOpenedFor('foreign'), instance('inst-b'), db, TENANT_B);

    expect(built.length).toBe(2);
    expect(JSON.stringify(built[1])).not.toContain('ed25519-priv-A');
    expect(__test__.openclawPoolKeys().sort()).toEqual(
      [`${PROVIDER_ID}::${TENANT_A}`, `${PROVIDER_ID}::${TENANT_B}`].sort(),
    );
  });

  test('the same tenant still reuses ONE connection across its instances (DEC-3)', async () => {
    useFakeClient();

    await runInWorkerTenantScope(db, TENANT_A, async () => {
      resolveProvider(providerOpenedFor('A'), instance('inst-a1'), db);
      resolveProvider(providerOpenedFor('A'), instance('inst-a2'), db);
    });

    expect(built.length).toBe(1);
    expect(__test__.openclawPoolKeys()).toEqual([`${PROVIDER_ID}::${TENANT_A}`]);
  });

  test('the scope-less legacy world is byte-identical: one shared client', () => {
    useFakeClient();

    resolveProvider(providerOpenedFor('A'), instance('inst-legacy-1'), db);
    resolveProvider(providerOpenedFor('A'), instance('inst-legacy-2'), db);

    expect(built.length).toBe(1);
    expect(__test__.openclawPoolKeys()).toEqual([`${PROVIDER_ID}::-`]);
  });

  test('invalidation evicts EVERY tenant’s client for the provider', async () => {
    useFakeClient();

    await runInWorkerTenantScope(db, TENANT_A, async () => {
      resolveProvider(providerOpenedFor('A'), instance('inst-a'), db);
    });
    await runInWorkerTenantScope(db, TENANT_B, async () => {
      resolveProvider(providerOpenedFor('foreign'), instance('inst-b'), db);
    });

    invalidateProviderCache(PROVIDER_ID);

    expect(__test__.openclawPoolKeys()).toEqual([]);
    expect(built.every((c) => c.stopped)).toBe(true);
  });
});
