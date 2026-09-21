/**
 * oauth-token-cache (WhatsApp Embedded Signup exchange handle), re-seated on
 * createSingleUseStore by wish slack-personal-oauth. Its surface —
 * `put(accessToken, ttlMs?)` / `take(handle)`, the `eshandle_` prefix, the
 * 5-minute default TTL and single use — is what the WhatsApp routes rely on.
 */

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { put, take } from '../oauth-token-cache';

const T0 = new Date('2026-09-21T12:00:00.000Z');

afterEach(() => setSystemTime());

describe('oauth-token-cache', () => {
  test('put returns an eshandle_ handle and take resolves the token exactly once', () => {
    const handle = put('EAAB-not-a-real-meta-token');

    expect(handle.startsWith('eshandle_')).toBe(true);
    expect(handle).not.toContain('EAAB');
    expect(take(handle)).toBe('EAAB-not-a-real-meta-token');
    expect(take(handle)).toBeUndefined();
  });

  test('take of an unknown handle returns undefined', () => {
    expect(take('eshandle_unknown')).toBeUndefined();
  });

  test('the handle expires after five minutes by default', () => {
    setSystemTime(T0);
    const handle = put('token');

    setSystemTime(new Date(T0.getTime() + 5 * 60 * 1000 + 1));
    expect(take(handle)).toBeUndefined();
  });

  test('a caller-supplied ttl is honoured', () => {
    setSystemTime(T0);
    const handle = put('token', 1_000);

    setSystemTime(new Date(T0.getTime() + 1_001));
    expect(take(handle)).toBeUndefined();
  });

  test('refuses an empty token', () => {
    expect(() => put('')).toThrow('accessToken is required');
  });
});
