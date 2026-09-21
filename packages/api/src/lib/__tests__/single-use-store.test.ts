/**
 * createSingleUseStore (wish: slack-personal-oauth, Group 4): the generic
 * put / take / transition store behind the WhatsApp exchange-handle cache and
 * the Slack OAuth pending-record + outcome store.
 */

import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { createSingleUseStore } from '../single-use-store';

const T0 = new Date('2026-09-21T12:00:00.000Z');

afterEach(() => setSystemTime());

describe('createSingleUseStore', () => {
  test('put returns a prefixed handle and take yields the value exactly once', () => {
    const store = createSingleUseStore<{ n: number }>({ ttlMs: 60_000, maxEntries: 10, prefix: 'sus_' });
    const handle = store.put({ n: 1 });

    expect(handle.startsWith('sus_')).toBe(true);
    expect(handle.length).toBeGreaterThan('sus_'.length + 30);
    expect(store.take(handle)).toEqual({ n: 1 });
    expect(store.take(handle)).toBeUndefined();
  });

  test('two puts never share a handle', () => {
    const store = createSingleUseStore<string>({ ttlMs: 60_000, maxEntries: 10, prefix: 'p_' });
    expect(store.put('a')).not.toBe(store.put('b'));
  });

  test('take after TTL expiry returns undefined', () => {
    setSystemTime(T0);
    const store = createSingleUseStore<string>({ ttlMs: 1_000, maxEntries: 10, prefix: 'ttl_' });
    const handle = store.put('value');

    setSystemTime(new Date(T0.getTime() + 1_001));
    expect(store.take(handle)).toBeUndefined();
  });

  test('a per-put ttl overrides the store default', () => {
    setSystemTime(T0);
    const store = createSingleUseStore<string>({ ttlMs: 1_000, maxEntries: 10, prefix: 'ttl_' });
    const longer = store.put('value', 10_000);

    setSystemTime(new Date(T0.getTime() + 5_000));
    expect(store.take(longer)).toBe('value');
  });

  test('take of an unknown handle returns undefined', () => {
    const store = createSingleUseStore<string>({ ttlMs: 60_000, maxEntries: 10, prefix: 'u_' });
    expect(store.take('u_never-issued')).toBeUndefined();
  });

  test('maxEntries evicts the oldest entry by insertion order', () => {
    const store = createSingleUseStore<string>({ ttlMs: 60_000, maxEntries: 2, prefix: 'cap_' });
    const first = store.put('first');
    const second = store.put('second');
    const third = store.put('third');

    expect(store.take(first)).toBeUndefined();
    expect(store.take(second)).toBe('second');
    expect(store.take(third)).toBe('third');
  });

  test('transition returns false for a handle the store never issued', () => {
    const store = createSingleUseStore<string>({ ttlMs: 60_000, maxEntries: 10, prefix: 't_' });
    expect(store.transition('t_never-issued', 'x')).toBe(false);
    expect(store.take('t_never-issued')).toBeUndefined();
  });

  test('transition replaces the value of a known handle and re-arms its TTL', () => {
    setSystemTime(T0);
    const store = createSingleUseStore<string>({ ttlMs: 1_000, maxEntries: 10, prefix: 't_' });
    const handle = store.put('pending');

    setSystemTime(new Date(T0.getTime() + 900));
    expect(store.transition(handle, 'outcome')).toBe(true);

    // Past the ORIGINAL deadline but inside the re-armed one.
    setSystemTime(new Date(T0.getTime() + 1_500));
    expect(store.take(handle)).toBe('outcome');
  });

  test('transition after take parks a follow-up value under the same handle', () => {
    const store = createSingleUseStore<string>({ ttlMs: 60_000, maxEntries: 10, prefix: 't_' });
    const handle = store.put('pending');

    expect(store.take(handle)).toBe('pending');
    expect(store.take(handle)).toBeUndefined();
    expect(store.transition(handle, 'outcome')).toBe(true);
    expect(store.take(handle)).toBe('outcome');
    expect(store.take(handle)).toBeUndefined();
  });

  test('transition refuses a handle whose lifetime elapsed', () => {
    setSystemTime(T0);
    const store = createSingleUseStore<string>({ ttlMs: 1_000, maxEntries: 10, prefix: 't_' });
    const handle = store.put('pending');

    setSystemTime(new Date(T0.getTime() + 1_001));
    expect(store.transition(handle, 'outcome')).toBe(false);
    expect(store.take(handle)).toBeUndefined();
  });

  test('transition refuses a handle that eviction forgot', () => {
    const store = createSingleUseStore<string>({ ttlMs: 60_000, maxEntries: 1, prefix: 'e_' });
    const evicted = store.put('a');
    store.put('b');
    expect(store.transition(evicted, 'late')).toBe(false);
  });

  test('rejects non-positive ttl or cap', () => {
    expect(() => createSingleUseStore<string>({ ttlMs: 0, maxEntries: 1, prefix: 'x_' })).toThrow();
    expect(() => createSingleUseStore<string>({ ttlMs: 1, maxEntries: 0, prefix: 'x_' })).toThrow();
  });
});
