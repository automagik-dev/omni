/**
 * Route Resolver Service
 *
 * Resolves agent routes for chats and users with caching.
 * Resolution order: chat route > user route > instance default
 *
 * @see agent-routing wish
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { agentRoutes } from '@omni/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';

const log = createLogger('route-resolver');

// Sentinel value for negative caching (no route found)
const NO_ROUTE = Symbol('NO_ROUTE');
type CacheValue = ResolvedRoute | typeof NO_ROUTE;

export interface ResolvedRoute {
  id: string;
  instanceId: string;
  scope: 'chat' | 'user';
  chatId: string | null;
  personId: string | null;
  agentProviderId: string;
  agentId: string;
  agentType: 'agent' | 'team' | 'workflow';
  agentTimeout: number | null;
  agentStreamMode: boolean | null;
  agentReplyFilter: unknown | null;
  agentSessionStrategy: string | null;
  agentPrefixSenderName: boolean | null;
  agentWaitForMedia: boolean | null;
  agentSendMediaPath: boolean | null;
  agentGateEnabled: boolean | null;
  agentGateModel: string | null;
  agentGatePrompt: string | null;
  label: string | null;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
  lastQueryMs: number;
}

export class RouteResolver {
  private cache: LRUCache<string, CacheValue>;
  private metrics: CacheMetrics;

  constructor(private db: Database) {
    // 30s TTL, max 1000 entries
    this.cache = new LRUCache<string, CacheValue>({
      max: 1000,
      ttl: 30_000, // 30 seconds
      updateAgeOnGet: false, // Don't reset TTL on cache hits
      allowStale: false,
    });

    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0,
      lastQueryMs: 0,
    };
  }

  /**
   * Resolve the matching route for a given instance, chat, and person.
   * Returns null if no route matches (use instance default).
   */
  async resolve(instanceId: string, chatId: string, personId?: string): Promise<ResolvedRoute | null> {
    const cacheKey = this.getCacheKey(instanceId, chatId, personId);
    const cached = this.cache.get(cacheKey);

    // Check if we have a cached result (including negative cache via NO_ROUTE sentinel)
    if (cached !== undefined) {
      this.metrics.hits++;
      const result = cached === NO_ROUTE ? null : cached;
      log.debug('Route cache hit', { instanceId, chatId, personId, hit: true, hasRoute: result !== null });
      return result;
    }

    this.metrics.misses++;
    const startMs = Date.now();

    // Query database: chat route > user route (ordered by specificity)
    // Note: personId ?? null handles SQL NULL semantics correctly - when personId is undefined,
    // the query becomes "personId = NULL" which is always false in SQL (use IS NULL instead).
    // This is intentional: undefined personId means "no user context", so user routes won't match.
    const routes = await this.db
      .select()
      .from(agentRoutes)
      .where(
        and(
          eq(agentRoutes.instanceId, instanceId),
          eq(agentRoutes.isActive, true),
          sql`(
            (${agentRoutes.scope} = 'chat' AND ${agentRoutes.chatId} = ${chatId})
            OR (${agentRoutes.scope} = 'user' AND ${agentRoutes.personId} = ${personId ?? null})
          )`,
        ),
      )
      .orderBy(
        // Chat routes first, then user routes
        sql`CASE ${agentRoutes.scope} WHEN 'chat' THEN 0 WHEN 'user' THEN 1 END`,
        desc(agentRoutes.priority),
      )
      .limit(1);

    const dbRoute = routes[0];
    this.metrics.lastQueryMs = Date.now() - startMs;

    if (!dbRoute) {
      // Cache negative result using sentinel to avoid repeated DB queries
      this.metrics.sets++;
      this.cache.set(cacheKey, NO_ROUTE);
      log.debug('No route found (using instance default, cached negative result)', {
        instanceId,
        chatId,
        personId,
        queryMs: this.metrics.lastQueryMs,
      });
      return null;
    }

    // Cast to our type (scope is validated by CHECK constraint in DB)
    const route: ResolvedRoute = {
      ...dbRoute,
      scope: dbRoute.scope as 'chat' | 'user',
    };

    // Cache the result
    this.metrics.sets++;
    this.cache.set(cacheKey, route);

    log.debug('Route resolved from DB', {
      instanceId,
      chatId,
      personId,
      routeId: route.id,
      scope: route.scope,
      queryMs: this.metrics.lastQueryMs,
    });

    return route;
  }

  /**
   * Invalidate cache for a specific route
   */
  invalidateRoute(routeId: string): void {
    // We don't have a reverse index, so clear the entire cache
    // This is acceptable for low-frequency route CRUD operations
    this.cache.clear();
    this.metrics.invalidations++;
    log.debug('Route cache invalidated', { routeId });
  }

  /**
   * Invalidate cache for an instance (e.g., when instance config changes)
   */
  invalidateInstance(instanceId: string): void {
    // Clear entire cache (no reverse index by instance)
    this.cache.clear();
    this.metrics.invalidations++;
    log.debug('Instance cache invalidated', { instanceId });
  }

  /**
   * Get cache metrics for observability
   */
  getMetrics(): CacheMetrics & { cacheSize: number; hitRate: number } {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? this.metrics.hits / total : 0;

    return {
      ...this.metrics,
      cacheSize: this.cache.size,
      hitRate: Math.round(hitRate * 10000) / 100, // percentage with 2 decimals
    };
  }

  /**
   * Generate cache key from instance, chat, and person
   */
  private getCacheKey(instanceId: string, chatId: string | null, personId: string | null | undefined): string {
    return `${instanceId}:${chatId ?? 'null'}:${personId ?? 'null'}`;
  }
}
