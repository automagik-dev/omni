import { describe, expect, test } from 'bun:test';
import { extractPlatformTimestamp } from '../message-persistence';

describe('extractPlatformTimestamp', () => {
  const FALLBACK = Date.now();

  test('returns null when rawPayload is undefined', () => {
    expect(extractPlatformTimestamp(undefined, FALLBACK)).toBeNull();
  });

  test('returns null when messageTimestamp is missing', () => {
    expect(extractPlatformTimestamp({}, FALLBACK)).toBeNull();
  });

  test('returns null when messageTimestamp is 0', () => {
    expect(extractPlatformTimestamp({ messageTimestamp: 0 }, FALLBACK)).toBeNull();
  });

  test('returns null when messageTimestamp is empty string', () => {
    expect(extractPlatformTimestamp({ messageTimestamp: '' }, FALLBACK)).toBeNull();
  });

  test('handles number timestamp in seconds', () => {
    const ts = 1746665253; // 2025-05-08
    const result = extractPlatformTimestamp({ messageTimestamp: ts }, FALLBACK);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(ts * 1000);
  });

  test('handles string timestamp in seconds', () => {
    const ts = '1746665253';
    const result = extractPlatformTimestamp({ messageTimestamp: ts }, FALLBACK);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(1746665253 * 1000);
  });

  test('handles Long object (protobuf uint64) with non-zero low, zero high', () => {
    // Baileys emits messageTimestamp as { low, high, unsigned } after deepSanitize
    const ts = 1746665253; // 2025-05-08
    const result = extractPlatformTimestamp(
      { messageTimestamp: { low: ts, high: 0, unsigned: false } },
      FALLBACK,
    );
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(ts * 1000);
  });

  test('handles Long object with high bits set (timestamps after 2038)', () => {
    // 2^32 = 4294967296; simulate ts = 4294967296 + 1 (just past the 2038 boundary)
    // In a signed int32, this would be low = 1, high = 1
    const hi = 1;
    const lo = 1;
    const expectedTs = hi * 0x100000000 + lo; // 4294967297 seconds
    const result = extractPlatformTimestamp(
      { messageTimestamp: { low: lo, high: hi, unsigned: false } },
      FALLBACK,
    );
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(expectedTs * 1000);
  });

  test('Long with negative low (signed int32 > 2^31 seconds) reconstructs correctly via >>> 0', () => {
    // 2147483648 = 0x80000000 — in int32 this is -2147483648
    // This is January 19, 2038 03:14:08 UTC
    const tsSeconds = 2147483648;
    // In a Long: high = 0, low = -2147483648 (signed int32 wrapping)
    const signedLow = -2147483648; // 0x80000000 as int32
    const result = extractPlatformTimestamp(
      { messageTimestamp: { low: signedLow, high: 0, unsigned: false } },
      FALLBACK,
    );
    expect(result).not.toBeNull();
    // (signedLow >>> 0) = 2147483648, which is the correct seconds value
    expect(result!.getTime()).toBe(tsSeconds * 1000);
  });

  test('handles already-millisecond timestamp (>= 1e12)', () => {
    const tsMs = 1746665253000; // already in ms
    const result = extractPlatformTimestamp({ messageTimestamp: tsMs }, FALLBACK);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(tsMs);
  });

  test('does NOT fall back to fallback when messageTimestamp is present', () => {
    const ts = 1746665253;
    const wrongFallback = Date.now(); // very different from ts
    const result = extractPlatformTimestamp({ messageTimestamp: ts }, wrongFallback);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(ts * 1000);
    expect(result!.getTime()).not.toBeCloseTo(wrongFallback, -3);
  });
});
