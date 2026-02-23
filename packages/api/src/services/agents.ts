/**
 * Agent service - manages first-class agent entities
 */

import { NotFoundError } from '@omni/core';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { type Agent, type NewAgent, agentProviders, agents, instances } from '@omni/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

export interface ListAgentsOptions {
  limit?: number;
  cursor?: string;
  ownerId?: string;
  provider?: string;
  isActive?: boolean;
}

export class AgentService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List agents with optional filters (paginated)
   */
  async list(options: ListAgentsOptions = {}): Promise<Agent[]> {
    const { limit = 50, ownerId, provider, isActive } = options;

    const conditions = [];

    if (ownerId !== undefined) {
      conditions.push(eq(agents.ownerId, ownerId));
    }
    if (provider !== undefined) {
      conditions.push(sql`${agents.provider} = ${provider}`);
    }
    if (isActive !== undefined) {
      conditions.push(eq(agents.isActive, isActive));
    }

    let query = this.db.select().from(agents).$dynamic();

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(agents.createdAt).limit(limit);
  }

  /**
   * Get agent by ID
   */
  async getById(id: string): Promise<Agent> {
    const [result] = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Agent', id);
    }

    return result;
  }

  /**
   * Create a new agent
   */
  async create(data: NewAgent): Promise<Agent> {
    const [created] = await this.db.insert(agents).values(data).returning();

    if (!created) {
      throw new Error('Failed to create agent');
    }

    if (this.eventBus) {
      await this.eventBus.publishGeneric('system.agent.registered', {
        agentId: created.id,
        name: created.name,
        provider: created.provider,
      });
    }

    return created;
  }

  /**
   * Update an agent
   */
  async update(id: string, data: Partial<NewAgent>): Promise<Agent> {
    const [updated] = await this.db
      .update(agents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Agent', id);
    }

    return updated;
  }

  /**
   * Delete an agent (soft delete — sets isActive = false)
   */
  async delete(id: string): Promise<void> {
    const [updated] = await this.db
      .update(agents)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning({ id: agents.id });

    if (!updated) {
      throw new NotFoundError('Agent', id);
    }
  }

  /**
   * Backfill Agent rows from instances that have agentProviderId set.
   * Idempotent — uses onConflictDoNothing via name uniqueness awareness.
   * Returns the count of rows inserted.
   */
  async backfillFromInstances(dryRun = false): Promise<{ found: number; inserted: number }> {
    // Join instances with their agent providers
    const rows = await this.db
      .select({
        instanceId: instances.id,
        instanceName: instances.name,
        agentProviderId: instances.agentProviderId,
        providerSchema: agentProviders.schema,
      })
      .from(instances)
      .innerJoin(agentProviders, eq(instances.agentProviderId, agentProviders.id))
      .where(isNotNull(instances.agentProviderId));

    const found = rows.length;

    if (dryRun || found === 0) {
      return { found, inserted: 0 };
    }

    // Map provider schema → AgentSystem
    const schemaToSystem: Record<string, string> = {
      agno: 'agno',
      webhook: 'custom',
      openclaw: 'custom',
      'ag-ui': 'custom',
      'claude-code': 'claude',
    };

    const values: NewAgent[] = rows.map((row) => ({
      name: `${row.instanceName} agent`,
      provider: (schemaToSystem[row.providerSchema] ?? 'custom') as Agent['provider'],
      agentProviderId: row.agentProviderId,
      agentType: 'assistant',
      capabilities: [],
      isInternal: false,
      isActive: true,
    }));

    const result = await this.db.insert(agents).values(values).onConflictDoNothing().returning({ id: agents.id });

    return { found, inserted: result.length };
  }
}
