/**
 * Per-user Omni console key lifecycle — the god-key → per-user bridge.
 *
 * On the first authenticated request for a KHAL user, mint an Omni API key
 * scoped to the user's resolved console profile via `POST /api/v2/keys`, then
 * cache the minted plaintext key by `userId` so subsequent requests reuse it
 * (one mint per user). Re-mint when the user's resolved profile changes (a role
 * change) or, when a TTL is configured, when the cached entry has expired.
 * Injecting this per-user key (instead of a shared god-key) is what gives
 * per-user attribution in omni's `apiKeyAuditLogs`.
 *
 * Cache is in-memory (Phase 1): bounded by the number of distinct console users
 * (an admin surface — small). TTL is OFF by default; when set, an expired entry
 * forces a FRESH mint (a new key row, the old one is left in place), so keep it
 * generous. A Phase-2 hardening would reuse/validate the existing row or revoke
 * the superseded key on rotation rather than mint fresh, and add size eviction.
 *
 * ⚠️ MINTING CREDENTIAL — DEPLOY REQUIREMENT. `POST /api/v2/keys` enforces a
 * mint ceiling (`packages/api/src/routes/v2/keys.ts` `enforceMintCeiling`): a
 * caller may only mint scopes that are a SUBSET of its OWN. The credential this
 * module mints with (`mintKey`, env `OMNI_MINT_KEY`) MUST therefore hold a
 * SUPERSET of the console scopes it mints — i.e. the primary `*` key, OR a
 * dedicated key carrying at least every `console-admin` scope PLUS `keys:write`.
 * A deploy that gives the BFF only a `keys:write` key will get 403 on EVERY
 * mint. Keep this credential server-side only (same ExternalSecret pattern as
 * today's god-key).
 */

import type { ConsoleProfile } from './roles';

/** Minimal fetch signature — avoids `typeof fetch`'s `preconnect` member so tests can inject a plain function. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MintedKey {
  /** Plaintext Omni API key to inject as `x-api-key` for this user's requests. */
  apiKey: string;
  /** Public key prefix, for attribution/logging only (never the secret). */
  keyPrefix: string;
}

interface CacheEntry extends MintedKey {
  profile: ConsoleProfile;
  mintedAt: number;
}

/** Thrown when a per-user key cannot be provisioned; the caller fails closed. */
export class ConsoleKeyMintError extends Error {
  readonly upstreamStatus?: number;
  constructor(message: string, upstreamStatus?: number) {
    super(message);
    this.name = 'ConsoleKeyMintError';
    this.upstreamStatus = upstreamStatus;
  }
}

export interface ConsoleKeyProviderConfig {
  /** Omni backend base URL (trailing slash tolerated). */
  baseUrl: string;
  /** Credential used to authenticate the mint call (see module doc — DEPLOY REQUIREMENT). */
  mintKey: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Cache entry lifetime in ms. `0` (default) disables time-based eviction. */
  ttlMs?: number;
  /** Injectable clock for tests (ms since epoch). */
  now?: () => number;
}

interface CreateKeyResponseData {
  plainTextKey?: string;
  keyPrefix?: string;
}

export class ConsoleKeyProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly baseUrl: string;
  private readonly mintKey: string;
  private readonly doFetch: FetchLike;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(config: ConsoleKeyProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.mintKey = config.mintKey;
    this.doFetch = config.fetchImpl ?? fetch;
    this.ttlMs = config.ttlMs ?? 0;
    this.now = config.now ?? Date.now;
  }

  /** Deterministic per-user key name → stable, per-user attribution in the key table. */
  private static keyName(userId: string): string {
    return `khal:${userId}`;
  }

  private isFresh(entry: CacheEntry, profile: ConsoleProfile): boolean {
    if (entry.profile !== profile) return false;
    if (this.ttlMs > 0 && this.now() - entry.mintedAt >= this.ttlMs) return false;
    return true;
  }

  /** Return this user's key for `profile`, minting (and caching) it on first use or profile change. */
  async keyFor(userId: string, profile: ConsoleProfile): Promise<MintedKey> {
    const cached = this.cache.get(userId);
    if (cached && this.isFresh(cached, profile)) {
      return { apiKey: cached.apiKey, keyPrefix: cached.keyPrefix };
    }
    const minted = await this.mint(userId, profile);
    this.cache.set(userId, { ...minted, profile, mintedAt: this.now() });
    return minted;
  }

  private async mint(userId: string, profile: ConsoleProfile): Promise<MintedKey> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/api/v2/keys`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.mintKey,
          'accept-encoding': 'identity',
        },
        body: JSON.stringify({ name: ConsoleKeyProvider.keyName(userId), profile }),
      });
    } catch {
      throw new ConsoleKeyMintError('Could not reach the Omni key service to mint a console key.');
    }
    if (!res.ok) {
      // 403 here almost always means the mint ceiling rejected us — the mintKey
      // does not hold a superset of the requested console scopes (see module doc).
      throw new ConsoleKeyMintError('Omni rejected the console key mint request.', res.status);
    }
    const body = (await res.json().catch(() => ({}))) as { data?: CreateKeyResponseData };
    const apiKey = body.data?.plainTextKey;
    if (!apiKey) {
      throw new ConsoleKeyMintError('Mint response did not include a key.');
    }
    return { apiKey, keyPrefix: body.data?.keyPrefix ?? '' };
  }
}
