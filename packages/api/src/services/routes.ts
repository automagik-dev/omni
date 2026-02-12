/**
 * Route service - manages agent routes
 */

import { ConflictError, NotFoundError } from '@omni/core';
import type { CreateAgentRoute, ListAgentRoutesQuery, UpdateAgentRoute } from '@omni/core';
import type { Database } from '@omni/db';
import { type AgentRoute, type NewAgentRoute, agentRoutes } from '@omni/db';
import { and, desc, eq } from 'drizzle-orm';
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
    // Build filter conditions
    const conditions = [eq(agentRoutes.instanceId, instanceId)];

    if (options.scope) {
      conditions.push(eq(agentRoutes.scope, options.scope));
    }
    if (options.isActive !== undefined) {
      conditions.push(eq(agentRoutes.isActive, options.isActive));
    }

    // Apply all conditions (single condition can be used directly, multiple need and())
    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    return this.db.select().from(agentRoutes).where(where).orderBy(desc(agentRoutes.priority), agentRoutes.createdAt);
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

    let created: AgentRoute;

    try {
      const [result] = await this.db.insert(agentRoutes).values(routeData).returning();

      if (!result) {
        throw new Error('Failed to create agent route');
      }

      created = result;
    } catch (error) {
      // Check for unique constraint violation (PostgreSQL error code 23505)
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        const constraint = 'constraint' in error && typeof error.constraint === 'string' ? error.constraint : 'unknown';

        // Determine which unique constraint was violated
        if (constraint.includes('chat')) {
          throw new ConflictError('AgentRoute', 'A route for this chat already exists', {
            instanceId,
            chatId: data.chatId,
            scope: data.scope,
          });
        }
        if (constraint.includes('user') || constraint.includes('person')) {
          throw new ConflictError('AgentRoute', 'A route for this user already exists', {
            instanceId,
            personId: data.personId,
            scope: data.scope,
          });
        }

        throw new ConflictError('AgentRoute', 'Route already exists', { constraint });
      }

      throw error;
    }

    // Best-effort cache invalidation outside try-catch
    // This ensures cache failures don't mask successful creation
    try {
      this.routeResolver.invalidateInstance(instanceId);
    } catch {
      // Ignore cache invalidation errors - the route was created successfully
    }

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

    // Best-effort cache invalidation - don't fail update if cache fails
    try {
      this.routeResolver.invalidateInstance(route.instanceId);
    } catch {
      // Ignore cache invalidation errors
    }

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

    // Best-effort cache invalidation - don't fail deletion if cache fails
    try {
      this.routeResolver.invalidateInstance(route.instanceId);
    } catch {
      // Ignore cache invalidation errors
    }
  }
}
