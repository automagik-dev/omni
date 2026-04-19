/**
 * Canonical verb vocabulary and capability-bucket groupings.
 *
 * Agents interact with omni through verb commands (`say`, `react`, `send`, …).
 * Profiles compose verb buckets instead of raw scope strings, so consumers
 * never touch scope names. `bucketToScopes` is the resolver's source of truth:
 * a bucket expands to the union of underlying scopes its verbs require.
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

export const bucketToScopes: Record<VerbBucket, string[]> = {
  outgoing: ['messages:send'],
  read: ['chats:read'],
  context: ['context:write', 'instances:read'],
  turn: ['turns:close'],
  multimodal_in: ['media:read', 'messages:send'],
  multimodal_out: ['tts:synthesize', 'media:write', 'messages:send'],
};
