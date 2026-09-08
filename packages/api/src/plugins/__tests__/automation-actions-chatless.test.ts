/**
 * Chatless call_agent adapter (#1010, RFC #925 G4 runtime half).
 *
 * When the core action extracts a CHATLESS AgentCallContext (no instance, no
 * chat resolvable from the triggering event), the engine-deps `callAgent`
 * callback must resolve the provider from the AGENT row alone and land on
 * `agentRunner.runChatless` — never on the instance lookup or the chat-id
 * resolution of the chat-ful path.
 *
 * Pinned here:
 *   - no instances/chats read happens for a chatless context;
 *   - the agents row supplies provider id, dispatch type, provider-internal
 *     agent id (metadata.providerAgentId ?? configPath ?? name), and tenant;
 *   - a missing agent row or an agent without a provider fails with a clear
 *     error instead of dispatching;
 *   - config overrides (agentType, timeoutMs) reach runChatless;
 *   - the chat-ful path is untouched (still runs runOrStream via instance).
 */

import { describe, expect, test } from 'bun:test';
import type { AgentCallContext } from '@omni/core';
import type { Database } from '@omni/db';
import type { ChatlessRunContext } from '../../services/agent-runner';
import { buildAutomationEngineDeps } from '../automation-actions';

interface AgentRowShape {
  name: string;
  agentProviderId: string | null;
  agentType: string;
  metadata: Record<string, unknown> | null;
  configPath: string | null;
  tenantId: string | null;
}

interface Harness {
  deps: ReturnType<typeof buildAutomationEngineDeps>;
  chatlessRuns: ChatlessRunContext[];
  runOrStreamCalls: Array<Record<string, unknown>>;
  instanceLookups: string[];
  chatLookups: string[];
}

function harness(agentRow: AgentRowShape | null): Harness {
  const chatlessRuns: ChatlessRunContext[] = [];
  const runOrStreamCalls: Array<Record<string, unknown>> = [];
  const instanceLookups: string[] = [];
  const chatLookups: string[] = [];

  const selectChain = () => ({
    from: () => ({
      where: () => ({
        limit: async () => (agentRow ? [agentRow] : []),
      }),
    }),
  });
  const db = {
    select: selectChain,
    // A threaded tenant opens a short worker scope (one transaction per
    // discrete read block) — serve the same agent row inside it.
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({ execute: async () => [], select: selectChain }),
  } as unknown as Database;

  const services = {
    instances: {
      getById: async (id: string) => {
        instanceLookups.push(id);
        return { id, agentId: null, tenantId: null };
      },
    },
    chats: {
      getById: async (id: string) => {
        chatLookups.push(id);
        return { externalId: id };
      },
    },
    agentRunner: {
      runChatless: async (context: ChatlessRunContext) => {
        chatlessRuns.push(context);
        return {
          parts: ['done'],
          metadata: { runId: 'run-1', sessionId: context.sessionKey, status: 'completed' as const },
        };
      },
      runOrStream: async (context: Record<string, unknown>) => {
        runOrStreamCalls.push(context);
        return { parts: ['chat'], metadata: { runId: 'run-2', sessionId: 'sess', status: 'completed' as const } };
      },
    },
  } as unknown as Parameters<typeof buildAutomationEngineDeps>[0];

  return {
    deps: buildAutomationEngineDeps(services, db),
    chatlessRuns,
    runOrStreamCalls,
    instanceLookups,
    chatLookups,
  };
}

function chatlessContext(overrides: Partial<AgentCallContext> = {}): AgentCallContext {
  return {
    chatless: true,
    instanceId: '',
    agentId: 'agent-uuid-1',
    sessionKey: 'automation:auto-1:corr-1',
    automationId: 'auto-1',
    chatId: 'automation:auto-1:corr-1',
    senderId: 'automation:auto-1:corr-1',
    messages: ['{"type":"custom.github.push"}'],
    event: { id: 'evt-1', type: 'custom.github.push', correlationId: 'corr-1' },
    ...overrides,
  };
}

const AGENT_ROW: AgentRowShape = {
  name: 'triage',
  agentProviderId: 'prov-1',
  agentType: 'assistant',
  metadata: null,
  configPath: null,
  tenantId: null,
};

describe('automation-actions — chatless callAgent (#1010)', () => {
  test('resolves the provider from the agent row and dispatches runChatless — no instance/chat reads', async () => {
    const h = harness(AGENT_ROW);
    const result = await h.deps.callAgent(chatlessContext(), { agentId: 'agent-uuid-1' }, null);

    expect(h.instanceLookups).toEqual([]);
    expect(h.chatLookups).toEqual([]);
    expect(h.runOrStreamCalls).toEqual([]);
    expect(h.chatlessRuns).toHaveLength(1);
    const run = h.chatlessRuns[0];
    expect(run?.agentProviderId).toBe('prov-1');
    expect(run?.agentInternalId).toBe('triage'); // name fallback
    expect(run?.agentType).toBe('agent'); // assistant → agent
    expect(run?.sessionKey).toBe('automation:auto-1:corr-1');
    expect(run?.messages).toEqual(['{"type":"custom.github.push"}']);
    expect(run?.timeoutSeconds).toBeUndefined();

    expect(result.metadata.status).toBe('completed');
    expect(result.fullResponse).toBe('done');
  });

  test('provider-internal agent id prefers metadata.providerAgentId, then configPath, then name', async () => {
    const viaMetadata = harness({ ...AGENT_ROW, metadata: { providerAgentId: 'provider-internal' } });
    await viaMetadata.deps.callAgent(chatlessContext(), { agentId: 'agent-uuid-1' }, null);
    expect(viaMetadata.chatlessRuns[0]?.agentInternalId).toBe('provider-internal');

    const viaConfigPath = harness({ ...AGENT_ROW, configPath: '/agents/triage.md' });
    await viaConfigPath.deps.callAgent(chatlessContext(), { agentId: 'agent-uuid-1' }, null);
    expect(viaConfigPath.chatlessRuns[0]?.agentInternalId).toBe('/agents/triage.md');
  });

  test('config agentType and timeoutMs override the agent-row defaults', async () => {
    const h = harness({ ...AGENT_ROW, agentType: 'team' });
    await h.deps.callAgent(
      chatlessContext(),
      { agentId: 'agent-uuid-1', agentType: 'workflow', timeoutMs: 45500 },
      null,
    );
    expect(h.chatlessRuns[0]?.agentType).toBe('workflow');
    expect(h.chatlessRuns[0]?.timeoutSeconds).toBe(46);
  });

  test("the agent row's persisted tenant is threaded; trustedTenantId is the fallback", async () => {
    const TENANT_OWNED = '11111111-1111-4111-8111-1111111111aa';
    const TENANT_THREADED = '22222222-2222-4222-8222-2222222222bb';

    const owned = harness({ ...AGENT_ROW, tenantId: TENANT_OWNED });
    await owned.deps.callAgent(chatlessContext(), { agentId: 'agent-uuid-1' }, TENANT_THREADED);
    expect(owned.chatlessRuns[0]?.tenantId).toBe(TENANT_OWNED);

    const unowned = harness(AGENT_ROW);
    await unowned.deps.callAgent(chatlessContext(), { agentId: 'agent-uuid-1' }, TENANT_THREADED);
    expect(unowned.chatlessRuns[0]?.tenantId).toBe(TENANT_THREADED);
  });

  test('a missing agent row refuses the dispatch', async () => {
    const h = harness(null);
    await expect(h.deps.callAgent(chatlessContext(), { agentId: 'agent-uuid-1' }, null)).rejects.toThrow(
      'Agent not found: agent-uuid-1',
    );
    expect(h.chatlessRuns).toEqual([]);
  });

  test('an agent without a provider refuses the dispatch with a clear error', async () => {
    const h = harness({ ...AGENT_ROW, agentProviderId: null });
    await expect(h.deps.callAgent(chatlessContext(), { agentId: 'agent-uuid-1' }, null)).rejects.toThrow(
      /has no agent provider configured/,
    );
    expect(h.chatlessRuns).toEqual([]);
  });

  test('a chatless context without an agentId refuses the dispatch', async () => {
    const h = harness(AGENT_ROW);
    await expect(h.deps.callAgent(chatlessContext({ agentId: undefined }), { agentId: '' }, null)).rejects.toThrow(
      'chatless call_agent requires config.agentId',
    );
  });

  test('a chat-ful context still takes the instance path (runOrStream), untouched', async () => {
    const h = harness(AGENT_ROW);
    const ctx: AgentCallContext = {
      instanceId: 'inst-1',
      agentId: 'agent-uuid-1',
      chatId: 'chat-1',
      senderId: 'user-1',
      messages: ['hello'],
    };
    await h.deps.callAgent(ctx, { agentId: 'agent-uuid-1' }, null);
    expect(h.instanceLookups).toEqual(['inst-1']);
    expect(h.runOrStreamCalls).toHaveLength(1);
    expect(h.chatlessRuns).toEqual([]);
  });
});
