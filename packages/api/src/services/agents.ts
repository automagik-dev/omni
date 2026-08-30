/**
 * Agent service - manages first-class agent entities
 */

import { NotFoundError } from '@omni/core';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { type Agent, type NewAgent, agentRoutes, agents, instances } from '@omni/db';
import { and, eq, sql } from 'drizzle-orm';
import { invalidateProviderCacheForInstance } from '../plugins/agent-dispatcher';
import { scopedHandle } from '../tenancy/tenant-scope';

/**
 * Agent columns whose values get baked into cached IAgentProvider instances by
 * applyAgentFkOverrides + resolveProvider (agentType, the provider FK, and the
 * provider-internal agent id resolved from metadata/configPath/name). An update
 * touching any of these must evict the provider's cache entries or dispatch
 * keeps the stale values until the process restarts (omni#906).
 */
const PROVIDER_BAKED_AGENT_COLUMNS = [
  'name',
  'agentProviderId',
  'agentType',
  'metadata',
  'configPath',
] as const satisfies readonly (keyof NewAgent)[];

export interface ListAgentsOptions {
  limit?: number;
  cursor?: string;
  ownerId?: string;
  provider?: string;
  isActive?: boolean;
}

export class AgentService {
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

    // omni#906: evict cached providers built from the pre-update agent row —
    // per-instance (not invalidateProviderCache) so the provider's shared
    // OpenClaw WS clients, whose connection config an agent row can't affect,
    // stay up.
    if (PROVIDER_BAKED_AGENT_COLUMNS.some((column) => column in data)) {
      // Both reference paths: the instance-level agentId FK and per-chat/user
      // agent routes (mergeRouteOverrides stamps route agents onto the same
      // `${providerId}:${instanceId}` cache entry).
      const [direct, routed] = await Promise.all([
        this.db.select({ id: instances.id }).from(instances).where(eq(instances.agentId, id)),
        this.db.select({ id: agentRoutes.instanceId }).from(agentRoutes).where(eq(agentRoutes.agentId, id)),
      ]);
      for (const instanceId of new Set([...direct, ...routed].map((row) => row.id))) {
        invalidateProviderCacheForInstance(instanceId);
      }
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
   * Backfill Agent rows from instances.
   * @deprecated Phase 3 (omni-930): instances.agentProviderId has been dropped.
   * This method is now a no-op — all backfill was completed before the column drop.
   */
  async backfillFromInstances(_dryRun = false): Promise<{ found: number; inserted: number }> {
    return { found: 0, inserted: 0 };
  }
}
