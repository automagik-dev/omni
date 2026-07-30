/**
 * In-memory ephemeral cache for OAuth access tokens during the Embedded
 * Signup flow.
 *
 * Why this exists
 * ---------------
 *
 * The naive flow returns the Meta `access_token` directly to the browser
 * after `/oauth/exchange` so the UI can show the user the list of phone
 * numbers and let them pick one before persisting via `/connect`. That
 * window leaves the long-lived token sitting in browser memory + the
 * exchange-response payload exposed to any code with DOM access (XSS,
 * compromised browser extensions, devtools snooping during dev).
 *
 * Instead, the exchange endpoint stashes the token here under an opaque
 * UUID and returns the UUID. The `/connect` endpoint accepts the UUID
 * as `exchangeHandle` and resolves the token server-side — never crossing
 * the wire after the initial Meta call.
 *
 * The handle has a tight TTL (5 minutes) — long enough for any reasonable
 * Embedded Signup wizard flow, short enough that a hijacked handle is
 * useless within seconds of the user finishing onboarding. There's also
 * a hard size cap (LRU eviction) so a runaway client can't OOM the API.
 *
 * Multi-replica deployments
 * -------------------------
 *
 * This is **process-local**. The exchange and connect calls MUST land on
 * the same replica. Omni's standard PM2 single-process deployment is
 * fine; if/when API replicas land, swap this for Redis with the same
 * surface (`put` / `take` / `evictExpired`).
 *
 * Tokens are NEVER logged or serialized — only the handle UUID appears
 * in trace logs.
 */

import { randomUUID } from 'node:crypto';

interface CacheEntry {
  /** Long-lived Meta access token. NEVER log or include in errors. */
  accessToken: string;
  /** Unix ms when this entry expires. */
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 100;

const store = new Map<string, CacheEntry>();

/**
 * Store an access token and return an opaque handle the caller can hand
 * to the browser. The token is single-use: the matching `take(handle)`
 * removes the entry so a replayed handle resolves to `undefined`.
 */
export function put(accessToken: string, ttlMs: number = DEFAULT_TTL_MS): string {
  if (!accessToken) throw new Error('oauth-token-cache: accessToken is required');

  // Cheap LRU: when at cap, evict the oldest entry by insertion order.
  // (Map iteration is insertion-ordered in JS.)
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }

  const handle = `eshandle_${randomUUID()}`;
  store.set(handle, { accessToken, expiresAt: Date.now() + ttlMs });
  return handle;
}

/**
 * Consume a handle. Returns the token once, then deletes the entry.
 * Returns `undefined` if the handle is unknown or expired.
 */
export function take(handle: string): string | undefined {
  const entry = store.get(handle);
  if (!entry) return undefined;
  store.delete(handle);
  if (entry.expiresAt < Date.now()) return undefined;
  return entry.accessToken;
}
