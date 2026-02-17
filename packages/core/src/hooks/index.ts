/**
 * Plugin Hook System
 *
 * Event-driven plugin hooks for observing and modifying pipeline stages.
 *
 * @example
 * ```typescript
 * import { getHookRegistry, executeHooks } from '@omni/core';
 *
 * const registry = getHookRegistry();
 *
 * // Register a hook to observe LLM inputs
 * registry.register('instance-1', {
 *   event: 'llm_input',
 *   handler: async (ctx) => {
 *     console.log('LLM input:', ctx.messages);
 *   },
 *   priority: 10,
 * });
 *
 * // Execute hooks at a pipeline stage
 * const result = await executeHooks('instance-1', 'llm_input', {
 *   instanceId: 'instance-1',
 *   chatId: 'chat-1',
 *   senderId: 'user-1',
 *   messages: ['Hello, world!'],
 * });
 * ```
 */

// Types
export {
  HOOK_EVENTS,
  READ_ONLY_HOOKS,
  MUTABLE_HOOKS,
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_HOOK_PRIORITY,
  MIN_HOOK_PRIORITY,
  MAX_HOOK_PRIORITY,
  BeforeAgentStartContextSchema,
  LLMInputContextSchema,
  LLMOutputContextSchema,
  BeforeMessageWriteContextSchema,
  type HookEvent,
  type HookContextMap,
  type BeforeAgentStartContext,
  type LLMInputContext,
  type LLMOutputContext,
  type BeforeMessageWriteContext,
  type HookHandlerFn,
  type HookHandler,
  type HookExecutionOptions,
  type HookExecutionResult,
  type HookPipelineResult,
} from './types';

// Registry
export { HookRegistry, getHookRegistry, resetHookRegistry, type RegisterHookInput } from './registry';

// Executor
export { executeHooks } from './executor';
