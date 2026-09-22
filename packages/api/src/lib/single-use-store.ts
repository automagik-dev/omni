/**
 * Process-local single-use handle store (wish: slack-personal-oauth).
 *
 * Generalizes the exchange-handle cache that `oauth-token-cache.ts` introduced
 * for the WhatsApp Embedded Signup flow: a value goes in, an opaque handle
 * comes out, and the value can be read back exactly once before its TTL
 * elapses. Callers that need a short-lived server-side record keyed by a
 * secret the browser carries (an OAuth `state`, an exchange handle) build on
 * this instead of keeping their own map.
 *
 * Semantics
 * ---------
 *
 *   * `put(value, ttlMs?)` stores `value` and returns a fresh handle
 *     (`<prefix><uuid>`). At `maxEntries` the OLDEST entry by insertion order is
 *     evicted first (Map iteration is insertion-ordered), so a runaway caller
 *     cannot grow the map without bound. Eviction fails the evicted flow
 *     closed; it never admits a stale record.
 *   * `take(handle)` returns the value once and deletes the entry, so a replayed
 *     handle resolves to `undefined`. An expired entry is deleted and reported
 *     as absent.
 *   * `transition(handle, value)` replaces the value under a KNOWN handle and
 *     re-arms its TTL, returning `false` for a handle this store never issued
 *     or whose lifetime has elapsed. A handle stays known for its remaining
 *     lifetime AFTER `take`, which is what lets one flow consume its record
 *     before doing any network work and still park a follow-up value under the
 *     same handle afterwards (the Slack OAuth callback takes the pending record
 *     before calling Slack and parks the outcome under the same nonce).
 *
 * Multi-replica deployments
 * -------------------------
 *
 * Process-local: the `put` and the `take` MUST land on the same replica. Omni's
 * single-process PM2 deployment is fine; when API replicas land, swap this for
 * Redis with the same three-method surface.
 *
 * Values are NEVER logged or serialized by this module; only handles appear
 * in trace logs.
 */

import { randomUUID } from 'node:crypto';

export interface SingleUseStoreOptions {
  /** Default lifetime of an entry, in ms; also the lifetime `transition` re-arms to. */
  ttlMs: number;
  /** Hard cap on live entries; the oldest by insertion order is evicted at the cap. */
  maxEntries: number;
  /** Handle prefix, so a handle from one store cannot be mistaken for another's. */
  prefix: string;
}

export interface SingleUseStore<T> {
  put(value: T, ttlMs?: number): string;
  take(handle: string): T | undefined;
  transition(handle: string, value: T): boolean;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export function createSingleUseStore<T>(opts: SingleUseStoreOptions): SingleUseStore<T> {
  const { ttlMs, maxEntries, prefix } = opts;
  if (!(ttlMs > 0)) throw new Error('single-use-store: ttlMs must be positive');
  if (!(maxEntries > 0)) throw new Error('single-use-store: maxEntries must be positive');

  /** Live values, insertion-ordered for eviction. */
  const entries = new Map<string, Entry<T>>();
  /**
   * Every handle this store issued and the moment it stops being known. A
   * taken handle stays here until that moment so `transition` can re-park a
   * value under it; an expired or evicted handle is forgotten and transition
   * refuses it. Bounded by the same cap as `entries`.
   */
  const issued = new Map<string, number>();

  function evictOldest(map: Map<string, unknown>): void {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }

  function remember(handle: string, expiresAt: number): void {
    issued.delete(handle);
    if (issued.size >= maxEntries) evictOldest(issued);
    issued.set(handle, expiresAt);
  }

  function store(handle: string, value: T, expiresAt: number): void {
    entries.delete(handle);
    if (entries.size >= maxEntries) evictOldest(entries);
    entries.set(handle, { value, expiresAt });
  }

  function isKnown(handle: string, now: number): boolean {
    const until = issued.get(handle);
    if (until === undefined) return false;
    if (until < now) {
      issued.delete(handle);
      entries.delete(handle);
      return false;
    }
    return true;
  }

  return {
    put(value: T, entryTtlMs: number = ttlMs): string {
      const handle = `${prefix}${randomUUID()}`;
      const expiresAt = Date.now() + entryTtlMs;
      remember(handle, expiresAt);
      store(handle, value, expiresAt);
      return handle;
    },

    take(handle: string): T | undefined {
      const entry = entries.get(handle);
      if (!entry) return undefined;
      entries.delete(handle);
      if (entry.expiresAt < Date.now()) {
        issued.delete(handle);
        return undefined;
      }
      return entry.value;
    },

    transition(handle: string, value: T): boolean {
      const now = Date.now();
      if (!isKnown(handle, now)) return false;
      const expiresAt = now + ttlMs;
      remember(handle, expiresAt);
      store(handle, value, expiresAt);
      return true;
    },
  };
}
