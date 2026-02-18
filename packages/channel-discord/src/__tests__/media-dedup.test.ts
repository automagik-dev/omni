import { beforeEach, describe, expect, test } from 'bun:test';
import { MediaDedup } from '../senders/media-dedup';

describe('MediaDedup', () => {
  let dedup: MediaDedup;

  beforeEach(() => {
    dedup = new MediaDedup({ ttlMs: 1000, maxEntries: 5 });
  });

  test('first send is not a duplicate', () => {
    const data = Buffer.from('hello world');
    expect(dedup.isDuplicate(data)).toBe(false);
  });

  test('same data within TTL is duplicate', () => {
    const data = Buffer.from('hello world');
    dedup.markSent(data);
    expect(dedup.isDuplicate(data)).toBe(true);
  });

  test('different data is not duplicate', () => {
    const data1 = Buffer.from('hello world');
    const data2 = Buffer.from('different content');
    dedup.markSent(data1);
    expect(dedup.isDuplicate(data2)).toBe(false);
  });

  test('checkAndMark returns false on first call, true on second', () => {
    const data = Buffer.from('test data');
    expect(dedup.checkAndMark(data)).toBe(false);
    expect(dedup.checkAndMark(data)).toBe(true);
  });

  test('expired entries are not duplicates', async () => {
    const shortTtl = new MediaDedup({ ttlMs: 50 });
    const data = Buffer.from('expiring');
    shortTtl.markSent(data);
    expect(shortTtl.isDuplicate(data)).toBe(true);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shortTtl.isDuplicate(data)).toBe(false);
  });

  test('LRU eviction enforces max entries', () => {
    for (let i = 0; i < 10; i++) {
      dedup.markSent(Buffer.from(`entry-${i}`));
    }
    // Max is 5, so old entries should be evicted
    expect(dedup.size).toBeLessThanOrEqual(5);
  });

  test('clear empties the cache', () => {
    dedup.markSent(Buffer.from('test'));
    expect(dedup.size).toBe(1);
    dedup.clear();
    expect(dedup.size).toBe(0);
  });

  test('computeHash is consistent', () => {
    const data = Buffer.from('consistent hash test');
    const hash1 = dedup.computeHash(data);
    const hash2 = dedup.computeHash(data);
    expect(hash1).toBe(hash2);
  });

  test('computeHash differs for different data', () => {
    const hash1 = dedup.computeHash(Buffer.from('data one'));
    const hash2 = dedup.computeHash(Buffer.from('data two'));
    expect(hash1).not.toBe(hash2);
  });

  test('large buffer uses only first 4KB for hash', () => {
    const large1 = Buffer.alloc(10000, 0x41); // 'AAAAA...'
    const large2 = Buffer.alloc(10000, 0x41);
    // Change bytes after 4KB
    large2[5000] = 0x42;
    // Same first 4KB + same size = same hash
    expect(dedup.computeHash(large1)).toBe(dedup.computeHash(large2));
  });
});
