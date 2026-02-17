/**
 * Plugin Hook Type Definitions
 *
 * Defines the hook event types, handler interfaces, and Zod schemas
 * for the plugin hook system. Hooks allow plugins to observe and optionally
 * modify key pipeline stages in the agent runner.
 *
 * Hook events:
 * - before_agent_start: fires before agent session begins, can modify model/provider
 * - llm_input: fires after prompt assembly, before LLM API call (read-only)
 * - llm_output: fires after LLM response, before processing (read-only)
 * - before_message_write: fires before message persistence, can modify content
 */

import { z } from 'zod';

// ============================================================================
// Hook Events
// ============================================================================

export const HOOK_EVENTS = ['before_agent_start', 'llm_input', 'llm_output', 'before_message_write'] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Read-only hook events — handlers receive frozen context */
export const READ_ONLY_HOOKS: readonly HookEvent[] = ['llm_input', 'llm_output'];

/** Mutable hook events — handlers can return modified context */
export const MUTABLE_HOOKS: readonly HookEvent[] = ['before_agent_start', 'before_message_write'];

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
  /** Additional metadata for hook consumers */
  metadata: z.record(z.unknown()).optional(),
});

export const LLMInputContextSchema = z.object({
  instanceId: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  /** The assembled prompt messages array */
  messages: z.array(z.string()),
  /** Model being used */
  model: z.string().optional(),
  provider: z.string().optional(),
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});

export const LLMOutputContextSchema = z.object({
  instanceId: z.string(),
  chatId: z.string(),
  /** Raw model response content */
  response: z.string(),
  /** Token usage statistics */
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});

export const BeforeMessageWriteContextSchema = z.object({
  instanceId: z.string(),
  chatId: z.string(),
  /** Message content — hook can transform */
  content: z.string(),
  /** Message direction */
  direction: z.enum(['inbound', 'outbound']),
  senderId: z.string().optional(),
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Hook Context Types (derived from Zod)
// ============================================================================

export type BeforeAgentStartContext = z.infer<typeof BeforeAgentStartContextSchema>;
export type LLMInputContext = z.infer<typeof LLMInputContextSchema>;
export type LLMOutputContext = z.infer<typeof LLMOutputContextSchema>;
export type BeforeMessageWriteContext = z.infer<typeof BeforeMessageWriteContextSchema>;

/** Map hook events to their context types */
export interface HookContextMap {
  before_agent_start: BeforeAgentStartContext;
  llm_input: LLMInputContext;
  llm_output: LLMOutputContext;
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
 * For read-only hooks (llm_input, llm_output): return value is ignored.
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
