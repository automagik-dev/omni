/**
 * `call_agent` must be able to dispatch to local claude-code providers (#929).
 *
 * The automation `call_agent` action lands on `AgentRunnerService`, which used
 * to (1) require a non-empty `apiKey` unconditionally and (2) build every
 * client through the HTTP factory path without `schemaConfig` — so a
 * `local://claude-code` provider that answers chats fine via message routing
 * failed with "Provider … has no API key configured" when an automation
 * invoked it.
 *
 * These tests pin the fix:
 *   * `getClient` builds a claude-code client with NO api key, from
 *     `schemaConfig` (projectPath), instead of throwing;
 *   * a sealed-but-unopenable credential still fails closed, even for
 *     claude-code;
 *   * `run()`/`stream()` map the strategy-computed session key to the
 *     provider's own session UUID through the same per-provider session store
 *     the message-routing dispatcher uses, so automations resume the very
 *     session the chat conversation runs in.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import * as omniCoreReal from '@omni/core';
import type { IAgentClient, ProviderResponse, StreamChunk } from '@omni/core';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { sealCredentialField } from '../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import { buildWorkerTenantContext } from '../../tenancy/worker-tenant-context';
import { type AgentRunContext, AgentRunnerService, type RunInstance } from '../agent-runner';

const PROVIDER_ID = 'cc-provider-1';
const CLAUDE_SESSION_UUID = '99999999-9999-4999-8999-999999999999';
const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

/**
 * What `getClient` hands the provider-client factory — the point the #929 fix
 * changes. Recorded through a module mock because bun's `mock.module` is
 * process-wide and sibling suites (`plugins/__tests__/agent-dispatcher*.test.ts`)
 * already replace `createProviderClient` with stubs; asserting on the RETURNED
 * client would depend on which suite's mock happens to be active. The mock
 * returns an inert client — no test in this file executes the built client.
 */
const factoryCalls: Array<{ schema: string; apiKey: string; schemaConfig?: Record<string, unknown> }> = [];
mock.module('@omni/core', () => ({
  ...omniCoreReal,
  createProviderClient: (config: { schema: string; apiKey: string; schemaConfig?: Record<string, unknown> }) => {
    factoryCalls.push(config);
    return { run: async () => ({}), stream: async function* () {} } as unknown as IAgentClient;
  },
}));

afterEach(() => {
  factoryCalls.length = 0;
});

/** A one-row `agent_providers` stand-in for a local claude-code provider. */
function providerDb(apiKey: string | null): Database {
  const row = {
    id: PROVIDER_ID,
    name: 'local claude',
    schema: 'claude-code',
    baseUrl: 'local://claude-code',
    apiKey,
    defaultTimeout: 600,
    isActive: true,
    schemaConfig: { projectPath: '/tmp/cc-project' },
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

/**
 * A db stand-in for the SESSION-STORE reads/writes `run()`/`stream()` issue
 * (the provider row is bypassed by stubbing `getClient`). Serves `stored` on
 * select and records every upsert.
 */
function sessionDb(
  stored: { sessionId: string } | null,
  upserts: Array<{ instanceId: string; sessionKey: string; sessionId: unknown }>,
): Database {
  const row = stored
    ? { providerSessionData: { sessionId: stored.sessionId }, lastUsedAt: new Date(), expiresAt: null }
    : null;
  const db: Record<string, unknown> = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: { instanceId: string; sessionKey: string; providerSessionData: { sessionId: unknown } }) => ({
        onConflictDoUpdate: async () => {
          upserts.push({
            instanceId: values.instanceId,
            sessionKey: values.sessionKey,
            sessionId: values.providerSessionData.sessionId,
          });
        },
      }),
    }),
  };
  return db as unknown as Database;
}

/** `getClient` is private; the run path reaches it, and so does this. */
function getClient(service: AgentRunnerService, providerId: string): Promise<{ client: IAgentClient; schema: string }> {
  return (
    service as unknown as { getClient: (id: string) => Promise<{ client: IAgentClient; schema: string }> }
  ).getClient(providerId);
}

/** Stub the private client resolution so run()/stream() exercise only the session flow. */
function stubClient(service: AgentRunnerService, client: IAgentClient): void {
  (service as unknown as { getClient: () => Promise<{ client: IAgentClient; schema: string }> }).getClient =
    async () => ({
      client,
      schema: 'claude-code',
    });
}

function runContext(): AgentRunContext {
  const instance = {
    id: 'inst-1',
    tenantId: null,
    agentProviderId: PROVIDER_ID,
    agentInternalId: 'claude-code',
    agentSessionStrategy: 'per_chat',
  } as unknown as RunInstance;
  return {
    instance,
    chatId: '5511999999999@s.whatsapp.net',
    senderId: '5511999999999@s.whatsapp.net',
    chatType: 'dm',
    messages: ['pong'],
  };
}

describe('agent-runner — claude-code providers dispatch without an API key (#929)', () => {
  test('getClient builds a client for a keyless local claude-code provider (was: 401)', async () => {
    const service = new AgentRunnerService(providerDb(null));
    const resolved = await getClient(service, PROVIDER_ID);
    expect(resolved.schema).toBe('claude-code');
    // The factory receives the schemaConfig it needs to build a ClaudeCodeClient
    // (projectPath), and no bearer credential is fabricated.
    expect(factoryCalls).toHaveLength(1);
    expect(factoryCalls[0]?.schema).toBe('claude-code');
    expect(factoryCalls[0]?.apiKey).toBe('');
    expect(factoryCalls[0]?.schemaConfig).toEqual({ projectPath: '/tmp/cc-project' });
  });

  test('a plaintext api key is still forwarded to the client config', async () => {
    // The key becomes the SDK's ANTHROPIC_API_KEY override.
    const service = new AgentRunnerService(providerDb('sk-ant-test'));
    await getClient(service, PROVIDER_ID);
    expect(factoryCalls[0]?.apiKey).toBe('sk-ant-test');
  });

  test('a sealed credential that cannot be opened still fails CLOSED', async () => {
    setTenantSecretMasterKey(Buffer.alloc(32, 7));
    try {
      const sealed = sealCredentialField(TENANT_A, 'sk-ant-test');
      const db = providerDb(sealed);
      const service = new AgentRunnerService(db);
      await expect(
        runInTenantScope(db, buildWorkerTenantContext(TENANT_B), () => getClient(service, PROVIDER_ID)),
      ).rejects.toThrow(/not available/i);
      expect(factoryCalls).toHaveLength(0);
    } finally {
      setTenantSecretMasterKey(null);
    }
  });
});

describe('agent-runner — claude-code session continuity with the dispatch path', () => {
  test('run() starts fresh when no session is stored, then persists the provider session UUID', async () => {
    const upserts: Array<{ instanceId: string; sessionKey: string; sessionId: unknown }> = [];
    const service = new AgentRunnerService(sessionDb(null, upserts));
    const seen: Array<{ sessionId?: string; mcpUrlParams?: Record<string, string> }> = [];
    stubClient(service, {
      run: mock(async (request: { sessionId?: string; mcpUrlParams?: Record<string, string> }) => {
        seen.push({ sessionId: request.sessionId, mcpUrlParams: request.mcpUrlParams });
        return {
          content: 'pong',
          runId: 'run-1',
          sessionId: CLAUDE_SESSION_UUID,
          status: 'completed',
        } as ProviderResponse;
      }),
    } as unknown as IAgentClient);

    const result = await service.run(runContext());

    // No stored session → the client must NOT receive the strategy key as a
    // resume target (Claude Code resumes only by its own UUID).
    expect(seen[0]?.sessionId).toBeUndefined();
    // Parity with the dispatcher: HTTP MCP servers get the chat identifier.
    expect(seen[0]?.mcpUrlParams).toEqual({ chat_id: '5511999999999@s.whatsapp.net' });
    // The returned UUID is persisted under the strategy key for the NEXT call.
    expect(upserts).toEqual([
      {
        instanceId: 'inst-1',
        sessionKey: `provider:${PROVIDER_ID}:session:5511999999999@s.whatsapp.net`,
        sessionId: CLAUDE_SESSION_UUID,
      },
    ]);
    expect(result.parts).toEqual(['pong']);
  });

  test('run() resumes the stored provider session UUID', async () => {
    const upserts: Array<{ instanceId: string; sessionKey: string; sessionId: unknown }> = [];
    const service = new AgentRunnerService(sessionDb({ sessionId: CLAUDE_SESSION_UUID }, upserts));
    const seen: Array<{ sessionId?: string }> = [];
    stubClient(service, {
      run: mock(async (request: { sessionId?: string }) => {
        seen.push({ sessionId: request.sessionId });
        return {
          content: 'pong',
          runId: 'run-2',
          sessionId: CLAUDE_SESSION_UUID,
          status: 'completed',
        } as ProviderResponse;
      }),
    } as unknown as IAgentClient);

    await service.run(runContext());

    expect(seen[0]?.sessionId).toBe(CLAUDE_SESSION_UUID);
  });

  test('stream() captures the provider session UUID from chunks and persists it', async () => {
    const upserts: Array<{ instanceId: string; sessionKey: string; sessionId: unknown }> = [];
    const service = new AgentRunnerService(sessionDb(null, upserts));
    stubClient(service, {
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { event: 'RunStarted', isComplete: false, sessionId: CLAUDE_SESSION_UUID };
        yield { event: 'RunCompleted', isComplete: true, fullContent: 'pong', sessionId: CLAUDE_SESSION_UUID };
      },
    } as unknown as IAgentClient);

    const parts: string[] = [];
    for await (const part of service.stream(runContext())) {
      parts.push(part);
    }

    expect(upserts).toEqual([
      {
        instanceId: 'inst-1',
        sessionKey: `provider:${PROVIDER_ID}:session:5511999999999@s.whatsapp.net`,
        sessionId: CLAUDE_SESSION_UUID,
      },
    ]);
  });
});
