/**
 * Dedupe-by-id merge used by {@link useIncrementalPoll} and event feeds.
 *
 * Pure and framework-free so the merge semantics can be unit-tested without a
 * React render.
 */

export interface MergeByIdOptions {
  /** Cap the result length, dropping items from the tail (default: unbounded). */
  max?: number;
}

/**
 * Merge `incoming` into `existing`, deduped by id. `incoming` items win on
 * collision and keep their position; ordering is `incoming`-first then the
 * previously-seen `existing` items, which preserves a newest-first feed when the
 * caller passes freshly-fetched items ahead of the backlog. The result is capped
 * to `max` items from the head.
 */
export function mergeById<T>(
  existing: readonly T[],
  incoming: readonly T[],
  getId: (item: T) => string,
  options: MergeByIdOptions = {},
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const item of [...incoming, ...existing]) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }

  if (options.max !== undefined && merged.length > options.max) {
    merged.length = options.max;
  }
  return merged;
}
