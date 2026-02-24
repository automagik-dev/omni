/**
 * Plugin Hook System
 *
 * Barrel exports for the hook infrastructure.
 */

export {
  HOOK_EVENTS,
  MAX_HOOKS_PER_INSTANCE,
  DEFAULT_PIPELINE_TIMEOUT_MS,
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_HOOK_PRIORITY,
  MIN_HOOK_PRIORITY,
  MAX_HOOK_PRIORITY,
  HookContextSchemas,
  BeforeAgentStartContextSchema,
  BeforeMessageWriteContextSchema,
} from './types';

export type {
  HookEvent,
  HookContextMap,
  BeforeAgentStartContext,
  BeforeMessageWriteContext,
  HookHandlerFn,
  HookHandler,
  HookExecutionOptions,
  HookExecutionResult,
  HookPipelineResult,
} from './types';

export { HookRegistry, getHookRegistry } from './registry';
export type { RegisterHookInput } from './registry';

export { executeHooks } from './executor';
