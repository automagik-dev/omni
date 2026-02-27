/**
 * Plugin Hook Type Definitions
 *
 * Defines the hook event types, handler interfaces, and Zod schemas
 * for the plugin hook system. Hooks allow plugins to observe and optionally
 * modify key pipeline stages in the agent runner.
 *
 * Hook events:
 * - before_agent_start: fires before agent session begins, can modify model/provider
 * - before_message_write: fires before message persistence, can modify content
 */

import { z } from 'zod';

// ============================================================================
// Hook Events
// ============================================================================

export const HOOK_EVENTS = ['before_agent_start', 'before_message_write'] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

// ============================================================================
// Limits & Defaults
// ============================================================================

/** Maximum hooks per instance (DEC-3) */
export const MAX_HOOKS_PER_INSTANCE = 50;

/** Default pipeline timeout in milliseconds (DEC-4) */
export const DEFAULT_PIPELINE_TIMEOUT_MS = 15_000;

// ============================================================================
// Hook Context Schemas (Zod)
// ============================================================================

export const BeforeAgentStartContextSchema = z.object({
  instanceId: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  senderName: z.string().optional(),
  /** Current model/provider selection — hook can override */
  model: z.string().optional(),
  provider: z.string().optional(),
  agentId: z.string().optional(),
  /** Dispatcher-level context fields */
  triggerType: z.string().optional(),
  traceId: z.string().optional(),
  correlationId: z.string().optional(),
  /** Files attached to the dispatch (ProviderFile is complex, use unknown for now) */
  files: z.array(z.unknown()).optional(),
  /** Additional metadata for hook consumers — string values only to prevent structuredClone crash (DEC-8) */
  metadata: z.record(z.string()).optional(),
});

export const BeforeMessageWriteContextSchema = z.object({
  instanceId: z.string(),
  chatId: z.string(),
  /** Message content — hook can transform. Max 100K chars (DEC-9) */
  content: z.string().max(100_000),
  /** Message direction */
  direction: z.enum(['inbound', 'outbound']),
  senderId: z.string().optional(),
  /** Additional metadata — string values only to prevent structuredClone crash (DEC-8) */
  metadata: z.record(z.string()).optional(),
});

// ============================================================================
// Hook Context Schema Map
// ============================================================================

/** Zod schemas keyed by hook event — used by the executor to validate mutable
 *  hook return values before committing them to the pipeline context. */
export const HookContextSchemas: Record<HookEvent, z.ZodTypeAny> = {
  before_agent_start: BeforeAgentStartContextSchema,
  before_message_write: BeforeMessageWriteContextSchema,
};

// ============================================================================
// Hook Context Types (derived from Zod)
// ============================================================================

export type BeforeAgentStartContext = z.infer<typeof BeforeAgentStartContextSchema>;
export type BeforeMessageWriteContext = z.infer<typeof BeforeMessageWriteContextSchema>;

/** Map hook events to their context types */
export interface HookContextMap {
  before_agent_start: BeforeAgentStartContext;
  before_message_write: BeforeMessageWriteContext;
}

// ============================================================================
// Hook Handler Types
// ============================================================================

/** Default hook timeout in milliseconds */
export const DEFAULT_HOOK_TIMEOUT_MS = 5000;

/** Default hook priority (0-100 range, lower = earlier) */
export const DEFAULT_HOOK_PRIORITY = 50;

/** Min/max priority bounds */
export const MIN_HOOK_PRIORITY = 0;
export const MAX_HOOK_PRIORITY = 100;

/**
 * Hook handler function signature.
 *
 * For mutable hooks (before_agent_start, before_message_write): return modified context or void.
 */
export type HookHandlerFn<E extends HookEvent = HookEvent> = (
  context: HookContextMap[E],
  /** AbortSignal fired when the hook exceeds its timeout — handlers should use
   *  this to cancel in-flight async work (fetch, DB queries, etc.). */
  signal: AbortSignal,
  // biome-ignore lint/suspicious/noConfusingVoidType: void required for async handler compat
) => Promise<HookContextMap[E] | void> | HookContextMap[E] | void;

/**
 * Registered hook handler with metadata
 */
export interface HookHandler<E extends HookEvent = HookEvent> {
  /** Unique hook ID (auto-generated if not provided) */
  id: string;
  /** The event this hook listens to */
  event: E;
  /** Execution priority (0-100, lower = earlier, default 50) */
  priority: number;
  /** The handler function */
  handler: HookHandlerFn<E>;
  /** Optional human-readable name for logging */
  name?: string;
}

/**
 * Options for hook execution
 */
export interface HookExecutionOptions {
  /** Timeout per hook in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Global pipeline timeout in milliseconds (default: 15000) */
  pipelineTimeoutMs?: number;
}

/**
 * Result of a single hook execution
 */
export interface HookExecutionResult {
  hookId: string;
  hookName?: string;
  status: 'success' | 'timeout' | 'error';
  durationMs: number;
  error?: string;
}

/**
 * Aggregate result of executing all hooks for an event
 */
export interface HookPipelineResult<E extends HookEvent = HookEvent> {
  /** The final context after all hooks (may be modified for mutable hooks) */
  context: HookContextMap[E];
  /** Individual hook execution results */
  results: HookExecutionResult[];
  /** Total pipeline duration */
  totalDurationMs: number;
}
