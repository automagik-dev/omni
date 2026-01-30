/**
 * Event schema registry for runtime validation of custom events
 *
 * Core events are validated at compile-time via TypeScript.
 * Custom (custom.*) and system (system.*) events are validated at runtime
 * using schemas registered here.
 */

import { type ZodSchema, z } from 'zod';
import { isCoreEvent, isCustomEvent, isSystemEvent } from '../types';
import type { StreamName } from './streams';

/**
 * Event schema entry for the registry
 */
export interface EventSchemaEntry {
  /** Event type (e.g., 'custom.webhook.github') */
  eventType: string;
  /** Zod schema for payload validation */
  schema: ZodSchema;
  /** Override default stream routing (optional) */
  stream?: StreamName;
  /** Human-readable description */
  description?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Event registry for managing custom event schemas
 */
export class EventRegistry {
  private schemas = new Map<string, EventSchemaEntry>();

  /**
   * Register a custom or system event type with its schema
   *
   * @throws Error if trying to register a core event type
   *
   * @example
   * registry.register({
   *   eventType: 'custom.webhook.github',
   *   schema: z.object({
   *     action: z.string(),
   *     repository: z.string(),
   *     sender: z.string(),
   *     payload: z.unknown(),
   *   }),
   *   description: 'GitHub webhook events',
   * });
   */
  register(entry: EventSchemaEntry): void {
    const { eventType } = entry;

    if (isCoreEvent(eventType)) {
      throw new Error(`Cannot register core event type '${eventType}'. Core events use compile-time types.`);
    }

    if (!isCustomEvent(eventType) && !isSystemEvent(eventType)) {
      throw new Error(`Event type '${eventType}' must start with 'custom.' or 'system.'`);
    }

    this.schemas.set(eventType, entry);
  }

  /**
   * Unregister an event type
   */
  unregister(eventType: string): boolean {
    return this.schemas.delete(eventType);
  }

  /**
   * Check if an event type is registered
   */
  has(eventType: string): boolean {
    return this.schemas.has(eventType);
  }

  /**
   * Get the schema entry for an event type
   */
  get(eventType: string): EventSchemaEntry | undefined {
    return this.schemas.get(eventType);
  }

  /**
   * Validate a payload against its registered schema
   *
   * For core events: Returns success (validation is compile-time)
   * For registered custom/system events: Validates against schema
   * For unregistered custom events: Returns success with warning
   * For unknown events: Returns failure
   */
  validate(eventType: string, payload: unknown): ValidationResult {
    // Core events are validated at compile-time
    if (isCoreEvent(eventType)) {
      return { success: true, data: payload };
    }

    const entry = this.schemas.get(eventType);

    // No schema registered for this custom event
    if (!entry) {
      if (isCustomEvent(eventType)) {
        // Allow unregistered custom events with a warning
        console.warn(`[EventRegistry] No schema registered for '${eventType}'`);
        return { success: true, data: payload };
      }

      if (isSystemEvent(eventType)) {
        // System events without schema are allowed (internal use)
        return { success: true, data: payload };
      }

      return {
        success: false,
        error: `Unknown event type: ${eventType}`,
      };
    }

    // Validate against schema
    const result = entry.schema.safeParse(payload);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      error: result.error.message,
    };
  }

  /**
   * Get the stream for an event type (for routing)
   * Returns the override stream if set, otherwise uses default routing
   */
  getStream(eventType: string): StreamName | undefined {
    const entry = this.schemas.get(eventType);
    return entry?.stream;
  }

  /**
   * List all registered event schemas
   */
  list(): EventSchemaEntry[] {
    return Array.from(this.schemas.values());
  }

  /**
   * List event types by namespace
   */
  listByNamespace(namespace: 'custom' | 'system'): EventSchemaEntry[] {
    const prefix = `${namespace}.`;
    return this.list().filter((entry) => entry.eventType.startsWith(prefix));
  }

  /**
   * Clear all registered schemas (useful for testing)
   */
  clear(): void {
    this.schemas.clear();
  }
}

/**
 * Singleton event registry instance
 */
export const eventRegistry = new EventRegistry();

/**
 * Helper to create a type-safe event schema
 *
 * @example
 * const GitHubWebhookSchema = createEventSchema(
 *   'custom.webhook.github',
 *   z.object({
 *     action: z.string(),
 *     repository: z.string(),
 *   }),
 * );
 */
export function createEventSchema<T extends `custom.${string}` | `system.${string}`>(
  eventType: T,
  schema: ZodSchema,
  options?: { stream?: StreamName; description?: string },
): EventSchemaEntry {
  return {
    eventType,
    schema,
    stream: options?.stream,
    description: options?.description,
  };
}

/**
 * Register multiple event schemas at once
 */
export function registerSchemas(entries: EventSchemaEntry[]): void {
  for (const entry of entries) {
    eventRegistry.register(entry);
  }
}

/**
 * Common system event schemas
 */
export const SystemEventSchemas = {
  deadLetter: createEventSchema(
    'system.dead_letter',
    z.object({
      originalEventId: z.string(),
      originalEventType: z.string(),
      error: z.string(),
      retryCount: z.number(),
      timestamp: z.number(),
    }),
    { description: 'Event that failed processing and was sent to dead letter queue' },
  ),

  replayStarted: createEventSchema(
    'system.replay.started',
    z.object({
      streamName: z.string(),
      startTime: z.number(),
      endTime: z.number().optional(),
      filter: z.string().optional(),
    }),
    { description: 'Event replay operation started' },
  ),

  replayCompleted: createEventSchema(
    'system.replay.completed',
    z.object({
      streamName: z.string(),
      eventsProcessed: z.number(),
      eventsSkipped: z.number(),
      errors: z.number(),
      durationMs: z.number(),
    }),
    { description: 'Event replay operation completed' },
  ),

  healthDegraded: createEventSchema(
    'system.health.degraded',
    z.object({
      component: z.string(),
      reason: z.string(),
      severity: z.enum(['warning', 'critical']),
    }),
    { description: 'System health degradation detected' },
  ),
};
