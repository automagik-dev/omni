/**
 * Hook Registry
 *
 * Manages hook registration and retrieval per instance.
 * Each channel instance has its own hook pipeline (DEC-6).
 *
 * @example
 * ```typescript
 * import { HookRegistry } from '@omni/core';
 *
 * const registry = new HookRegistry();
 *
 * // Register a hook
 * const hookId = registry.register('instance-1', {
 *   event: 'before_agent_start',
 *   handler: async (ctx) => ({ ...ctx, model: 'gpt-4o-mini' }),
 *   priority: 10,
 * });
 *
 * // Get hooks for an event (sorted by priority)
 * const hooks = registry.getHooks('instance-1', 'before_agent_start');
 *
 * // Unregister
 * registry.unregister('instance-1', hookId);
 * ```
 */

import { generateId } from '../ids';
import {
  DEFAULT_HOOK_PRIORITY,
  HOOK_EVENTS,
  type HookEvent,
  type HookHandler,
  type HookHandlerFn,
  MAX_HOOK_PRIORITY,
  MIN_HOOK_PRIORITY,
} from './types';

// ============================================================================
// Registration Input
// ============================================================================

export interface RegisterHookInput<E extends HookEvent = HookEvent> {
  event: E;
  handler: HookHandlerFn<E>;
  priority?: number;
  name?: string;
  /** Provide a custom ID; auto-generated if omitted */
  id?: string;
}

// ============================================================================
// Hook Registry
// ============================================================================

export class HookRegistry {
  /**
   * Map of instanceId -> event -> hookId -> HookHandler
   * This allows O(1) unregister and efficient per-event lookup.
   */
  private hooks: Map<string, Map<HookEvent, Map<string, HookHandler>>> = new Map();

  /**
   * Register a hook handler for an instance.
   *
   * @param instanceId - The channel instance ID
   * @param input - Hook registration details
   * @returns The hook ID (for later unregistration)
   */
  register<E extends HookEvent>(instanceId: string, input: RegisterHookInput<E>): string {
    const { event, handler, name, id: customId } = input;

    // Validate event
    if (!HOOK_EVENTS.includes(event)) {
      throw new Error(`Invalid hook event: ${event}. Must be one of: ${HOOK_EVENTS.join(', ')}`);
    }

    // Clamp priority to valid range
    const rawPriority = input.priority ?? DEFAULT_HOOK_PRIORITY;
    const priority = Math.max(MIN_HOOK_PRIORITY, Math.min(MAX_HOOK_PRIORITY, rawPriority));

    const hookId = customId ?? `hook_${generateId()}`;

    const hookHandler: HookHandler = {
      id: hookId,
      event,
      priority,
      handler: handler as unknown as HookHandlerFn,
      name,
    };

    // Get or create instance map
    let instanceHooks = this.hooks.get(instanceId);
    if (!instanceHooks) {
      instanceHooks = new Map();
      this.hooks.set(instanceId, instanceHooks);
    }

    // Get or create event map
    let eventHooks = instanceHooks.get(event);
    if (!eventHooks) {
      eventHooks = new Map();
      instanceHooks.set(event, eventHooks);
    }

    eventHooks.set(hookId, hookHandler);

    return hookId;
  }

  /**
   * Unregister a hook by ID.
   *
   * @param instanceId - The channel instance ID
   * @param hookId - The hook ID to remove
   * @returns true if the hook was found and removed
   */
  unregister(instanceId: string, hookId: string): boolean {
    const instanceHooks = this.hooks.get(instanceId);
    if (!instanceHooks) return false;

    for (const [, eventHooks] of instanceHooks) {
      if (eventHooks.delete(hookId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all hooks for an instance + event, sorted by priority (ascending).
   * Same priority = registration order (Map insertion order).
   *
   * @param instanceId - The channel instance ID
   * @param event - The hook event to retrieve
   * @returns Sorted array of hook handlers
   */
  getHooks<E extends HookEvent>(instanceId: string, event: E): HookHandler<E>[] {
    const instanceHooks = this.hooks.get(instanceId);
    if (!instanceHooks) return [];

    const eventHooks = instanceHooks.get(event);
    if (!eventHooks) return [];

    // Convert to array and sort by priority (lower = earlier)
    return Array.from(eventHooks.values()).sort((a, b) => a.priority - b.priority) as unknown as HookHandler<E>[];
  }

  /**
   * Get the count of hooks registered for an instance + event.
   */
  getHookCount(instanceId: string, event?: HookEvent): number {
    const instanceHooks = this.hooks.get(instanceId);
    if (!instanceHooks) return 0;

    if (event) {
      return instanceHooks.get(event)?.size ?? 0;
    }

    let count = 0;
    for (const [, eventHooks] of instanceHooks) {
      count += eventHooks.size;
    }
    return count;
  }

  /**
   * Clear all hooks for an instance.
   */
  clearInstance(instanceId: string): void {
    this.hooks.delete(instanceId);
  }

  /**
   * Clear all hooks across all instances.
   */
  clearAll(): void {
    this.hooks.clear();
  }
}

/**
 * Global singleton hook registry.
 * Use this for the shared application-wide registry.
 */
let globalRegistry: HookRegistry | null = null;

export function getHookRegistry(): HookRegistry {
  if (!globalRegistry) {
    globalRegistry = new HookRegistry();
  }
  return globalRegistry;
}

export function resetHookRegistry(): void {
  globalRegistry?.clearAll();
  globalRegistry = null;
}
