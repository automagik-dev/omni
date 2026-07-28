/**
 * Automation-engine action callbacks worker scope (wish: omni-full-multitenancy,
 * Group G5; ADR-0008).
 *
 * The engine invokes `sendMessage` / `callAgent` from a NATS consumer callback,
 * so until this leg their DB reads — `services.instances.getById`,
 * `services.chats.getById` and the DIRECT `agents` lookup — reached the ambient
 * pool even for a tenant-world envelope. That kept `services/chats.ts::chats`
 * and `services/instances.ts::instances` at `pending-G5-conversion` however
 * converted the services themselves were: a site is only as scoped as its
 * least-scoped caller (the run12 lesson).
 *
 * Contract probed here, per callback:
 *   * tenant world (engine threads the envelope's trusted tenant) — every DB
 *     read runs inside a short worker tenant scope for that tenant, one
 *     transaction per discrete read block (never one spanning the outbound side
 *     effect), and the direct `agents` read goes through `scopedHandle` so it
 *     lands on the scope's TRANSACTION, not the pool;
 *   * legacy world (nothing threaded) — zero transactions, every read on the
 *     ambient pool, byte-identical to the pre-extraction inline callbacks;
 *   * the outbound side effect (`plugin.sendMessage`, `agentRunner.runOrStream`)
 *     always executes AFTER the resolution scopes closed — a worker transaction
 *     must not outlive its work item (G4 leg-2 trap).
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { buildAutomationEngineDeps } from '../automation-actions';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const CHAT_UUID = '99999999-9999-4999-8999-999999999999';

const AGENT_ROW = {
  name: 'agent-name',
  agentProviderId: 'prov-1',
  agentType: 'assistant',
  metadata: {},
  configPath: null,
};

interface Harness {
  services: Parameters<typeof buildAutomationEngineDeps>[0];
  db: Database;
  /** tenant scope observed by each service-mediated DB read, in order */
  scopes: (string | null)[];
  /** tenant stamped by each worker transaction that opened */
  stamped: string[];
  /** which handle the DIRECT `agents` read ran on: scope tx or ambient pool */
  agentReadHandles: ('tx' | 'pool')[];
  /** tenant scope active at the moment the outbound side effect ran */
  sideEffectScopes: (string | null)[];
  /** what the plugin was asked to send */
  sent: Array<{ instanceId: string; to: string }>;
  /** the runOrStream context the agent runner received */
  runContexts: Array<Record<string, unknown>>;
  /** args the stale gate forwarded to the lifecycle service */
  gateArgs: Array<unknown[]>;
  deps: ReturnType<typeof buildAutomationEngineDeps>;
}

/** A chainable `select().from().where().limit()` that resolves to the agent row. */
function selectChain(onResolve: () => void) {
  return () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          onResolve();
          return [AGENT_ROW];
        },
      }),
    }),
  });
}

function harness(): Harness {
  const scopes: (string | null)[] = [];
  const stamped: string[] = [];
  const agentReadHandles: ('tx' | 'pool')[] = [];
  const sideEffectScopes: (string | null)[] = [];
  const sent: Array<{ instanceId: string; to: string }> = [];
  const runContexts: Array<Record<string, unknown>> = [];
  const gateArgs: Array<unknown[]> = [];

  const db = {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({
        execute: async (q: unknown) => {
          const text = JSON.stringify(q);
          const match = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.exec(text);
          if (match) stamped.push(match[0]);
          return [] as unknown;
        },
        select: selectChain(() => agentReadHandles.push('tx')),
      }),
    select: selectChain(() => agentReadHandles.push('pool')),
  } as unknown as Database;

  const observe = () => {
    scopes.push(currentTenantScope()?.tenantId ?? null);
  };

  const services = {
    instances: {
      getById: async (id: string) => {
        observe();
        return {
          id,
          channel: 'test-channel',
          agentId: 'agent-fk-uuid',
          agentSessionStrategy: 'per_chat',
          agentPrefixSenderName: true,
          agentTimeout: 600,
          agentStreamMode: false,
        };
      },
    },
    chats: {
      getById: async () => {
        observe();
        return { externalId: 'ext-5511999@s.whatsapp.net' };
      },
    },
    agentRunner: {
      runOrStream: async (context: Record<string, unknown>) => {
        sideEffectScopes.push(currentTenantScope()?.tenantId ?? null);
        runContexts.push(context);
        return { parts: ['ok'], metadata: { runId: 'run-1', sessionId: 'sess-1', status: 'completed' as const } };
      },
    },
    followUpLifecycle: {
      evaluateIdleTimeoutFreshness: async (...args: unknown[]) => {
        gateArgs.push(args);
        return { skip: false };
      },
    },
  } as unknown as Parameters<typeof buildAutomationEngineDeps>[0];

  const plugin = {
    sendMessage: async (instanceId: string, msg: { to: string }) => {
      sideEffectScopes.push(currentTenantScope()?.tenantId ?? null);
      sent.push({ instanceId, to: msg.to });
    },
  };

  const deps = buildAutomationEngineDeps(services, db, {
    resolvePlugin: async () => plugin as never,
  });

  return { services, db, scopes, stamped, agentReadHandles, sideEffectScopes, sent, runContexts, gateArgs, deps };
}

function expectAllScopes(scopes: (string | null)[], expected: string | null) {
  expect(scopes.length).toBeGreaterThan(0);
  for (const s of scopes) expect(s).toBe(expected);
}

describe('automation-actions callbacks scope their db reads (G5, ADR-0008)', () => {
  test('sendMessage: tenant world scopes the instance + chat reads, one tx per read block', async () => {
    const h = harness();
    await h.deps.sendMessage('inst-1', CHAT_UUID, 'hello', TENANT_A);

    expectAllScopes(h.scopes, TENANT_A);
    expect(h.scopes.length).toBe(2); // instance read + chat read
    expect(h.stamped).toEqual([TENANT_A, TENANT_A]); // one short tx each, never one spanning the send
    expect(h.sent).toEqual([{ instanceId: 'inst-1', to: 'ext-5511999@s.whatsapp.net' }]);
  });

  test('sendMessage: the outbound plugin call runs OUTSIDE any worker scope', async () => {
    const h = harness();
    await h.deps.sendMessage('inst-1', CHAT_UUID, 'hello', TENANT_A);
    expect(h.sideEffectScopes).toEqual([null]);
  });

  test('sendMessage: non-UUID recipient skips the chat read — a single tx', async () => {
    const h = harness();
    await h.deps.sendMessage('inst-1', '5511988887777@s.whatsapp.net', 'hello', TENANT_A);
    expect(h.scopes).toEqual([TENANT_A]); // instance read only
    expect(h.stamped).toEqual([TENANT_A]);
    expect(h.sent).toEqual([{ instanceId: 'inst-1', to: '5511988887777@s.whatsapp.net' }]);
  });

  test('sendMessage: legacy world leaves every read unscoped — zero transactions', async () => {
    const h = harness();
    await h.deps.sendMessage('inst-1', CHAT_UUID, 'hello');
    expectAllScopes(h.scopes, null);
    expect(h.stamped).toEqual([]);
    expect(h.sent).toEqual([{ instanceId: 'inst-1', to: 'ext-5511999@s.whatsapp.net' }]);
  });

  test('callAgent: tenant world scopes instance + chat + direct agents reads', async () => {
    const h = harness();
    const result = await h.deps.callAgent(
      { instanceId: 'inst-1', chatId: CHAT_UUID, senderId: CHAT_UUID, messages: ['hi'] },
      { agentId: '' },
      TENANT_A,
    );

    expectAllScopes(h.scopes, TENANT_A); // instance read + chat resolve
    expect(h.scopes.length).toBe(2);
    // The DIRECT agents lookup must land on the scope's TRANSACTION, not the pool.
    expect(h.agentReadHandles).toEqual(['tx']);
    expect(h.stamped).toEqual([TENANT_A, TENANT_A, TENANT_A]); // one short tx per read block
    expect(result.metadata.status).toBe('completed');
  });

  test('callAgent: the agent run executes OUTSIDE any worker scope', async () => {
    const h = harness();
    await h.deps.callAgent(
      { instanceId: 'inst-1', chatId: CHAT_UUID, senderId: CHAT_UUID, messages: ['hi'] },
      { agentId: '' },
      TENANT_A,
    );
    expect(h.sideEffectScopes).toEqual([null]);
  });

  test('callAgent: legacy world leaves every read unscoped on the pool — zero transactions', async () => {
    const h = harness();
    await h.deps.callAgent(
      { instanceId: 'inst-1', chatId: CHAT_UUID, senderId: CHAT_UUID, messages: ['hi'] },
      { agentId: '' },
    );
    expectAllScopes(h.scopes, null);
    expect(h.agentReadHandles).toEqual(['pool']);
    expect(h.stamped).toEqual([]);
  });

  test('callAgent: the run context handed to the agent runner is world-independent', async () => {
    const tenant = harness();
    await tenant.deps.callAgent(
      { instanceId: 'inst-1', chatId: CHAT_UUID, senderId: 'sender-9', senderName: 'S', messages: ['hi'] },
      { agentId: '', agentType: 'team' },
      TENANT_A,
    );
    const legacy = harness();
    await legacy.deps.callAgent(
      { instanceId: 'inst-1', chatId: CHAT_UUID, senderId: 'sender-9', senderName: 'S', messages: ['hi'] },
      { agentId: '', agentType: 'team' },
    );
    expect(tenant.runContexts).toEqual(legacy.runContexts);
  });

  test('staleIdleTimeoutGate: forwards the trusted tenant to the lifecycle gate', async () => {
    const h = harness();
    await h.deps.staleIdleTimeoutGate('chat-1', 'inst-1', 3, TENANT_A);
    expect(h.gateArgs).toEqual([['chat-1', 'inst-1', 3, TENANT_A]]);

    await h.deps.staleIdleTimeoutGate('chat-1', 'inst-1', null, null);
    expect(h.gateArgs[1]).toEqual(['chat-1', 'inst-1', null, null]);
  });
});
