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

import type { z } from 'zod';
import { createLogger } from '../logger';
import { type HookRegistry, getHookRegistry } from './registry';
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  HookContextSchemas,
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
// Deep Freeze Helper
// ============================================================================

/**
 * Recursively freeze an object and all nested objects/arrays.
 * Enforces the read-only contract on hook contexts by preventing
 * mutations to nested references (arrays, nested objects, etc.)
 * that a shallow Object.freeze would leave mutable.
 */
function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj as Readonly<T>;
  }
  // Freeze nested values depth-first so children are immutable before parent
  for (const key of Object.keys(obj as object)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return Object.freeze(obj as object) as Readonly<T>;
}

// ============================================================================
// Timeout Helper
// ============================================================================

/**
 * Race a promise against a timeout.
 * On timeout, aborts `controller` so the handler can self-cancel via its AbortSignal.
 * Returns { result, timedOut }.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<{ result: T; timedOut: false } | { result: undefined; timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<{ result: undefined; timedOut: true }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ result: undefined, timedOut: true });
    }, timeoutMs);
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
  const controller = new AbortController();

  try {
    const handlerPromise = Promise.resolve(hook.handler(handlerContext, controller.signal));
    const outcome = await withTimeout(handlerPromise, timeoutMs, controller);

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

  // For read-only hooks, deep-clone then deep-freeze the context so that:
  // 1. Hooks cannot mutate nested references (arrays, objects) — deepFreeze enforces this.
  // 2. Caller-owned objects are never frozen — structuredClone isolates the copy first.
  const frozenContext = isReadOnly ? (deepFreeze(structuredClone(context)) as HookContextMap[E]) : undefined;
  let currentContext = context;
  const results: HookExecutionResult[] = [];

  for (const hook of hooks) {
    // For read-only hooks: use the pre-frozen clone shared across all hooks.
    // For mutable hooks: clone the current context snapshot so that a hook
    // mutating `ctx` in-place cannot pollute the pipeline if it times out or throws.
    const handlerContext = frozenContext ?? (structuredClone(currentContext) as HookContextMap[E]);
    const { result, returnedContext } = await executeSingleHook(hook, handlerContext, timeoutMs, event, instanceId);

    if (!isReadOnly && returnedContext !== undefined) {
      // Validate the returned context against the event's Zod schema before
      // committing it to the pipeline. A malformed return (from a JS hook or a
      // buggy TS hook) is rejected and recorded as an error rather than
      // silently propagated to downstream stages.
      const schema = HookContextSchemas[event] as z.ZodTypeAny;
      const parsed = schema.safeParse(returnedContext);
      if (parsed.success) {
        currentContext = parsed.data as HookContextMap[E];
        results.push(result);
      } else {
        const errorMessage = `Hook returned invalid context: ${(parsed.error as z.ZodError).message}`;
        log.warn('Hook returned invalid context shape, rejecting update', {
          hookId: hook.id,
          hookName: hook.name,
          event,
          instanceId,
          errors: (parsed.error as z.ZodError).errors,
        });
        results.push({
          hookId: result.hookId,
          hookName: result.hookName,
          status: 'error',
          durationMs: result.durationMs,
          error: errorMessage,
        });
      }
    } else {
      results.push(result);
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
