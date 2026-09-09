/**
 * Driver-error unwrapping for drizzle-orm >= 0.44.
 *
 * Since 0.44.0 drizzle wraps every driver error thrown by a query in
 * `DrizzleQueryError` (`pg-core/session.ts`): the wrapper's message is the
 * failed SQL + params, and the original `PostgresError` — the one carrying
 * `code`, `constraint`, `detail`, and the server's message — moves to `cause`.
 * Every consumer that classifies database failures by SQLSTATE (unique
 * violations → 409, RLS denials, FK violations → 400) must therefore look
 * through the wrapper.
 */

import { DrizzleQueryError } from 'drizzle-orm';

/**
 * Return the underlying driver error for a failed query, or the value itself
 * when it is not a drizzle query wrapper. Callers keep duck-typing the result
 * (`code`, `constraint`, …) exactly as they did before 0.44 — this helper only
 * removes the wrapper, it does not assert what is underneath.
 */
export function unwrapDbError(error: unknown): unknown {
  let current: unknown = error;
  // Bounded walk: wrappers should never nest, but a cycle in `cause` must not
  // hang the error path of all places.
  for (let depth = 0; depth < 5 && current instanceof DrizzleQueryError && current.cause != null; depth++) {
    current = current.cause;
  }
  return current;
}
