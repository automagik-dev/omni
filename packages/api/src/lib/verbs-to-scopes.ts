/**
 * Pure resolver: profile shape → flat deduplicated sorted scope list.
 *
 * Profiles author capabilities as verb buckets (`outgoing`, `read`, …).
 * The enforcer reads a flat `scopes` column on `agent_keys`. This resolver
 * is the bridge: it runs at key-creation time, collapses every bucket to
 * its underlying scopes via `bucketToScopes`, unions in any per-template
 * extras, dedupes, and sorts. Sorted output makes snapshot tests and
 * DB-column diffs deterministic.
 */

import { type VerbBucket, bucketToScopes } from '../constants/verbs';

export interface VerbsToScopesInput {
  buckets: VerbBucket[];
  extraScopes?: string[];
}

export function verbsToScopes(input: VerbsToScopesInput): string[] {
  const collected: string[] = [];
  for (const bucket of input.buckets) {
    const scopes = bucketToScopes[bucket];
    if (scopes) collected.push(...scopes);
  }
  if (input.extraScopes) collected.push(...input.extraScopes);
  return Array.from(new Set(collected)).sort();
}
