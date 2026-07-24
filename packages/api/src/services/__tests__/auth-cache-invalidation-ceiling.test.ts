/**
 * Auth-cache invalidation ceiling, proven with a SYNTHETIC clock
 * (wish: omni-full-multitenancy, Group G5, deliverable (c); ADR-0006;
 * RELEASE_SLOS `revocation.auth_cache_invalidation_seconds_max: 15`).
 *
 * The repository holds exactly two caches of AUTHORIZATION state:
 *
 *   * `apiKeyCache` — validated API keys (legacy TTL 60s). In-process
 *     revocation deletes the entry by hash immediately (`revoke()` →
 *     `apiKeyCache.delete`), so the TTL is the bound ONLY for out-of-band
 *     revocations (direct DB update from another process) — and 60s exceeds
 *     the 15s release ceiling.
 *   * `accessCache` — per-user/per-instance allow/deny decisions (legacy TTL
 *     5 minutes). Rule mutations clear it in-process; the TTL is again the
 *     out-of-band bound.
 *
 * The conversion is DUAL-WORLD, like every G5 enforcement: with multitenancy
 * ENABLED the caches write with TTL ≤ the ceiling, so any cached authorization
 * fact dies within 15s of the state that produced it changing anywhere; with
 * the flag off the legacy TTLs are byte-identical (60s / 300s — asserted here
 * so a regression in either direction fails).
 *
 * All timing is `setSystemTime` — no wall-clock waits, no production timing
 * claims. The tenant-plane credential path (G3 `requestAuthenticator`) caches
 * nothing — every request re-reads the auth plane, which is the
 * `new_api_or_privileged_action_check: next_authorization_check` shape — so
 * these two legacy-plane caches are the class's only subjects.
 */

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Database } from '@omni/db';
import { CacheTTL, apiKeyCache } from '../../cache';
import { AUTH_CACHE_INVALIDATION_CEILING_SECONDS, authCacheTtlMs } from '../../cache/cache-keys';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import { AccessService } from '../access';
import { ApiKeyService } from '../api-keys';

const T0 = new Date('2026-07-24T00:00:00.000Z');

/** A thenable that satisfies drizzle's fluent fire-and-forget update chain. */
function thenable(): { then: (fn?: () => void) => unknown; catch: () => unknown } {
  const t = {
    // biome-ignore lint/suspicious/noThenProperty: drizzle chains ARE thenables; the fake must mirror that surface
    then: (fn?: () => void) => {
      fn?.();
      return t;
    },
    catch: () => t,
  };
  return t;
}

/** A db whose SELECT returns the given api-key row and counts its reads. */
function fakeKeyDb(row: Record<string, unknown> | null): { db: Database; reads: { count: number } } {
  const reads = { count: 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            reads.count++;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => thenable() }) }),
  } as unknown as Database;
  return { db, reads };
}

function keyRow(keyHash: string): Record<string, unknown> {
  return {
    id: 'key-1',
    name: 'probe-key',
    status: 'active',
    expiresAt: null,
    scopes: ['*'],
    instanceIds: null,
    profile: null,
    chatAllowlist: [],
    instanceAllowlist: [],
    outboundRecipientAllowlist: [],
    profileOverrides: null,
    keyHash,
  };
}

afterEach(async () => {
  setSystemTime();
  delete process.env[MULTITENANCY_FLAG_ENV];
  await apiKeyCache.clear();
});

describe('the ceiling constant (RELEASE_SLOS auth_cache_invalidation_seconds_max)', () => {
  test('is 15 seconds, and the clamp helper binds it to the tenant world only', () => {
    expect(AUTH_CACHE_INVALIDATION_CEILING_SECONDS).toBe(15);

    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    expect(authCacheTtlMs(CacheTTL.API_KEY)).toBe(15_000);
    expect(authCacheTtlMs(CacheTTL.ACCESS_CHECK)).toBe(15_000);
    // A legacy TTL already under the ceiling is honoured, not raised.
    expect(authCacheTtlMs(5_000)).toBe(5_000);

    delete process.env[MULTITENANCY_FLAG_ENV];
    expect(authCacheTtlMs(CacheTTL.API_KEY)).toBe(CacheTTL.API_KEY);
    expect(authCacheTtlMs(CacheTTL.ACCESS_CHECK)).toBe(CacheTTL.ACCESS_CHECK);
  });
});

describe('apiKeyCache honours the ceiling in the tenant world (synthetic clock)', () => {
  const KEY = 'omni_sk_probe_auth_cache_ceiling';

  async function primedService(): Promise<{ service: ApiKeyService; reads: { count: number } }> {
    const service = new ApiKeyService({} as unknown as Database);
    const hash = await (service as unknown as { hashKey(k: string): Promise<string> }).hashKey(KEY);
    const { db, reads } = fakeKeyDb(keyRow(hash));
    (service as unknown as { db: Database }).db = db;
    return { service, reads };
  }

  test('flag-on: a cached validation dies within the 15s ceiling', async () => {
    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    setSystemTime(T0);
    const { service, reads } = await primedService();

    expect(await service.validate(KEY)).not.toBeNull();
    expect(reads.count).toBe(1);

    // Inside the ceiling: still served from cache — the clamp is a maximum,
    // not an eager expiry.
    setSystemTime(new Date(T0.getTime() + AUTH_CACHE_INVALIDATION_CEILING_SECONDS * 1000 - 1));
    expect(await service.validate(KEY)).not.toBeNull();
    expect(reads.count).toBe(1);

    // One millisecond past the ceiling: the cached authorization is GONE and
    // the next validation re-reads the database — an out-of-band revocation
    // becomes visible here, ≤ 15s after it landed.
    setSystemTime(new Date(T0.getTime() + AUTH_CACHE_INVALIDATION_CEILING_SECONDS * 1000 + 1));
    expect(await service.validate(KEY)).not.toBeNull();
    expect(reads.count).toBe(2);
  });

  test('flag-off: the legacy 60s TTL is byte-identical in both directions', async () => {
    setSystemTime(T0);
    const { service, reads } = await primedService();

    expect(await service.validate(KEY)).not.toBeNull();
    expect(reads.count).toBe(1);

    // Well past the tenant ceiling but inside the legacy TTL: STILL cached —
    // the clamp must not leak into the flag-off world.
    setSystemTime(new Date(T0.getTime() + 59_999));
    expect(await service.validate(KEY)).not.toBeNull();
    expect(reads.count).toBe(1);

    setSystemTime(new Date(T0.getTime() + 60_001));
    expect(await service.validate(KEY)).not.toBeNull();
    expect(reads.count).toBe(2);
  });

  test('in-process revocation invalidates immediately in BOTH worlds — the TTL is only the out-of-band bound', async () => {
    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    setSystemTime(T0);
    const service = new ApiKeyService({} as unknown as Database);
    const hash = await (service as unknown as { hashKey(k: string): Promise<string> }).hashKey(KEY);
    const row = keyRow(hash);
    const { db } = fakeKeyDb(row);
    // `revoke` drives update().returning(); `updateUsageAsync` drives the same
    // chain as a fire-and-forget thenable — the fake serves both.
    (db as unknown as { update: () => unknown }).update = () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: async () => [row],
            // biome-ignore lint/suspicious/noThenProperty: drizzle chains ARE thenables; the fake must mirror that surface
            then: (fn?: () => void) => {
              fn?.();
              return chain;
            },
            catch: () => chain,
          };
          return chain;
        },
      }),
    });
    (service as unknown as { db: Database }).db = db;

    expect(await service.validate(KEY)).not.toBeNull();
    await service.revoke('key-1', 'probe');

    // No clock advance at all: the cache entry is gone NOW.
    const { db: emptyDb } = fakeKeyDb(null);
    (service as unknown as { db: Database }).db = emptyDb;
    expect(await service.validate(KEY)).toBeNull();
  });
});

describe('accessCache honours the ceiling in the tenant world', () => {
  function accessHarness(): { service: AccessService; ttls: (number | undefined)[] } {
    const ttls: (number | undefined)[] = [];
    const cache = {
      get: async () => null,
      set: async (_k: string, _v: unknown, ttlMs?: number) => {
        ttls.push(ttlMs);
      },
      delete: async () => {},
      has: async () => false,
      clear: async () => {},
      stats: async () => ({ hits: 0, misses: 0, size: 0, evictions: 0 }),
      dispose: async () => {},
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => [],
            limit: async () => [],
          }),
        }),
      }),
    } as unknown as Database;
    const service = new AccessService(db, null, cache as never);
    return { service, ttls };
  }

  test('flag-on: allow/deny decisions are cached for at most the ceiling', async () => {
    process.env[MULTITENANCY_FLAG_ENV] = 'true';
    const { service, ttls } = accessHarness();
    await service.checkAccess({ id: 'inst-1', accessMode: 'allowlist' } as never, 'user-1', 'whatsapp-baileys');
    expect(ttls).toEqual([15_000]);
  });

  test('flag-off: the legacy 5-minute TTL is passed through unchanged', async () => {
    const { service, ttls } = accessHarness();
    await service.checkAccess({ id: 'inst-1', accessMode: 'allowlist' } as never, 'user-1', 'whatsapp-baileys');
    expect(ttls).toEqual([CacheTTL.ACCESS_CHECK]);
  });
});
