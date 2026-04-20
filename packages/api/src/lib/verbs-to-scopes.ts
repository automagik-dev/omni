/**
 * Pure resolver: profile shape → flat deduplicated sorted scope list.
 *
 * Profiles author capabilities as verb buckets (`outgoing`, `read`, …)
 * with optional per-verb fine-tuning via `verbs.add` / `verbs.remove`.
 * The enforcer reads a flat `scopes` column on `agent_keys`; this resolver
 * runs at key-creation time to collapse a template into that flat list.
 *
 * When `verbs.add` or `verbs.remove` is supplied, the resolver expands
 * buckets into their constituent verbs, applies the add/remove, and maps
 * the final verb set through `verbToScopes`. Removing a single verb drops
 * only its specific scope contribution (e.g. dropping `use` from the
 * `context` bucket removes `instances:read` while leaving `context:write`
 * from `open` / `close` intact). When no verb overrides are supplied, the
 * resolver uses the bucket-level fast path; the two paths are kept in
 * sync because `bucketToScopes` is derived from `verbToScopes`.
 *
 * `verbs.add` and `verbs.remove` must be disjoint: an overlapping verb is
 * always a bug (the intent is ambiguous), so the resolver throws rather
 * than silently picking one side.
 */

import { type Verb, type VerbBucket, bucketToScopes, bucketToVerbs, verbToScopes } from '../constants/verbs';

export interface VerbsToScopesInput {
  buckets: VerbBucket[];
  /**
   * Per-verb overrides layered on top of `buckets`. `add` unions extra
   * verbs into the resolved set; `remove` subtracts verbs. The two lists
   * MUST be disjoint.
   */
  verbs?: { add?: Verb[]; remove?: Verb[] };
  extraScopes?: string[];
}

function hasAny<T>(list: T[] | undefined): list is T[] {
  return list !== undefined && list.length > 0;
}

function assertDisjoint(add: Verb[] | undefined, remove: Verb[] | undefined): void {
  if (!hasAny(add) || !hasAny(remove)) return;
  const removeSet = new Set(remove);
  const overlap = add.filter((v) => removeSet.has(v));
  if (overlap.length > 0) {
    throw new Error(`verbs.add and verbs.remove cannot overlap: [${overlap.join(', ')}]`);
  }
}

function collectBucketScopes(buckets: VerbBucket[]): string[] {
  const out: string[] = [];
  for (const bucket of buckets) {
    const scopes = bucketToScopes[bucket];
    if (scopes) out.push(...scopes);
  }
  return out;
}

function collectVerbScopes(buckets: VerbBucket[], add: Verb[] | undefined, remove: Verb[] | undefined): string[] {
  const verbSet = new Set<Verb>();
  for (const bucket of buckets) {
    const bucketVerbs = bucketToVerbs[bucket];
    if (bucketVerbs) for (const verb of bucketVerbs) verbSet.add(verb);
  }
  if (add) for (const v of add) verbSet.add(v);
  if (remove) for (const v of remove) verbSet.delete(v);

  const out: string[] = [];
  for (const verb of verbSet) {
    const scopes = verbToScopes[verb];
    if (scopes) out.push(...scopes);
  }
  return out;
}

export function verbsToScopes(input: VerbsToScopesInput): string[] {
  const { buckets, verbs, extraScopes } = input;
  assertDisjoint(verbs?.add, verbs?.remove);

  const usesVerbOverrides = hasAny(verbs?.add) || hasAny(verbs?.remove);
  const collected = usesVerbOverrides
    ? collectVerbScopes(buckets, verbs?.add, verbs?.remove)
    : collectBucketScopes(buckets);

  if (extraScopes) collected.push(...extraScopes);
  return Array.from(new Set(collected)).sort();
}
