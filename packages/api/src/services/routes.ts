/**
 * Route service - manages agent routes
 */

import { NotFoundError } from '@omni/core';
import type { CreateAgentRoute, ListAgentRoutesQuery, UpdateAgentRoute } from '@omni/core';
import type { Database } from '@omni/db';
import { type AgentRoute, type NewAgentRoute, agentRoutes } from '@omni/db';
import { desc, eq } from 'drizzle-orm';
import type { RouteResolver } from './route-resolver';

export class RouteService {
  constructor(
    private db: Database,
    private routeResolver: RouteResolver,
  ) {}

  /**
   * List routes for an instance
   */
  async list(instanceId: string, options: ListAgentRoutesQuery = {}): Promise<AgentRoute[]> {
    let query = this.db.select().from(agentRoutes).where(eq(agentRoutes.instanceId, instanceId)).$dynamic();

    // Filter by scope if provided
    if (options.scope) {
      query = query.where(eq(agentRoutes.scope, options.scope));
    }

    // Filter by active status if provided
    if (options.isActive !== undefined) {
      query = query.where(eq(agentRoutes.isActive, options.isActive));
    }

    // Order by priority (highest first), then by creation time
    return query.orderBy(desc(agentRoutes.priority), agentRoutes.createdAt);
  }

  /**
   * Get route by ID
   */
  async getById(id: string): Promise<AgentRoute> {
    const [result] = await this.db.select().from(agentRoutes).where(eq(agentRoutes.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('AgentRoute', id);
    }

    return result;
  }

  /**
   * Create a new route
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Mapping many fields is inherently complex
  async create(instanceId: string, data: CreateAgentRoute): Promise<AgentRoute> {
    const routeData: NewAgentRoute = {
      instanceId,
      scope: data.scope,
      chatId: data.chatId ?? null,
      personId: data.personId ?? null,
      agentProviderId: data.agentProviderId,
      agentId: data.agentId,
      agentType: data.agentType ?? 'agent',
      agentTimeout: data.agentTimeout ?? null,
      agentStreamMode: data.agentStreamMode ?? null,
      agentReplyFilter: data.agentReplyFilter ?? null,
      agentSessionStrategy: data.agentSessionStrategy ?? null,
      agentPrefixSenderName: data.agentPrefixSenderName ?? null,
      agentWaitForMedia: data.agentWaitForMedia ?? null,
      agentSendMediaPath: data.agentSendMediaPath ?? null,
      agentGateEnabled: data.agentGateEnabled ?? null,
      agentGateModel: data.agentGateModel ?? null,
      agentGatePrompt: data.agentGatePrompt ?? null,
      label: data.label ?? null,
      priority: data.priority ?? 0,
      isActive: data.isActive ?? true,
    };

    const [created] = await this.db.insert(agentRoutes).values(routeData).returning();

    if (!created) {
      throw new Error('Failed to create agent route');
    }

    // Invalidate cache after creation
    this.routeResolver.invalidateInstance(instanceId);

    return created;
  }

  /**
   * Update a route
   */
  async update(id: string, data: UpdateAgentRoute): Promise<AgentRoute> {
    // First get the route to know which instance to invalidate
    const route = await this.getById(id);

    const [updated] = await this.db
      .update(agentRoutes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agentRoutes.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('AgentRoute', id);
    }

    // Invalidate cache after update
    this.routeResolver.invalidateInstance(route.instanceId);

    return updated;
  }

  /**
   * Delete a route
   */
  async delete(id: string): Promise<void> {
    // First get the route to know which instance to invalidate
    const route = await this.getById(id);

    const result = await this.db.delete(agentRoutes).where(eq(agentRoutes.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('AgentRoute', id);
    }

    // Invalidate cache after deletion
    this.routeResolver.invalidateInstance(route.instanceId);
  }
}
