import { describe, expect, test } from 'bun:test';
import { createThreadStarterCache } from '../thread-cache';

describe('createThreadStarterCache', () => {
  test('returns undefined for unknown key', () => {
    const cache = createThreadStarterCache<string>();
    expect(cache.get('c:1234')).toBeUndefined();
    cache.dispose();
  });

  test('get returns resolved Promise after set', async () => {
    const cache = createThreadStarterCache<string>();
    cache.set('c:ts1', 'thread-data');
    const result = cache.get('c:ts1');
    expect(result).toBeDefined();
    expect(await result).toBe('thread-data');
    cache.dispose();
  });

  test('has() returns true after set, false for unknown', () => {
    const cache = createThreadStarterCache<string>();
    expect(cache.has('c:ts1')).toBe(false);
    cache.set('c:ts1', 'data');
    expect(cache.has('c:ts1')).toBe(true);
    cache.dispose();
  });

  test('TTL expiry: entry is not returned after TTL', async () => {
    const cache = createThreadStarterCache<string>({ ttlMs: 50 });
    cache.set('c:ts1', 'data');
    expect(cache.has('c:ts1')).toBe(true);

    await new Promise((r) => setTimeout(r, 60));

    expect(cache.has('c:ts1')).toBe(false);
    expect(cache.get('c:ts1')).toBeUndefined();
    cache.dispose();
  });

  test('max size enforcement: oldest evicted when full', () => {
    const cache = createThreadStarterCache<number>({ maxSize: 3 });
    cache.set('k1', 1);
    cache.set('k2', 2);
    cache.set('k3', 3);
    // Adding a 4th entry should evict k1 (oldest)
    cache.set('k4', 4);
    expect(cache.has('k1')).toBe(false);
    expect(cache.has('k4')).toBe(true);
    cache.dispose();
  });

  test('getOrFetch: calls fetcher on cache miss', async () => {
    const cache = createThreadStarterCache<string>();
    let fetchCount = 0;
    const result = await cache.getOrFetch('c:ts1', async () => {
      fetchCount++;
      return 'fetched-value';
    });
    expect(result).toBe('fetched-value');
    expect(fetchCount).toBe(1);
    cache.dispose();
  });

  test('getOrFetch: does not call fetcher on cache hit', async () => {
    const cache = createThreadStarterCache<string>();
    cache.set('c:ts1', 'cached-value');
    let fetchCount = 0;
    const result = await cache.getOrFetch('c:ts1', async () => {
      fetchCount++;
      return 'fetched-value';
    });
    expect(result).toBe('cached-value');
    expect(fetchCount).toBe(0);
    cache.dispose();
  });

  test('promise coalescing: concurrent requests for same key share one Promise', async () => {
    const cache = createThreadStarterCache<string>();
    let fetchCount = 0;

    const fetcher = () =>
      new Promise<string>((resolve) => {
        fetchCount++;
        setTimeout(() => resolve(`result-${fetchCount}`), 20);
      });

    // Launch two concurrent requests for the same key
    const [r1, r2] = await Promise.all([cache.getOrFetch('c:ts1', fetcher), cache.getOrFetch('c:ts1', fetcher)]);

    // Fetcher should only have been called once (coalesced)
    expect(fetchCount).toBe(1);
    // Both should resolve to the same value
    expect(r1).toBe(r2);
    cache.dispose();
  });

  test('promise coalescing: get() returns in-flight promise', async () => {
    const cache = createThreadStarterCache<string>();
    let resolveIt!: (v: string) => void;
    const inflight = new Promise<string>((resolve) => {
      resolveIt = resolve;
    });

    // Start a fetch that doesn't resolve yet
    const p1 = cache.getOrFetch('c:ts1', () => inflight);
    // get() should return the same in-flight promise
    const p2 = cache.get('c:ts1');
    expect(p2).toBeDefined();

    // Resolve the fetch
    resolveIt('done');
    if (!p2) throw new Error('expected in-flight promise');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('done');
    expect(r2).toBe('done');
    cache.dispose();
  });

  test('getOrFetch: clears inflight on error and allows retry', async () => {
    const cache = createThreadStarterCache<string>();
    let attempt = 0;

    await expect(
      cache.getOrFetch('c:ts1', async () => {
        attempt++;
        throw new Error('fetch failed');
      }),
    ).rejects.toThrow('fetch failed');

    // Second attempt should call the fetcher again (not return a cached error)
    const result = await cache.getOrFetch('c:ts1', async () => {
      attempt++;
      return 'recovered';
    });
    expect(result).toBe('recovered');
    expect(attempt).toBe(2);
    cache.dispose();
  });

  test('dispose() clears cache and inflight', async () => {
    const cache = createThreadStarterCache<string>();
    cache.set('k1', 'v1');
    expect(cache.has('k1')).toBe(true);

    cache.dispose();

    // After dispose, cache should be empty
    expect(cache.has('k1')).toBe(false);
    expect(cache.get('k1')).toBeUndefined();
  });

  test('set() clears in-flight entry for same key', async () => {
    const cache = createThreadStarterCache<string>();

    let resolveInflight!: (v: string) => void;
    const inflight = new Promise<string>((r) => {
      resolveInflight = r;
    });

    // Register an in-flight fetch
    const fetchPromise = cache.getOrFetch('k1', () => inflight);

    // In-flight should be visible via get()
    expect(cache.get('k1')).toBeDefined();

    // Directly set a value — should clear the in-flight entry
    cache.set('k1', 'direct-value');

    // get() should now return the direct value
    const cached = cache.get('k1');
    expect(cached).toBeDefined();
    expect(await cached).toBe('direct-value');

    // Resolve the original inflight to avoid hanging promises
    resolveInflight('inflight-value');
    await fetchPromise; // Just to ensure it resolves
    cache.dispose();
  });
});
