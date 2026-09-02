/**
 * A provider update/delete must evict `AgentRunnerService.clientCache`.
 *
 * That cache holds an `IAgentClient` built with the provider row's `api_key`
 * and `base_url`. `ProviderService.update` already evicted the dispatcher's
 * provider cache but never the runner's, so on the legacy `run()`/`stream()`
 * path and the `call_agent` automation action a rotated key kept being sent
 * until the process restarted. These probes pin the hook the service container
 * wires (`providers.onProviderChanged(id => agentRunner.clearCache(id))`).
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { AgentRunnerService } from '../agent-runner';
import { ProviderService } from '../providers';

const PROVIDER_A = '33333333-3333-4333-8333-333333333333';
const PROVIDER_B = '44444444-4444-4444-8444-444444444444';

function providerRow(id: string) {
  return {
    id,
    name: `provider-${id.slice(0, 8)}`,
    schema: 'agno',
    baseUrl: 'https://agno.invalid',
    apiKey: 'sk-provider',
    defaultTimeout: 600,
    isActive: true,
  };
}

/**
 * Enough of a Database for getClient (select) and update/delete (returning).
 * The runner keys its cache on the REQUESTED provider id, so one canned row
 * serves every lookup.
 */
function fakeDb(): Database {
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [providerRow(PROVIDER_A)] }) }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => [providerRow(PROVIDER_A)] }) }),
    }),
    delete: () => ({ where: () => ({ returning: async () => [providerRow(PROVIDER_A)] }) }),
  };
  return db as unknown as Database;
}

/** `getClient` is private; the probe is about the cache it fills. */
function getClient(svc: AgentRunnerService, providerId: string) {
  return (svc as unknown as { getClient: (id: string) => Promise<unknown> }).getClient(providerId);
}

function cacheKeys(svc: AgentRunnerService): string[] {
  return [...(svc as unknown as { clientCache: Map<string, unknown> }).clientCache.keys()];
}

function wire() {
  const db = fakeDb();
  const agentRunner = new AgentRunnerService(db);
  const providers = new ProviderService(db);
  providers.onProviderChanged((providerId) => agentRunner.clearCache(providerId));
  return { agentRunner, providers };
}

describe('ProviderService → AgentRunnerService.clientCache eviction', () => {
  test('update evicts the cached client for that provider only', async () => {
    const { agentRunner, providers } = wire();
    await getClient(agentRunner, PROVIDER_A);
    await getClient(agentRunner, PROVIDER_B);
    expect(cacheKeys(agentRunner).some((k) => k.startsWith(`${PROVIDER_A}::`))).toBe(true);
    expect(cacheKeys(agentRunner).some((k) => k.startsWith(`${PROVIDER_B}::`))).toBe(true);

    await providers.update(PROVIDER_A, { apiKey: 'sk-rotated' });

    expect(cacheKeys(agentRunner).some((k) => k.startsWith(`${PROVIDER_A}::`))).toBe(false);
    expect(cacheKeys(agentRunner).some((k) => k.startsWith(`${PROVIDER_B}::`))).toBe(true);
  });

  test('a fresh client is built after the update (not the pre-rotation one)', async () => {
    const { agentRunner, providers } = wire();
    const before = await getClient(agentRunner, PROVIDER_A);

    await providers.update(PROVIDER_A, { apiKey: 'sk-rotated' });
    const after = await getClient(agentRunner, PROVIDER_A);

    expect(after).not.toBe(before);
  });

  test('delete evicts the cached client', async () => {
    const { agentRunner, providers } = wire();
    await getClient(agentRunner, PROVIDER_A);

    await providers.delete(PROVIDER_A);

    expect(cacheKeys(agentRunner).some((k) => k.startsWith(`${PROVIDER_A}::`))).toBe(false);
  });

  test('every registered invalidator runs, and one throwing does not break the write', async () => {
    const db = fakeDb();
    const providers = new ProviderService(db);
    const seen: string[] = [];
    providers.onProviderChanged(() => {
      throw new Error('boom');
    });
    providers.onProviderChanged((id) => seen.push(id));

    const updated = await providers.update(PROVIDER_A, { apiKey: 'sk-rotated' });

    expect(updated.id).toBe(PROVIDER_A);
    expect(seen).toEqual([PROVIDER_A]);
  });
});
