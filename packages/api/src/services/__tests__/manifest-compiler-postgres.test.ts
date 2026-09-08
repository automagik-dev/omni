/**
 * Manifest compilation + reconciliation over real PostgreSQL (issue #986,
 * RFC #925 G4b).
 *
 * Proves migration 0063 and the full G4b loop against a disposable database
 * with every migration applied:
 *
 *   * applying a manifest compiles one MANAGED automation per accepts entry
 *     (deterministic name, filter → eq/AND conditions, call_agent action,
 *     `managed_by_agent_id` provenance);
 *   * recompiling an unchanged manifest is a strict no-op — same rows, same
 *     updatedAt, no `system.agent.manifest.compiled` event;
 *   * a manifest change creates/deletes exactly the diff and keeps unchanged
 *     rows (stable ids);
 *   * out-of-band drift on a managed row is converged back to the manifest;
 *   * AutomationService rejects manual mutation of managed rows (409-mapped
 *     ConflictError) while hand-made rows stay fully mutable and untouched
 *     by reconciliation;
 *   * agent soft delete tears the compiled plan down; a hard DELETE of the
 *     agents row cascades via the 0063 FK;
 *   * end to end: an event consumed by the automation engine fires the
 *     compiled automation's call_agent to the declaring agent, honoring the
 *     compiled filter conditions.
 *
 * Set `OMNI_G1_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type {
  AgentEventManifest,
  Automation as CoreAutomation,
  EventBus,
  IAgentClient,
  OmniEvent,
  ProviderRequest,
  ProviderResponse,
  Subscription,
} from '@omni/core';
import { ConflictError, createAutomationEngine } from '@omni/core';
import { type Database, agentProviders, automations, createDbHandle } from '@omni/db';
import { agents as agentsTable } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { buildAutomationEngineDeps } from '../../plugins/automation-actions';
import { AgentService } from '../agents';
import { AutomationService } from '../automations';
import { createServices } from '../index';
import { ManifestCompilerService } from '../manifest-compiler';

const superUrl = process.env.OMNI_G1_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G1_PSQL_BIN ?? 'psql';

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** An EventBus fake that records publishes for assertions. */
function recordingBus(events: PublishedEvent[]): EventBus {
  return {
    publishGeneric: async (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID(), ok: true };
    },
  } as unknown as EventBus;
}

const manifest: AgentEventManifest = {
  accepts: [
    { event: 'custom.clickup.task.status_changed', filter: { list_id: '901300373349' } },
    { event: 'message.received' },
  ],
  publishes: [{ event: 'custom.review.parecer.ready' }],
};

postgresDescribe('manifest compilation + reconciliation (real PostgreSQL)', () => {
  const dbName = `omni_986_compiler_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let journal: PublishedEvent[];
  let agentService: AgentService;
  let automationService: AutomationService;

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;

    journal = [];
    const bus = recordingBus(journal);
    automationService = new AutomationService(db, bus);
    agentService = new AgentService(db, bus);
    agentService.setManifestReconciler(new ManifestCompilerService(bus, automationService));
  });

  afterAll(async () => {
    for (const close of closers) await close();
  });

  async function compiledRows(agentId: string) {
    return db.select().from(automations).where(eq(automations.managedByAgentId, agentId));
  }

  function compiledEvents(): PublishedEvent[] {
    return journal.filter((event) => event.type === 'system.agent.manifest.compiled');
  }

  test('applying a manifest compiles one managed automation per accepts entry', async () => {
    const agent = await agentService.create({ name: 'compiler-apply-agent', provider: 'claude' });
    journal.length = 0;

    await agentService.updateManifest(agent.id, manifest);

    const rows = await compiledRows(agent.id);
    expect(rows).toHaveLength(2);

    const filtered = rows.find((row) => row.triggerEventType === 'custom.clickup.task.status_changed');
    expect(filtered).toBeDefined();
    expect(filtered?.name).toStartWith(`manifest:${agent.id}:custom.clickup.task.status_changed#`);
    expect(filtered?.triggerConditions).toEqual([{ field: 'list_id', operator: 'eq', value: '901300373349' }]);
    expect(filtered?.conditionLogic).toBe('and');
    expect(filtered?.actions).toEqual([{ type: 'call_agent', config: { agentId: agent.id } }]);
    expect(filtered?.enabled).toBe(true);

    const unfiltered = rows.find((row) => row.triggerEventType === 'message.received');
    expect(unfiltered?.triggerConditions).toBeNull();

    expect(journal.map((event) => event.type)).toEqual([
      'system.agent.manifest.updated',
      'system.agent.manifest.compiled',
    ]);
    expect(compiledEvents()[0]?.payload).toMatchObject({ agentId: agent.id, created: 2, updated: 0, deleted: 0 });
  });

  test('recompiling an unchanged manifest is a strict no-op: no churn, no events', async () => {
    const agent = await agentService.create({ name: 'compiler-noop-agent', provider: 'claude' });
    await agentService.updateManifest(agent.id, manifest);

    const before = await compiledRows(agent.id);
    journal.length = 0;

    await agentService.updateManifest(agent.id, manifest);

    const after = await compiledRows(agent.id);
    // Same rows: identical ids AND identical updatedAt — zero row churn.
    const key = (rows: typeof after) => rows.map((row) => `${row.id}:${row.updatedAt.toISOString()}`).sort();
    expect(key(after)).toEqual(key(before));

    // Only the manifest.updated state-change event — no compiled event.
    expect(journal.map((event) => event.type)).toEqual(['system.agent.manifest.updated']);
  });

  test('a manifest change creates/deletes exactly the diff and keeps unchanged rows', async () => {
    const agent = await agentService.create({ name: 'compiler-diff-agent', provider: 'claude' });
    await agentService.updateManifest(agent.id, manifest);
    const before = await compiledRows(agent.id);
    const keptId = before.find((row) => row.triggerEventType === 'message.received')?.id;
    journal.length = 0;

    const next: AgentEventManifest = {
      accepts: [{ event: 'message.received' }, { event: 'chat.archived' }],
      publishes: [],
    };
    await agentService.updateManifest(agent.id, next);

    const after = await compiledRows(agent.id);
    expect(after.map((row) => row.triggerEventType).sort()).toEqual(['chat.archived', 'message.received']);
    // The unchanged declaration keeps its row (stable id).
    expect(after.find((row) => row.triggerEventType === 'message.received')?.id).toBe(keptId);
    expect(compiledEvents()[0]?.payload).toMatchObject({ created: 1, updated: 0, deleted: 1 });
  });

  test('out-of-band drift on a managed row is converged back to the manifest', async () => {
    const agent = await agentService.create({ name: 'compiler-drift-agent', provider: 'claude' });
    await agentService.updateManifest(agent.id, manifest);
    const [row] = await compiledRows(agent.id);
    expect(row).toBeDefined();
    if (!row) throw new Error('expected a compiled row');

    // Drift the row behind the service's back (raw SQL path).
    await db.update(automations).set({ enabled: false, priority: 99 }).where(eq(automations.id, row.id));
    journal.length = 0;

    await agentService.updateManifest(agent.id, manifest);

    const [converged] = (await compiledRows(agent.id)).filter((candidate) => candidate.id === row.id);
    expect(converged?.enabled).toBe(true);
    expect(converged?.priority).toBe(0);
    expect(compiledEvents()[0]?.payload).toMatchObject({ created: 0, updated: 1, deleted: 0 });
  });

  test('manual mutation of managed rows is rejected; hand-made rows stay mutable and untouched', async () => {
    const agent = await agentService.create({ name: 'compiler-protect-agent', provider: 'claude' });
    await agentService.updateManifest(agent.id, manifest);
    const [managed] = await compiledRows(agent.id);
    if (!managed) throw new Error('expected a compiled row');

    expect(automationService.update(managed.id, { name: 'hand edit' })).rejects.toThrow(ConflictError);
    expect(automationService.delete(managed.id)).rejects.toThrow(ConflictError);
    expect(automationService.disable(managed.id)).rejects.toThrow(ConflictError);

    // A hand-made automation on the SAME trigger is invisible to reconciliation.
    const handMade = await automationService.create({
      name: 'hand-made sibling',
      triggerEventType: 'message.received',
      actions: [{ type: 'log', config: { level: 'info', message: 'hi' } }],
    });
    await agentService.updateManifest(agent.id, manifest);
    const survivor = await automationService.getById(handMade.id);
    expect(survivor.name).toBe('hand-made sibling');
    await automationService.update(handMade.id, { name: 'renamed by hand' });
    await automationService.delete(handMade.id);
  });

  test('agent soft delete tears the compiled plan down', async () => {
    const agent = await agentService.create({ name: 'compiler-softdelete-agent', provider: 'claude' });
    await agentService.updateManifest(agent.id, manifest);
    expect(await compiledRows(agent.id)).toHaveLength(2);
    journal.length = 0;

    await agentService.delete(agent.id);

    expect(await compiledRows(agent.id)).toHaveLength(0);
    expect(compiledEvents()[0]?.payload).toMatchObject({ created: 0, updated: 0, deleted: 2 });
  });

  test('hard-deleting the agent row cascades compiled automations (0063 FK)', async () => {
    const agent = await agentService.create({ name: 'compiler-cascade-agent', provider: 'claude' });
    await agentService.updateManifest(agent.id, manifest);
    expect(await compiledRows(agent.id)).toHaveLength(2);

    await db.delete(agentsTable).where(eq(agentsTable.id, agent.id));

    expect(await compiledRows(agent.id)).toHaveLength(0);
  });

  test('end to end: a matching event fires the compiled call_agent to the declaring agent', async () => {
    const agent = await agentService.create({ name: 'compiler-e2e-agent', provider: 'claude' });
    await agentService.updateManifest(agent.id, {
      accepts: [{ event: 'custom.clickup.task.status_changed', filter: { list_id: 'L-1' } }],
      publishes: [],
    });

    // Engine harness: capture subscriptions so events can be delivered
    // directly, record call_agent dispatches.
    const handlers = new Map<string, (event: OmniEvent) => Promise<void>>();
    const engineBus = {
      publishGeneric: async () => ({ id: 'pub' }),
      subscribePattern: async (pattern: string, handler: (event: OmniEvent) => Promise<void>) => {
        handlers.set(pattern, handler);
        return { unsubscribe: async () => {} } as Subscription;
      },
    } as unknown as EventBus;

    const agentCalls: Array<{ agentId?: string; configAgentId: string }> = [];
    const engine = createAutomationEngine({ defaultConcurrency: 1, reconcileIntervalMs: 0 });
    engine.setLogger(async () => {});
    const enabled = (await automationService.list({ enabled: true })).filter(
      (row) => row.managedByAgentId === agent.id,
    );
    expect(enabled).toHaveLength(1);
    await engine.start(engineBus, enabled as unknown as CoreAutomation[], {
      callAgent: async (ctx, config) => {
        agentCalls.push({ agentId: ctx.agentId, configAgentId: config.agentId });
        return { parts: ['ok'], fullResponse: 'ok', metadata: { runId: 'r', sessionId: 's', status: 'completed' } };
      },
    });

    try {
      const handler = handlers.get('custom.clickup.task.status_changed.>');
      expect(handler).toBeDefined();
      if (!handler) throw new Error('engine did not subscribe to the compiled trigger');

      const fire = (listId: string) =>
        handler({
          id: crypto.randomUUID(),
          type: 'custom.clickup.task.status_changed',
          payload: {
            instanceId: 'inst-1',
            chatId: 'chat-1',
            from: { id: 'person-1', name: 'P' },
            content: 'task moved',
            list_id: listId,
          },
          metadata: { correlationId: 'corr-1' },
          timestamp: Date.now(),
        } as OmniEvent);

      // Filter mismatch: compiled eq condition refuses the event.
      await fire('other-list');
      expect(agentCalls).toHaveLength(0);

      // Filter match: call_agent dispatches to the DECLARING agent.
      await fire('L-1');
      expect(agentCalls).toHaveLength(1);
      expect(agentCalls[0]?.configAgentId).toBe(agent.id);
      expect(agentCalls[0]?.agentId).toBe(agent.id);
    } finally {
      await engine.stop();
    }
  });

  test('end to end (#1010): a CHAT-LESS external event fires the compiled call_agent — the provider receives the OmniEvent envelope', async () => {
    // The full RFC #925 motivating scenario, neither #1009 nor #1010 could
    // prove alone: manifest `accepts` entry for an external-shaped type →
    // compiler emits the minimal `call_agent {agentId}` config → an event
    // with NO chat fields (no instanceId, no chatId, no sender) arrives →
    // chatless dispatch resolves the provider from the AGENT row and the
    // (faked) provider receives the full envelope, session-scoped by
    // `automation:{automationId}:{correlationId}`.

    // A real provider row (FK for agents.agent_provider_id); the provider
    // CLIENT is faked below at the agent-runner's client seam.
    const [providerRow] = await db
      .insert(agentProviders)
      .values({ name: 'e2e-chatless-provider', schema: 'agno', baseUrl: 'http://localhost:1', apiKey: 'k' })
      .returning({ id: agentProviders.id });
    if (!providerRow) throw new Error('provider insert failed');

    const agent = await agentService.create({
      name: 'github-triage',
      provider: 'claude',
      agentProviderId: providerRow.id,
    });
    await agentService.updateManifest(agent.id, {
      accepts: [{ event: 'custom.github.push', filter: { repository: 'automagik-dev/omni' } }],
      publishes: [],
    });

    const compiled = (await automationService.list({ enabled: true })).filter(
      (row) => row.managedByAgentId === agent.id,
    );
    expect(compiled).toHaveLength(1);
    const automationId = compiled[0]?.id;

    // REAL engine deps over REAL services — only the provider client is faked.
    const services = createServices(db, recordingBus(journal));
    const providerRequests: ProviderRequest[] = [];
    const fakeClient: IAgentClient = {
      run: async (request: ProviderRequest): Promise<ProviderResponse> => {
        providerRequests.push(request);
        return { content: 'triaged', runId: 'run-e2e', sessionId: request.sessionId ?? '', status: 'completed' };
      },
      stream: (): AsyncGenerator<never> => {
        throw new Error('chatless dispatch is sync-only');
      },
    } as unknown as IAgentClient;
    (
      services.agentRunner as unknown as { getClient: () => Promise<{ client: IAgentClient; schema: string }> }
    ).getClient = async () => ({ client: fakeClient, schema: 'agno' });
    const deps = buildAutomationEngineDeps(services, db);

    const handlers = new Map<string, (event: OmniEvent) => Promise<void>>();
    const engineBus = {
      publishGeneric: async () => ({ id: 'pub' }),
      subscribePattern: async (pattern: string, handler: (event: OmniEvent) => Promise<void>) => {
        handlers.set(pattern, handler);
        return { unsubscribe: async () => {} } as Subscription;
      },
    } as unknown as EventBus;

    const engine = createAutomationEngine({ defaultConcurrency: 1, reconcileIntervalMs: 0 });
    engine.setLogger(async () => {});
    await engine.start(engineBus, compiled as unknown as CoreAutomation[], deps);

    try {
      const handler = handlers.get('custom.github.push.>');
      expect(handler).toBeDefined();
      if (!handler) throw new Error('engine did not subscribe to the compiled trigger');

      // A root external fact: NO chat fields anywhere in the payload.
      const fire = (repository: string, correlationId: string, eventId: string) =>
        handler({
          id: eventId,
          type: 'custom.github.push',
          payload: { source: 'github', repository, ref: 'refs/heads/main', commits: [{ id: 'abc123' }] },
          metadata: { correlationId },
          timestamp: 1757100000000,
        } as OmniEvent);

      // Compiled filter mismatch: refused before any dispatch.
      await fire('someone-else/repo', 'corr-x', 'evt-x');
      expect(providerRequests).toHaveLength(0);

      // Match: the provider receives the FULL envelope, chatless.
      await fire('automagik-dev/omni', 'corr-gh-1', 'evt-gh-1');
      expect(providerRequests).toHaveLength(1);
      const request = providerRequests[0];
      expect(request?.agentId).toBe('github-triage'); // provider-internal id: name fallback
      expect(request?.sessionId).toBe(`automation:${automationId}:corr-gh-1`);
      expect(request?.userId).toBe(`automation:${automationId}:corr-gh-1`);
      expect(request?.platform).toBeUndefined();
      expect(request?.chat).toBeUndefined();
      const envelope = JSON.parse(request?.message ?? '{}');
      expect(envelope).toEqual({
        id: 'evt-gh-1',
        type: 'custom.github.push',
        payload: {
          source: 'github',
          repository: 'automagik-dev/omni',
          ref: 'refs/heads/main',
          commits: [{ id: 'abc123' }],
        },
        metadata: { correlationId: 'corr-gh-1' },
        timestamp: 1757100000000,
      });

      // Session scoping: an unrelated event gets its own session…
      await fire('automagik-dev/omni', 'corr-gh-2', 'evt-gh-2');
      expect(providerRequests).toHaveLength(2);
      expect(providerRequests[1]?.sessionId).toBe(`automation:${automationId}:corr-gh-2`);

      // …while a causal chain (same correlationId) shares the first one.
      await fire('automagik-dev/omni', 'corr-gh-1', 'evt-gh-3');
      expect(providerRequests).toHaveLength(3);
      expect(providerRequests[2]?.sessionId).toBe(`automation:${automationId}:corr-gh-1`);
    } finally {
      await engine.stop();
    }
  });
});
