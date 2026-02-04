/**
 * Automations service - manages automation rules and execution logging
 */

import {
  type AgentCallContext,
  type AgentRunResult,
  type AutomationEngine,
  type CallAgentActionConfig,
  type Automation as CoreAutomation,
  NotFoundError,
  createAutomationEngine,
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
import { and, desc, eq } from 'drizzle-orm';

export interface AutomationTestResult {
  matched: boolean;
  conditions: Array<{ field: string; operator: string; matched: boolean }>;
  actions: Array<{ type: string; wouldExecute: boolean }>;
  dryRun: true;
}

export class AutomationService {
  private engine: AutomationEngine | null = null;

  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * Start the automation engine
   */
  async startEngine(deps?: {
    sendMessage?: (instanceId: string, to: string, content: string) => Promise<void>;
    callAgent?: (context: AgentCallContext, config: CallAgentActionConfig) => Promise<AgentRunResult>;
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

    // Set up execution logger
    this.engine.setLogger(async (log) => {
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
   * Get engine metrics
   */
  getMetrics(): { instanceQueues: Array<{ instanceId: string; activeCount: number; pendingCount: number }> } | null {
    return this.engine?.getMetrics() ?? null;
  }
}
