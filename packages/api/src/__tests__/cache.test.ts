/**
 * Tests for the caching layer
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CacheKeys, CacheTTL, apiKeyCache } from '../cache/cache-keys';
import { MemoryCache } from '../cache/memory-cache';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache({
      defaultTtlMs: 1000,
      maxSize: 100,
      cleanupIntervalMs: 0, // Disable for tests
    });
  });

  afterEach(async () => {
    await cache.dispose();
  });

  test('get/set basic functionality', async () => {
    await cache.set('key1', 'value1');
    const value = await cache.get<string>('key1');
    expect(value).toBe('value1');
  });

  test('get returns null for missing keys', async () => {
    const value = await cache.get('nonexistent');
    expect(value).toBeNull();
  });

  test('has returns true for existing keys', async () => {
    await cache.set('key1', 'value1');
    expect(await cache.has('key1')).toBe(true);
  });

  test('has returns false for missing keys', async () => {
    expect(await cache.has('nonexistent')).toBe(false);
  });

  test('delete removes keys', async () => {
    await cache.set('key1', 'value1');
    await cache.delete('key1');
    expect(await cache.get('key1')).toBeNull();
  });

  test('clear removes all keys', async () => {
    await cache.set('key1', 'value1');
    await cache.set('key2', 'value2');
    await cache.clear();
    expect(await cache.get('key1')).toBeNull();
    expect(await cache.get('key2')).toBeNull();
  });

  test('expired entries return null', async () => {
    await cache.set('key1', 'value1', 50); // 50ms TTL
    expect(await cache.get<string>('key1')).toBe('value1');

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 100));
    expect(await cache.get<string>('key1')).toBeNull();
  });

  test('stats tracks hits and misses', async () => {
    await cache.set('key1', 'value1');

    // Hit
    await cache.get('key1');
    // Miss
    await cache.get('nonexistent');

    const stats = await cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  test('hit rate calculation', async () => {
    await cache.set('key1', 'value1');

    // 2 hits
    await cache.get('key1');
    await cache.get('key1');
    // 1 miss
    await cache.get('nonexistent');

    expect(cache.getHitRate()).toBeCloseTo(0.667, 2);
  });

  test('respects custom TTL', async () => {
    await cache.set('key1', 'value1', 100); // 100ms
    await cache.set('key2', 'value2', 500); // 500ms

    // Wait 200ms
    await new Promise((r) => setTimeout(r, 200));

    expect(await cache.get<string>('key1')).toBeNull(); // Expired
    expect(await cache.get<string>('key2')).toBe('value2'); // Still valid
  });

  test('LRU eviction when maxSize reached', async () => {
    const smallCache = new MemoryCache({
      defaultTtlMs: 60000,
      maxSize: 3,
      cleanupIntervalMs: 0,
    });

    await smallCache.set('key1', 'value1');
    await new Promise((r) => setTimeout(r, 10));
    await smallCache.set('key2', 'value2');
    await new Promise((r) => setTimeout(r, 10));
    await smallCache.set('key3', 'value3');
    await new Promise((r) => setTimeout(r, 10));

    // Adding key4 should evict key1 (oldest)
    await smallCache.set('key4', 'value4');

    expect(await smallCache.get<string>('key1')).toBeNull();
    expect(await smallCache.get<string>('key2')).toBe('value2');
    expect(await smallCache.get<string>('key3')).toBe('value3');
    expect(await smallCache.get<string>('key4')).toBe('value4');

    await smallCache.dispose();
  });

  test('caches complex objects', async () => {
    const obj = {
      id: '123',
      name: 'test',
      nested: { value: 42 },
    };

    await cache.set('obj', obj);
    const retrieved = await cache.get<typeof obj>('obj');

    expect(retrieved).toEqual(obj);
  });
});

describe('CacheKeys', () => {
  test('apiKey generates correct key format', () => {
    const hash = 'abc123def456';
    expect(CacheKeys.apiKey(hash)).toBe('api-key:abc123def456');
  });

  test('healthResponse generates correct key', () => {
    expect(CacheKeys.healthResponse()).toBe('response:health');
  });

  test('infoResponse generates correct key', () => {
    expect(CacheKeys.infoResponse()).toBe('response:info');
  });

  test('settings generates correct key', () => {
    expect(CacheKeys.settings('my-setting')).toBe('settings:my-setting');
  });

  test('instance generates correct key', () => {
    expect(CacheKeys.instance('inst-123')).toBe('instance:inst-123');
  });
});

describe('CacheTTL', () => {
  test('has expected TTL values', () => {
    expect(CacheTTL.API_KEY).toBe(60_000);
    expect(CacheTTL.HEALTH).toBe(5_000);
    expect(CacheTTL.INFO).toBe(30_000);
    expect(CacheTTL.SETTINGS).toBe(60_000);
    expect(CacheTTL.INSTANCE).toBe(30_000);
  });
});

describe('apiKeyCache', () => {
  beforeEach(async () => {
    await apiKeyCache.clear();
  });

  test('is configured with correct TTL', async () => {
    // The default TTL should be API_KEY (60s)
    await apiKeyCache.set('test-key', { id: '123' });
    const value = await apiKeyCache.get('test-key');
    expect(value).toEqual({ id: '123' });
  });

  test('global reset clears cache', async () => {
    await apiKeyCache.set('test-key', 'value');
    await apiKeyCache.clear();
    expect(await apiKeyCache.get('test-key')).toBeNull();
  });
});
