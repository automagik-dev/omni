/**
 * Automations service - manages automation rules and execution logging
 */

import {
  type ActionDependencies,
  type ActionExecutionResult,
  type AgentCallContext,
  type AgentRunResult,
  type AutomationAction,
  type AutomationEngine,
  type CallAgentActionConfig,
  type Automation as CoreAutomation,
  NotFoundError,
  createAutomationEngine,
  createTemplateContext,
  executeActions,
} from '@omni/core';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type Automation,
  type AutomationLog,
  type NewAutomation,
  type NewAutomationLog,
  automationLogs,
  automations,
} from '@omni/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';

export interface AutomationTestResult {
  matched: boolean;
  conditions: Array<{ field: string; operator: string; matched: boolean }>;
  actions: Array<{ type: string; wouldExecute: boolean }>;
  dryRun: true;
}

export class AutomationService {
  private engine: AutomationEngine | null = null;

  /**
   * The handle every query in this service uses.
   *
   * Inside a tenant-scoped request this is the request's tenant-stamped
   * transaction (wish: omni-full-multitenancy, G4 — see `tenancy/tenant-scope.ts`);
   * for a legacy credential, a worker, or the CLI it is the ambient pool and
   * the query issued is byte-for-byte the one issued before the conversion.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(
    private readonly pool: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * Start the automation engine
   */
  async startEngine(deps?: {
    sendMessage?: (instanceId: string, to: string, content: string) => Promise<void>;
    callAgent?: (context: AgentCallContext, config: CallAgentActionConfig) => Promise<AgentRunResult>;
    staleIdleTimeoutGate?: (
      chatId: string,
      instanceId: string,
      eventSequenceIndex: number | null,
      // Trusted tenant of the consumed envelope (G5, ADR-0008) — threaded by
      // the engine from the producer-stamped metadata; null for legacy.
      trustedTenantId?: string | null,
    ) => Promise<{ skip: boolean; reason?: string; claimToken?: string }>;
    releaseIdleTimeoutClaim?: (claimToken: string) => void | Promise<void>;
    // Derived-key emission idempotency (#958) — see ActionDependencies.
    claimEmittedEvent?: (
      claim: { idempotencyKey: string; eventId: string; eventType: string; payload: Record<string, unknown> },
      trustedTenantId?: string | null,
    ) => Promise<boolean>;
    releaseEmittedEventClaim?: (eventId: string) => Promise<void>;
  }): Promise<void> {
    if (!this.eventBus) {
      return;
    }

    // Load enabled automations
    const enabledAutomations = await this.list({ enabled: true });

    // Create engine
    this.engine = createAutomationEngine({
      defaultConcurrency: 5,
    });

    // Set up execution logger.
    //
    // The engine threads the executed envelope's trusted tenant as a second
    // argument (G5, ADR-0008) — deliberately UNUSED here for now:
    // `automation_logs` derives its tenant from the G2-`unowned` `automations`
    // parent (tenancy-ownership.ts), so tenant_id stays NULL until the G6
    // backfill decides ownership, and a worker-scoped insert would violate the
    // strict RLS WITH CHECK and destroy the execution log. Scoping this write
    // is G6-gated; when G6 lands, wrap the call in
    // `runTenantWorkDb(this.pool, trustedTenantId, …)` — the threading is
    // already in place.
    this.engine.setLogger(async (log, _trustedTenantId) => {
      await this.logExecution(log);
    });

    // Start with automations
    await this.engine.start(this.eventBus, enabledAutomations as CoreAutomation[], deps ?? {});
  }

  /**
   * Stop the automation engine
   */
  async stopEngine(): Promise<void> {
    if (this.engine) {
      await this.engine.stop();
      this.engine = null;
    }
  }

  /**
   * Reload the automation engine (after CRUD changes)
   */
  async reloadEngine(): Promise<void> {
    if (this.engine && this.eventBus) {
      const enabledAutomations = await this.list({ enabled: true });
      await this.engine.reload(enabledAutomations as CoreAutomation[]);
    }
  }

  /**
   * List all automations
   */
  async list(options: { enabled?: boolean } = {}): Promise<Automation[]> {
    let query = this.db.select().from(automations).$dynamic();

    if (options.enabled !== undefined) {
      query = query.where(eq(automations.enabled, options.enabled));
    }

    return query.orderBy(desc(automations.priority), automations.name);
  }

  /**
   * Get automation by ID
   */
  async getById(id: string): Promise<Automation> {
    const [result] = await this.db.select().from(automations).where(eq(automations.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Automation', id);
    }

    return result;
  }

  /**
   * Create a new automation
   */
  async create(data: NewAutomation): Promise<Automation> {
    const [created] = await this.db.insert(automations).values(data).returning();

    if (!created) {
      throw new Error('Failed to create automation');
    }

    // Reload engine to pick up new automation
    await this.reloadEngine();

    return created;
  }

  /**
   * Update an automation
   */
  async update(id: string, data: Partial<NewAutomation>): Promise<Automation> {
    const [updated] = await this.db
      .update(automations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(automations.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Automation', id);
    }

    // Reload engine to pick up changes
    await this.reloadEngine();

    return updated;
  }

  /**
   * Delete an automation
   */
  async delete(id: string): Promise<void> {
    const result = await this.db.delete(automations).where(eq(automations.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('Automation', id);
    }

    // Reload engine
    await this.reloadEngine();
  }

  /**
   * Enable an automation
   */
  async enable(id: string): Promise<Automation> {
    return this.update(id, { enabled: true });
  }

  /**
   * Disable an automation
   */
  async disable(id: string): Promise<Automation> {
    return this.update(id, { enabled: false });
  }

  /**
   * Test an automation against a sample event (dry run)
   */
  async test(id: string, event: { type: string; payload: Record<string, unknown> }): Promise<AutomationTestResult> {
    const automation = await this.getById(id);

    if (this.engine) {
      return this.engine.testAutomation(automation as CoreAutomation, event);
    }

    // Manual test if engine not running
    // Just check conditions
    const matched = automation.triggerEventType === event.type;

    return {
      matched,
      conditions: [],
      actions: (automation.actions as Array<{ type: string }>).map((a) => ({
        type: a.type,
        wouldExecute: matched,
      })),
      dryRun: true,
    };
  }

  /**
   * Execute an automation with a provided event payload.
   * Actually runs the actions (not a dry run).
   */
  async execute(
    id: string,
    event: { type: string; payload: Record<string, unknown> },
    deps?: ActionDependencies,
  ): Promise<{
    automationId: string;
    triggered: boolean;
    results: ActionExecutionResult[];
  }> {
    const automation = await this.getById(id);

    // Check if event type matches
    if (automation.triggerEventType !== event.type) {
      return {
        automationId: id,
        triggered: false,
        results: [],
      };
    }

    // Build context from event
    const correlationId = crypto.randomUUID();
    const context = createTemplateContext(event.payload);

    // Default dependencies (eventBus from service, others empty)
    const actionDeps: ActionDependencies = {
      eventBus: this.eventBus,
      ...deps,
    };

    // Execute actions
    const results = await executeActions(automation.actions as AutomationAction[], context, actionDeps);

    // Log the execution
    const status = results.every((r) => r.status === 'success') ? 'success' : 'failed';
    const failedAction = results.find((r) => r.status === 'failed');

    await this.logExecution({
      automationId: id,
      eventId: correlationId,
      status,
      conditionsMatched: true, // Manual execution always matches
      actionsExecuted: results,
      error: failedAction?.error ?? null,
      executionTimeMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    });

    return {
      automationId: id,
      triggered: true,
      results,
    };
  }

  /**
   * Log an execution
   */
  async logExecution(log: NewAutomationLog): Promise<AutomationLog> {
    const [created] = await this.db.insert(automationLogs).values(log).returning();

    if (!created) {
      throw new Error('Failed to log automation execution');
    }

    return created;
  }

  /**
   * Get logs for an automation
   */
  async getLogs(
    automationId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: AutomationLog[]; hasMore: boolean; cursor?: string }> {
    const { limit = 50, cursor } = options;

    const conditions = [eq(automationLogs.automationId, automationId)];

    if (cursor) {
      conditions.push(eq(automationLogs.createdAt, new Date(cursor)));
    }

    const items = await this.db
      .select()
      .from(automationLogs)
      .where(and(...conditions))
      .orderBy(desc(automationLogs.createdAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.createdAt.toISOString(),
    };
  }

  /**
   * Search execution logs
   */
  async searchLogs(options: {
    eventType?: string;
    status?: string;
    automationId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: AutomationLog[]; hasMore: boolean; cursor?: string }> {
    const { limit = 50, cursor } = options;

    const conditions = [];

    if (options.automationId) {
      conditions.push(eq(automationLogs.automationId, options.automationId));
    }

    if (options.status) {
      conditions.push(eq(automationLogs.status, options.status as 'success' | 'failed' | 'skipped'));
    }

    if (cursor) {
      conditions.push(eq(automationLogs.createdAt, new Date(cursor)));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const items = await this.db
      .select()
      .from(automationLogs)
      .where(whereClause)
      .orderBy(desc(automationLogs.createdAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.createdAt.toISOString(),
    };
  }

  /**
   * Get engine metrics with execution stats
   */
  async getMetrics(): Promise<{
    running: boolean;
    instanceQueues?: Array<{ instanceId: string; activeCount: number; pendingCount: number }>;
    totalExecutions: number;
    totalActions: number;
    successRate: number;
    avgExecutionTimeMs: number;
    recentFailures: number;
  }> {
    const running = this.engine !== null;
    const engineMetrics = this.engine?.getMetrics();

    // Get execution stats from logs
    const [executionStats] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        successful: sql<number>`count(*) filter (where ${automationLogs.status} = 'success')::int`,
        totalActions: sql<number>`coalesce(sum(jsonb_array_length(${automationLogs.actionsExecuted}::jsonb)), 0)::int`,
        avgExecutionTime: sql<number>`avg(${automationLogs.executionTimeMs})::int`,
      })
      .from(automationLogs);

    // Get failures in last 24h
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recentFailureStats] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(automationLogs)
      .where(and(eq(automationLogs.status, 'failed'), gte(automationLogs.createdAt, last24h)));

    const total = executionStats?.total ?? 0;
    const successful = executionStats?.successful ?? 0;

    return {
      running,
      instanceQueues: engineMetrics?.instanceQueues,
      totalExecutions: total,
      totalActions: executionStats?.totalActions ?? 0,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgExecutionTimeMs: executionStats?.avgExecutionTime ?? 0,
      recentFailures: recentFailureStats?.count ?? 0,
    };
  }
}
