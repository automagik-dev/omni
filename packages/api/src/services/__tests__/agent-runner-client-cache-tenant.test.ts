/**
 * `AgentRunnerService`'s provider-client cache is a CREDENTIAL cache (G5; ADR-0008).
 *
 * The cached `IAgentClient` is built with the provider row's `api_key` and sends
 * it as that provider's bearer credential on every call. `agent_providers` is a
 * G0-`split` table with no `tenant_id`, so ONE provider row is reachable from
 * instances of different tenants — a cache keyed by provider id alone serves the
 * first caller's client, and its key, to every later tenant.
 *
 * These probes pin the partitioning and the two properties it must not break:
 * one client per provider WITHIN a tenant, and a scope-less legacy world that
 * still shares exactly one.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { AgentRunnerService } from '../agent-runner';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';

/** A db whose only job is to return the one provider row, plus transaction support. */
function fakeDb(): Database {
  const row = {
    id: PROVIDER_ID,
    name: 'p',
    schema: 'agno',
    baseUrl: 'https://agno.invalid',
    apiKey: 'sk-provider',
    defaultTimeout: 600,
    isActive: true,
  };
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [row] }) }),
    }),
  };
  return db as unknown as Database;
}

/** `getClient` is private; the probe is about its CACHE KEY, so reach it directly. */
function getClient(svc: AgentRunnerService, providerId: string) {
  return (svc as unknown as { getClient: (id: string) => Promise<unknown> }).getClient(providerId);
}

function cacheKeys(svc: AgentRunnerService): string[] {
  return [...(svc as unknown as { clientCache: Map<string, unknown> }).clientCache.keys()];
}

describe('agent-runner client cache — one client per (provider, tenant)', () => {
  test('two tenants asking for the same provider do not share a client', async () => {
    const svc = new AgentRunnerService(fakeDb());

    const asA = await runInWorkerTenantScope(fakeDb(), TENANT_A, () => getClient(svc, PROVIDER_ID));
    const asB = await runInWorkerTenantScope(fakeDb(), TENANT_B, () => getClient(svc, PROVIDER_ID));

    expect(asA).not.toBe(asB);
    expect(cacheKeys(svc).sort()).toEqual([`${PROVIDER_ID}::${TENANT_A}`, `${PROVIDER_ID}::${TENANT_B}`].sort());
  });

  test('the same tenant reuses its client, and the legacy world keeps exactly one', async () => {
    const svc = new AgentRunnerService(fakeDb());

    const first = await runInWorkerTenantScope(fakeDb(), TENANT_A, () => getClient(svc, PROVIDER_ID));
    const second = await runInWorkerTenantScope(fakeDb(), TENANT_A, () => getClient(svc, PROVIDER_ID));
    expect(first).toBe(second);

    const legacySvc = new AgentRunnerService(fakeDb());
    const legacy1 = await getClient(legacySvc, PROVIDER_ID);
    const legacy2 = await getClient(legacySvc, PROVIDER_ID);
    expect(legacy1).toBe(legacy2);
    expect(cacheKeys(legacySvc)).toEqual([`${PROVIDER_ID}::-`]);
  });

  test('clearCache(providerId) drops EVERY tenant’s client for that provider', async () => {
    const svc = new AgentRunnerService(fakeDb());

    await runInWorkerTenantScope(fakeDb(), TENANT_A, () => getClient(svc, PROVIDER_ID));
    await runInWorkerTenantScope(fakeDb(), TENANT_B, () => getClient(svc, PROVIDER_ID));
    expect(cacheKeys(svc).length).toBe(2);

    svc.clearCache(PROVIDER_ID);
    expect(cacheKeys(svc)).toEqual([]);
  });
});
