/**
 * Hook Executor
 *
 * Executes registered hooks for a given event with:
 * - Per-hook timeout enforcement (default 5s — DEC-2)
 * - Global pipeline timeout (default 15s — DEC-4)
 * - Error isolation (one hook failure doesn't block pipeline — DEC-3)
 * - Priority ordering (lower number = earlier — DEC-5)
 * - Mutation audit logging at INFO level (DEC-10)
 * - structuredClone wrapped in try/catch for fail-open behavior
 */

import type { z } from 'zod';
import { createLogger } from '../logger';
import { type HookRegistry, getHookRegistry } from './registry';
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_PIPELINE_TIMEOUT_MS,
  type HookContextMap,
  HookContextSchemas,
  type HookEvent,
  type HookExecutionOptions,
  type HookExecutionResult,
  type HookHandler,
  type HookPipelineResult,
} from './types';

const log = createLogger('hooks:executor');

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
// Context Commit Helper
// ============================================================================

/**
 * Validate a hook's returned context and commit it if valid.
 * Returns the updated result entry (success or error).
 */
function commitContextUpdate<E extends HookEvent>(
  event: E,
  instanceId: string,
  hook: HookHandler<E>,
  baseResult: HookExecutionResult,
  contextBefore: HookContextMap[E],
  returnedContext: HookContextMap[E],
): { committed: HookContextMap[E] | null; result: HookExecutionResult } {
  const schema = HookContextSchemas[event] as z.ZodTypeAny;
  const parsed = schema.safeParse(returnedContext);

  if (!parsed.success) {
    const errorMessage = `Hook returned invalid context: ${(parsed.error as z.ZodError).message}`;
    log.warn('Hook returned invalid context shape, rejecting update', {
      hookId: hook.id,
      hookName: hook.name,
      event,
      instanceId,
      errors: (parsed.error as z.ZodError).errors,
    });
    return {
      committed: null,
      result: {
        hookId: baseResult.hookId,
        hookName: baseResult.hookName,
        status: 'error',
        durationMs: baseResult.durationMs,
        error: errorMessage,
      },
    };
  }

  // Mutation audit logging (DEC-10): log which top-level keys changed
  const changedFields = Object.keys(parsed.data as object).filter(
    (key) => (contextBefore as Record<string, unknown>)[key] !== (parsed.data as Record<string, unknown>)[key],
  );
  log.info('Hook executed', {
    hookId: hook.id,
    hookName: hook.name,
    event,
    instanceId,
    mutated: changedFields.length > 0,
    changedFields: changedFields.length > 0 ? changedFields : undefined,
  });

  return { committed: parsed.data as HookContextMap[E], result: baseResult };
}

// ============================================================================
// Pipeline Loop Helper
// ============================================================================

/**
 * Run the hook pipeline loop, respecting the global deadline.
 * Returns the accumulated results and the final context.
 */
async function runPipelineLoop<E extends HookEvent>(
  hooks: HookHandler<E>[],
  initialContext: HookContextMap[E],
  event: E,
  instanceId: string,
  timeoutMs: number,
  pipelineTimeoutMs: number,
): Promise<{ results: HookExecutionResult[]; finalContext: HookContextMap[E] }> {
  const results: HookExecutionResult[] = [];
  let currentContext = initialContext;
  let pipelineTimedOut = false;

  let pipelineTimer: ReturnType<typeof setTimeout> | undefined;
  const pipelineDeadline = new Promise<void>((resolve) => {
    pipelineTimer = setTimeout(() => {
      pipelineTimedOut = true;
      resolve();
    }, pipelineTimeoutMs);
  });

  for (const hook of hooks) {
    if (pipelineTimedOut) {
      log.warn('Hook pipeline global timeout reached, returning partial results', {
        event,
        instanceId,
        pipelineTimeoutMs,
        completedHooks: results.length,
        remainingHooks: hooks.length - results.length,
      });
      break;
    }

    let handlerContext: HookContextMap[E];
    try {
      handlerContext = structuredClone(currentContext) as HookContextMap[E];
    } catch {
      handlerContext = currentContext;
    }

    const hookExecution = executeSingleHook(hook, handlerContext, timeoutMs, event, instanceId);
    const outcome = await Promise.race([hookExecution, pipelineDeadline.then(() => null)]);

    if (outcome === null) {
      log.warn('Hook pipeline global timeout reached during hook execution, returning partial results', {
        event,
        instanceId,
        pipelineTimeoutMs,
        completedHooks: results.length,
      });
      break;
    }

    const { result, returnedContext } = outcome;

    if (returnedContext !== undefined) {
      const { committed, result: commitResult } = commitContextUpdate(
        event,
        instanceId,
        hook,
        result,
        currentContext,
        returnedContext,
      );
      if (committed !== null) currentContext = committed;
      results.push(commitResult);
    } else {
      results.push(result);
    }
  }

  // Clean up pipeline timer to prevent dangling timers under high throughput
  if (pipelineTimer) clearTimeout(pipelineTimer);

  return { results, finalContext: currentContext };
}

// ============================================================================
// Hook Executor
// ============================================================================

/**
 * Execute all registered hooks for a given event on an instance.
 *
 * All hooks are mutable: each hook can return a modified context that is
 * passed to the next hook in the chain. Hooks returning void leave context
 * unchanged.
 *
 * A global pipeline timeout (default 15s) caps total execution time. If the
 * budget expires, partial results with completed hooks are returned.
 *
 * @param instanceId - The channel instance ID
 * @param event - The hook event to fire
 * @param context - The initial context for the hooks
 * @param options - Execution options (timeout, pipelineTimeoutMs, etc.)
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
  const pipelineTimeoutMs = options?.pipelineTimeoutMs ?? DEFAULT_PIPELINE_TIMEOUT_MS;
  const pipelineStart = performance.now();

  if (hooks.length === 0) {
    return { context, results: [], totalDurationMs: performance.now() - pipelineStart };
  }

  // Wrap structuredClone in try/catch for fail-open behavior (e.g. DataCloneError)
  let initialContext: HookContextMap[E];
  try {
    initialContext = structuredClone(context) as HookContextMap[E];
  } catch (cloneError) {
    log.warn('structuredClone failed on hook context, skipping hooks for this event', {
      event,
      instanceId,
      error: cloneError instanceof Error ? cloneError.message : String(cloneError),
    });
    return { context, results: [], totalDurationMs: performance.now() - pipelineStart };
  }

  const { results, finalContext } = await runPipelineLoop(
    hooks,
    initialContext,
    event,
    instanceId,
    timeoutMs,
    pipelineTimeoutMs,
  );

  const totalDurationMs = performance.now() - pipelineStart;
  log.info('Hook pipeline complete', {
    event,
    instanceId,
    hookCount: hooks.length,
    completedCount: results.length,
    totalDurationMs: Math.round(totalDurationMs * 100) / 100,
  });

  return { context: finalContext, results, totalDurationMs };
}
