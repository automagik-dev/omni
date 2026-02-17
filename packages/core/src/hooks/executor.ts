/**
 * Hook Executor
 *
 * Executes registered hooks for a given event with:
 * - Timeout enforcement (default 5s per hook — DEC-2)
 * - Error isolation (one hook failure doesn't block pipeline — DEC-3)
 * - Priority ordering (lower number = earlier — DEC-5)
 * - Read-only context for observation hooks (DEC-4)
 * - Performance timing logged at DEBUG level
 */

import { createLogger } from '../logger';
import { type HookRegistry, getHookRegistry } from './registry';
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  type HookContextMap,
  type HookEvent,
  type HookExecutionOptions,
  type HookExecutionResult,
  type HookHandler,
  type HookPipelineResult,
  READ_ONLY_HOOKS,
} from './types';

const log = createLogger('hooks:executor');

// ============================================================================
// Timeout Helper
// ============================================================================

/**
 * Race a promise against a timeout.
 * Returns { result, timedOut }.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ result: T; timedOut: false } | { result: undefined; timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<{ result: undefined; timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ result: undefined, timedOut: true }), timeoutMs);
  });

  try {
    const result = await Promise.race([promise.then((r) => ({ result: r, timedOut: false as const })), timeout]);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ============================================================================
// Single Hook Execution
// ============================================================================

/**
 * Execute a single hook with timeout and error isolation.
 */
async function executeSingleHook<E extends HookEvent>(
  hook: HookHandler<E>,
  handlerContext: HookContextMap[E],
  timeoutMs: number,
  event: E,
  instanceId: string,
): Promise<{ result: HookExecutionResult; returnedContext?: HookContextMap[E] }> {
  const hookStart = performance.now();

  try {
    const handlerPromise = Promise.resolve(hook.handler(handlerContext));
    const outcome = await withTimeout(handlerPromise, timeoutMs);

    if (outcome.timedOut) {
      const durationMs = performance.now() - hookStart;
      log.warn('Hook timed out', { hookId: hook.id, hookName: hook.name, event, instanceId, timeoutMs, durationMs });
      return { result: { hookId: hook.id, hookName: hook.name, status: 'timeout', durationMs } };
    }

    const durationMs = performance.now() - hookStart;
    log.debug('Hook executed', {
      hookId: hook.id,
      hookName: hook.name,
      event,
      instanceId,
      durationMs: Math.round(durationMs * 100) / 100,
    });

    return {
      result: { hookId: hook.id, hookName: hook.name, status: 'success', durationMs },
      returnedContext: outcome.result != null ? (outcome.result as HookContextMap[E]) : undefined,
    };
  } catch (error) {
    const durationMs = performance.now() - hookStart;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.warn('Hook execution failed', {
      hookId: hook.id,
      hookName: hook.name,
      event,
      instanceId,
      error: errorMessage,
      durationMs,
    });

    return {
      result: { hookId: hook.id, hookName: hook.name, status: 'error', durationMs, error: errorMessage },
    };
  }
}

// ============================================================================
// Hook Executor
// ============================================================================

/**
 * Execute all registered hooks for a given event on an instance.
 *
 * For read-only hooks (llm_input, llm_output): context is frozen, return values ignored.
 * For mutable hooks (before_agent_start, before_message_write): each hook can return
 * a modified context that is passed to the next hook in the chain.
 *
 * @param instanceId - The channel instance ID
 * @param event - The hook event to fire
 * @param context - The initial context for the hooks
 * @param options - Execution options (timeout, etc.)
 * @param registry - Optional registry override (defaults to global)
 * @returns Pipeline result with final context and execution details
 */
export async function executeHooks<E extends HookEvent>(
  instanceId: string,
  event: E,
  context: HookContextMap[E],
  options?: HookExecutionOptions,
  registry?: HookRegistry,
): Promise<HookPipelineResult<E>> {
  const reg = registry ?? getHookRegistry();
  const hooks = reg.getHooks(instanceId, event);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const isReadOnly = (READ_ONLY_HOOKS as readonly HookEvent[]).includes(event);

  const pipelineStart = performance.now();

  // Fast path: no hooks registered
  if (hooks.length === 0) {
    return { context, results: [], totalDurationMs: performance.now() - pipelineStart };
  }

  // For read-only hooks, freeze the context so handlers can't mutate it
  const frozenContext = isReadOnly ? Object.freeze({ ...context }) : undefined;
  let currentContext = context;
  const results: HookExecutionResult[] = [];

  for (const hook of hooks) {
    const handlerContext = frozenContext ?? currentContext;
    const { result, returnedContext } = await executeSingleHook(hook, handlerContext, timeoutMs, event, instanceId);
    results.push(result);

    // For mutable hooks, apply returned context if present
    if (!isReadOnly && returnedContext !== undefined) {
      currentContext = returnedContext;
    }
  }

  const totalDurationMs = performance.now() - pipelineStart;
  log.debug('Hook pipeline complete', {
    event,
    instanceId,
    hookCount: hooks.length,
    totalDurationMs: Math.round(totalDurationMs * 100) / 100,
  });

  return { context: currentContext, results, totalDurationMs };
}
