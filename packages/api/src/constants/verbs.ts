/**
 * Canonical verb vocabulary and capability-bucket groupings.
 *
 * Agents interact with omni through verb commands (`say`, `react`, `send`, …).
 * Profiles compose verb buckets instead of raw scope strings, so consumers
 * never touch scope names. The per-verb `verbToScopes` table is the source
 * of truth; `bucketToScopes` is a derived convenience view. When a profile
 * template supplies `verbs.add` / `verbs.remove`, the resolver MUST operate
 * on the verb-level table so individual verb contributions can be dropped
 * without collapsing a whole bucket.
 */

export const VERBS = {
  send: 'send',
  say: 'say',
  react: 'react',
  history: 'history',
  where: 'where',
  open: 'open',
  close: 'close',
  use: 'use',
  done: 'done',
  listen: 'listen',
  see: 'see',
  speak: 'speak',
  imagine: 'imagine',
  film: 'film',
} as const;

export type Verb = (typeof VERBS)[keyof typeof VERBS];

export type VerbBucket = 'outgoing' | 'read' | 'context' | 'turn' | 'multimodal_in' | 'multimodal_out';

export const VERB_BUCKETS: Record<Verb, VerbBucket> = {
  send: 'outgoing',
  say: 'outgoing',
  react: 'outgoing',
  history: 'read',
  where: 'read',
  open: 'context',
  close: 'context',
  use: 'context',
  done: 'turn',
  listen: 'multimodal_in',
  see: 'multimodal_in',
  speak: 'multimodal_out',
  imagine: 'multimodal_out',
  film: 'multimodal_out',
};

/**
 * Per-verb scope contributions. Source of truth for scope resolution.
 * Profiles use verb buckets as a convenient shorthand, but `verbs.remove`
 * on a template only has meaning if each verb has its own scope row here.
 * Notes:
 * - `history` and `where` both resolve to `chats:read` today. Keeping them
 *   distinct is a structural commitment: a future `chats:history:read`
 *   scope could be introduced without touching bucket authoring code.
 * - `use` is the only context verb that yields `instances:read`, so
 *   removing it drops that scope cleanly (CS profile relies on this).
 */
export const verbToScopes: Record<Verb, string[]> = {
  send: ['messages:send'],
  say: ['messages:send'],
  react: ['messages:send'],
  history: ['chats:read'],
  where: ['chats:read'],
  open: ['context:write'],
  close: ['context:write'],
  use: ['instances:read'],
  done: ['turns:close'],
  listen: ['media:read', 'messages:send'],
  see: ['media:read'],
  speak: ['tts:synthesize', 'media:write', 'messages:send'],
  imagine: ['media:write', 'messages:send'],
  film: ['media:write', 'messages:send'],
};

/** Reverse map: bucket → its constituent verbs. Derived from VERB_BUCKETS. */
export const bucketToVerbs: Record<VerbBucket, Verb[]> = (() => {
  const out: Record<VerbBucket, Verb[]> = {
    outgoing: [],
    read: [],
    context: [],
    turn: [],
    multimodal_in: [],
    multimodal_out: [],
  };
  for (const [verb, bucket] of Object.entries(VERB_BUCKETS) as [Verb, VerbBucket][]) {
    out[bucket].push(verb);
  }
  return out;
})();

/**
 * Convenience view: union of verb-level scopes for each bucket. Derived
 * from `verbToScopes` so the two tables cannot drift. The resolver uses
 * this fast path when a template has no `verbs.add` / `verbs.remove`.
 */
export const bucketToScopes: Record<VerbBucket, string[]> = (() => {
  const out = {} as Record<VerbBucket, string[]>;
  for (const bucket of Object.keys(bucketToVerbs) as VerbBucket[]) {
    const scopes = new Set<string>();
    for (const verb of bucketToVerbs[bucket]) {
      for (const s of verbToScopes[verb]) scopes.add(s);
    }
    out[bucket] = Array.from(scopes);
  }
  return out;
})();
