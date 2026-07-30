/**
 * `AgentRunnerService.getClient` must OPEN the sealed provider credential
 * (G5 deliverable (g); ADR-0008).
 *
 * `ProviderService` is where `agent_providers.api_key` is sealed and opened, but
 * it is not the only reader: the legacy dispatch fallback
 * (`agent-dispatcher.ts` `dispatchViaLegacy` → `services.agentRunner.run`) and
 * the `call_agent` automation action both reach `getClient`, which loads the row
 * itself and hands `apiKey` straight to `createProviderClient`.
 *
 * With sealing active that value is the AES-GCM ENVELOPE — a JSON string
 * carrying the ciphertext AND the tenant UUID — and `agno-client.ts` emits it as
 * `Authorization: Bearer …`. That is verbatim the outcome `sealed-credentials.ts`
 * says must never happen: ciphertext plus tenant identity in a third party's
 * request logs, and a 401 whose cause is invisible. Worse, sealing ROUTES
 * traffic here: when `ProviderService` cannot open the envelope it yields a null
 * key, the provider dispatch declines, and the fallback path re-reads the row raw.
 *
 * Both worlds are asserted. The legacy/plaintext half is the important one: it
 * is what proves the codec stayed inert, and it fails loudly if a future edit
 * made opening unconditional.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import * as omniCoreReal from '@omni/core';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { sealCredentialField } from '../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import { buildWorkerTenantContext } from '../../tenancy/worker-tenant-context';
import { AgentRunnerService } from '../agent-runner';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const MASTER_KEY = Buffer.alloc(32, 7);
const PLAINTEXT_KEY = 'sk-agno-live-0123456789';

/**
 * The credential handed to the provider-client factory — the exact value that
 * becomes `Authorization: Bearer …`.
 *
 * Recorded through a module mock rather than read off the returned client,
 * because bun's `mock.module` is process-wide and a sibling suite
 * (`plugins/__tests__/agent-dispatcher.test.ts`) replaces `createProviderClient`
 * with a stub that returns `{}`. This mock spreads the real module and
 * DELEGATES to the real factory, so it observes without changing behaviour for
 * this file or any file ordered after it.
 */
const factoryCalls: Array<{ apiKey: string }> = [];
// Captured BEFORE the mock installs: `omniCoreReal` is a live ESM namespace, so
// reading `.createProviderClient` off it afterwards would resolve to the wrapper
// and recurse forever.
const realCreateProviderClient = omniCoreReal.createProviderClient;
mock.module('@omni/core', () => ({
  ...omniCoreReal,
  createProviderClient: (config: { apiKey: string }) => {
    factoryCalls.push(config);
    return realCreateProviderClient(config as never);
  },
}));

afterEach(() => {
  setTenantSecretMasterKey(null);
  factoryCalls.length = 0;
});

/** A one-row `agent_providers` stand-in whose `api_key` is whatever we store. */
function makeDb(apiKey: string | null): Database {
  const row = {
    id: 'provider-1',
    name: 'agno',
    schema: 'agno',
    baseUrl: 'https://agno.example',
    apiKey,
    defaultTimeout: 600,
    isActive: true,
    schemaConfig: null,
  };
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [row],
        }),
      }),
    }),
  };
  return db as unknown as Database;
}

function inTenantScope<T>(db: Database, tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runInTenantScope(db, buildWorkerTenantContext(tenantId), fn);
}

/**
 * The credential the client was built with — what `AgnoClient` renders as
 * `Authorization: Bearer ${apiKey}` on every call, i.e. the bytes that would
 * leave the process.
 */
function bearer(): string {
  const last = factoryCalls.at(-1);
  if (!last) throw new Error('createProviderClient was never called');
  return last.apiKey;
}

/** `getClient` is private; the run path reaches it, and so does this. */
function getClient(service: AgentRunnerService, providerId: string): Promise<unknown> {
  return (service as unknown as { getClient: (id: string) => Promise<unknown> }).getClient(providerId);
}

describe('agent-runner — legacy world is byte-identical', () => {
  test('no key configured, plaintext row: the exact stored bytes reach the client', async () => {
    const db = makeDb(PLAINTEXT_KEY);
    await getClient(new AgentRunnerService(db), 'provider-1');
    expect(bearer()).toBe(PLAINTEXT_KEY);
  });

  test('KEY PRESENT but the row is legacy plaintext: still the exact stored bytes', async () => {
    // The transitional world G5 ships: sealing is enabled, but there is no
    // credential backfill, so plaintext rows must keep working untouched.
    setTenantSecretMasterKey(MASTER_KEY);
    const db = makeDb(PLAINTEXT_KEY);
    await inTenantScope(db, TENANT_A, () => getClient(new AgentRunnerService(db), 'provider-1'));
    expect(bearer()).toBe(PLAINTEXT_KEY);
  });

  test('KEY ABSENT, plaintext row, inside a scope: still the exact stored bytes', async () => {
    // No key means the codec is the identity function, so a tenant scope cannot
    // by itself change what a plaintext column produces. Without this probe "no
    // key" and "no tenant" would be indistinguishable.
    const db = makeDb(PLAINTEXT_KEY);
    await inTenantScope(db, TENANT_A, () => getClient(new AgentRunnerService(db), 'provider-1'));
    expect(bearer()).toBe(PLAINTEXT_KEY);
  });

  test('KEY WITHDRAWN with a sealed row: fails closed — the envelope is never forwarded', async () => {
    // Seal with a key, then withdraw it: the column now holds an envelope no
    // reader can open. `openCredentialField` returns null for exactly this
    // (sealed + no key), the same posture `ProviderService` takes, and null must
    // never degrade into "send the envelope".
    setTenantSecretMasterKey(MASTER_KEY);
    const sealed = sealCredentialField(TENANT_A, PLAINTEXT_KEY);
    setTenantSecretMasterKey(null);
    const db = makeDb(sealed);

    await expect(
      inTenantScope(db, TENANT_A, () => getClient(new AgentRunnerService(db), 'provider-1')),
    ).rejects.toThrow(/not available/i);
  });
});

describe('agent-runner — the sealed credential is OPENED, never forwarded', () => {
  test('sealed for the tenant whose scope is active: the client gets the PLAINTEXT', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const sealed = sealCredentialField(TENANT_A, PLAINTEXT_KEY);
    expect(sealed).not.toBe(PLAINTEXT_KEY);
    const db = makeDb(sealed);

    await inTenantScope(db, TENANT_A, () => getClient(new AgentRunnerService(db), 'provider-1'));

    expect(bearer()).toBe(PLAINTEXT_KEY);
    // The envelope carries the tenant UUID; neither it nor the ciphertext may
    // ever become an `Authorization: Bearer` value.
    expect(bearer()).not.toContain('"alg"');
    expect(bearer()).not.toContain(TENANT_A);
  });

  test('sealed for ANOTHER tenant: fails closed — no client, no envelope on the wire', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const db = makeDb(sealCredentialField(TENANT_A, PLAINTEXT_KEY));

    await expect(
      inTenantScope(db, TENANT_B, () => getClient(new AgentRunnerService(db), 'provider-1')),
    ).rejects.toThrow(/not available/i);
  });

  test('sealed but NO scope (the unscoped worker path): fails closed', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const db = makeDb(sealCredentialField(TENANT_A, PLAINTEXT_KEY));

    await expect(getClient(new AgentRunnerService(db), 'provider-1')).rejects.toThrow(/not available/i);
  });

  test('an absent key still raises the pre-existing "no API key configured" error', async () => {
    const db = makeDb(null);
    await expect(getClient(new AgentRunnerService(db), 'provider-1')).rejects.toThrow(/no API key configured/);
  });
});
