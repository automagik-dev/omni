/**
 * Agent Spawn Guard
 *
 * Enforces depth and breadth limits on agent spawning to prevent
 * runaway agent chains. Configurable per-instance.
 *
 * - maxSpawnDepth: maximum nesting depth (default: 3)
 * - maxChildrenPerAgent: maximum concurrent children per agent (default: 5)
 */

import { createLogger } from '../logger';

const logger = createLogger('agents:spawn-guard');

// ============================================================================
// Types
// ============================================================================

/** Configurable spawn limits */
export interface SpawnLimits {
  /** Maximum agent nesting depth (default: 3) */
  maxSpawnDepth: number;
  /** Maximum concurrent children per agent (default: 5) */
  maxChildrenPerAgent: number;
}

/** Agent context carrying depth information */
export interface AgentContext {
  /** Current agent nesting depth (0 = top-level) */
  agentDepth: number;
  /** ID of the current agent */
  agentId: string;
  /** ID of the parent agent (undefined for top-level) */
  parentAgentId?: string;
  /** Instance ID for scoping */
  instanceId: string;
}

/** Result of a spawn check */
export type SpawnDecision = { allowed: true } | { allowed: false; reason: string };

// ============================================================================
// Default Limits
// ============================================================================

export const DEFAULT_SPAWN_LIMITS: SpawnLimits = {
  maxSpawnDepth: 3,
  maxChildrenPerAgent: 5,
};

// ============================================================================
// Children Tracker
// ============================================================================

/**
 * Tracks active children count per agent, scoped by instance ID.
 * Using a composite key (instanceId + agentId) ensures that two tenants
 * sharing the same agent ID do not interfere with each other's breadth limits.
 */
export class ChildrenTracker {
  private children = new Map<string, number>();

  /** Build a composite key scoped to the instance */
  private key(instanceId: string, agentId: string): string {
    return `${instanceId}:${agentId}`;
  }

  /** Get current children count for an agent within an instance */
  getCount(instanceId: string, agentId: string): number {
    return this.children.get(this.key(instanceId, agentId)) ?? 0;
  }

  /** Increment children count when a child is spawned */
  increment(instanceId: string, agentId: string): void {
    const k = this.key(instanceId, agentId);
    const current = this.children.get(k) ?? 0;
    this.children.set(k, current + 1);
  }

  /** Decrement children count when a child completes */
  decrement(instanceId: string, agentId: string): void {
    const k = this.key(instanceId, agentId);
    const current = this.children.get(k) ?? 0;
    if (current > 0) {
      this.children.set(k, current - 1);
    }
    // Clean up zero entries
    if ((this.children.get(k) ?? 0) === 0) {
      this.children.delete(k);
    }
  }

  /** Reset all tracking (for testing) */
  clear(): void {
    this.children.clear();
  }
}

// ============================================================================
// Spawn Guard
// ============================================================================

/**
 * Check if an agent spawn is allowed given the current context and limits.
 *
 * @param context - Current agent context (depth, agentId, instanceId)
 * @param limits - Spawn limits to enforce
 * @param tracker - Children tracker for breadth limiting
 * @returns SpawnDecision indicating if spawn is allowed or rejected with reason
 */
export function checkSpawnAllowed(context: AgentContext, limits: SpawnLimits, tracker: ChildrenTracker): SpawnDecision {
  // Check depth limit
  const newDepth = context.agentDepth + 1;
  if (newDepth > limits.maxSpawnDepth) {
    const reason = `Agent spawn rejected: max depth ${limits.maxSpawnDepth} exceeded (current depth: ${context.agentDepth})`;
    logger.warn(reason, {
      event: 'agent_spawn_rejected',
      reason: 'max_depth_exceeded',
      parentAgentId: context.agentId,
      depth: context.agentDepth,
      maxSpawnDepth: limits.maxSpawnDepth,
      instanceId: context.instanceId,
    });
    return { allowed: false, reason };
  }

  // Check breadth limit (children count), scoped by instanceId for tenant isolation
  const currentChildren = tracker.getCount(context.instanceId, context.agentId);
  if (currentChildren >= limits.maxChildrenPerAgent) {
    const reason = `Agent spawn rejected: max children ${limits.maxChildrenPerAgent} exceeded for agent ${context.agentId} (current children: ${currentChildren})`;
    logger.warn(reason, {
      event: 'agent_spawn_rejected',
      reason: 'max_children_exceeded',
      parentAgentId: context.agentId,
      currentChildren,
      maxChildrenPerAgent: limits.maxChildrenPerAgent,
      instanceId: context.instanceId,
    });
    return { allowed: false, reason };
  }

  return { allowed: true };
}

/**
 * Record a successful agent spawn — increments children count and logs.
 *
 * @param parentContext - The parent agent's context
 * @param childAgentId - ID of the newly spawned child agent
 * @param tracker - Children tracker to update
 * @returns The new AgentContext for the child agent
 */
export function recordSpawn(parentContext: AgentContext, childAgentId: string, tracker: ChildrenTracker): AgentContext {
  tracker.increment(parentContext.instanceId, parentContext.agentId);

  const childContext: AgentContext = {
    agentDepth: parentContext.agentDepth + 1,
    agentId: childAgentId,
    parentAgentId: parentContext.agentId,
    instanceId: parentContext.instanceId,
  };

  logger.info('Agent spawned', {
    event: 'agent_spawn',
    parentAgentId: parentContext.agentId,
    childAgentId,
    depth: childContext.agentDepth,
    instanceId: parentContext.instanceId,
  });

  return childContext;
}

/**
 * Record agent completion — decrements parent's children count.
 *
 * @param context - The completing agent's context
 * @param tracker - Children tracker to update
 */
export function recordCompletion(context: AgentContext, tracker: ChildrenTracker): void {
  if (context.parentAgentId) {
    tracker.decrement(context.instanceId, context.parentAgentId);

    logger.info('Agent completed', {
      event: 'agent_complete',
      agentId: context.agentId,
      parentAgentId: context.parentAgentId,
      depth: context.agentDepth,
      instanceId: context.instanceId,
    });
  }
}

/**
 * Create a top-level agent context (depth 0, no parent).
 */
export function createRootAgentContext(agentId: string, instanceId: string): AgentContext {
  return {
    agentDepth: 0,
    agentId,
    instanceId,
  };
}

/**
 * Resolve spawn limits from per-instance config, falling back to defaults.
 */
export function resolveSpawnLimits(instanceConfig?: Partial<SpawnLimits>): SpawnLimits {
  return {
    maxSpawnDepth: instanceConfig?.maxSpawnDepth ?? DEFAULT_SPAWN_LIMITS.maxSpawnDepth,
    maxChildrenPerAgent: instanceConfig?.maxChildrenPerAgent ?? DEFAULT_SPAWN_LIMITS.maxChildrenPerAgent,
  };
}
