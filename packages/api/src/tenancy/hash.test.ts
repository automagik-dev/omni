/**
 * Credential generation / hashing contract
 * (wish: omni-full-multitenancy, Group G1).
 *
 * The interesting property is uniformity: the alphabet has 62 symbols and a
 * random byte has 256 values, so folding with `%` hands the first 8 symbols a
 * fifth preimage each. These tests pin the shape (prefix, length, alphabet) and
 * then prove the bias is gone by driving the generator with a deterministic
 * byte stream that walks every byte value exactly once.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { generateSecret, hashSecret, secretPrefix } from './hash';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const realGetRandomValues = crypto.getRandomValues.bind(crypto);

afterEach(() => {
  (crypto as { getRandomValues: typeof realGetRandomValues }).getRandomValues = realGetRandomValues;
});

/** Feed the generator an exact byte sequence, cycling if it asks for more. */
function stubRandomBytes(bytes: number[]): void {
  let cursor = 0;
  (crypto as { getRandomValues: typeof realGetRandomValues }).getRandomValues = ((array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = bytes[cursor % bytes.length] as number;
      cursor++;
    }
    return array;
  }) as typeof realGetRandomValues;
}

describe('generateSecret', () => {
  test('keeps the omni_sk_ prefix, the 32-character body, and the alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateSecret();
      expect(secret.startsWith('omni_sk_')).toBe(true);
      const body = secret.slice('omni_sk_'.length);
      expect(body).toHaveLength(32);
      for (const char of body) expect(ALPHABET).toContain(char);
    }
  });

  test('bytes at or above the rejection ceiling are discarded, not folded onto A-H', () => {
    // 248..255 are the biased bytes: `% 62` maps them onto A..H. A generator
    // fed nothing but those bytes must never terminate on them — it must keep
    // drawing. Followed by a usable byte, the whole body is that byte's symbol.
    stubRandomBytes([248, 249, 250, 251, 252, 253, 254, 255, 0]);
    const body = generateSecret().slice('omni_sk_'.length);
    expect(body).toBe('A'.repeat(32));
    expect(ALPHABET[0]).toBe('A');
  });

  test('the accepted byte range maps onto the alphabet with no symbol favoured', () => {
    // Walk the 248 accepted byte values (0..247) four times: 992 characters,
    // exactly 31 secrets, no rejection, so batch boundaries stay aligned. Each
    // symbol has exactly 4 preimages in that range, so each must appear 16
    // times. Under `value % 62` over the FULL byte range the first 8 symbols
    // would carry a fifth preimage — that is the bias this pins out.
    stubRandomBytes(Array.from({ length: 248 }, (_, i) => i));
    const counts = new Map<string, number>();
    for (let i = 0; i < 31; i++) {
      for (const char of generateSecret().slice('omni_sk_'.length)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(ALPHABET.length);
    for (const [char, n] of counts) expect([char, n]).toEqual([char, 16]);
  });

  test('successive secrets differ', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateSecret()));
    expect(seen.size).toBe(200);
  });
});

describe('hashSecret', () => {
  test('is SHA-256 hex — 64 lowercase hex characters, stable per input', async () => {
    const digest = await hashSecret('omni_sk_example');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSecret('omni_sk_example')).toBe(digest);
    expect(await hashSecret('omni_sk_examplf')).not.toBe(digest);
  });
});

describe('secretPrefix', () => {
  test('is the first 8 characters after the prefix', () => {
    expect(secretPrefix('omni_sk_ABCDEFGHIJ')).toBe('ABCDEFGH');
    expect(secretPrefix('ABCDEFGHIJ')).toBe('ABCDEFGH');
  });
});
