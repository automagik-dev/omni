import { describe, expect, it } from 'bun:test';

import { normalizeRoutingValue, parseHandoffRouting, resolveHandoffGroup } from '../handoff-routing';
import { ZenviaApiError, ZenviaErrorCode } from '../utils/errors';

const routing = { field: 'queue_field', groups: { 'queue-a': 'group-1', 'Queue B': 'group-2' } };

function meta(value: unknown): Record<string, unknown> {
  return { handoffFields: { queue_field: value } };
}

describe('normalizeRoutingValue', () => {
  it('trims, collapses inner whitespace of every kind and ignores case', () => {
    expect(normalizeRoutingValue('  Queue \t\n  B  ')).toBe('queue b');
    expect(normalizeRoutingValue('QUEUE-A')).toBe('queue-a');
    expect(normalizeRoutingValue('   ')).toBe('');
  });
});

describe('resolveHandoffGroup', () => {
  it('picks the group mapped to the value of the configured field', () => {
    expect(resolveHandoffGroup(routing, undefined, meta('queue-a'))).toEqual({ ok: true, groupId: 'group-1' });
  });

  it('matches after trimming, collapsing spaces and ignoring case, on both sides', () => {
    expect(resolveHandoffGroup(routing, undefined, meta('  QUEUE    b '))).toEqual({ ok: true, groupId: 'group-2' });
    expect(resolveHandoffGroup(routing, undefined, meta('Queue-A'))).toEqual({ ok: true, groupId: 'group-1' });
  });

  it('does not use the default group when the value matches', () => {
    expect(resolveHandoffGroup(routing, 'group-default', meta('queue-a'))).toEqual({ ok: true, groupId: 'group-1' });
  });

  it('falls back to the default group, reporting the unmatched value', () => {
    expect(resolveHandoffGroup(routing, 'group-default', meta('queue-z'))).toEqual({
      ok: true,
      groupId: 'group-default',
      miss: { field: 'queue_field', reason: 'unmatched', value: 'queue-z' },
    });
  });

  it('falls back to the default group when the field is absent, or handoffFields is not an object', () => {
    for (const input of [{}, { handoffFields: {} }, { handoffFields: ['queue-a'] }, { handoffFields: null }]) {
      expect(resolveHandoffGroup(routing, 'group-default', input)).toEqual({
        ok: true,
        groupId: 'group-default',
        miss: { field: 'queue_field', reason: 'missing' },
      });
    }
  });

  it('treats a value that is not a string as unexpected and falls back', () => {
    const cases: Array<[unknown, string]> = [
      [12, 'number'],
      [true, 'boolean'],
      [null, 'null'],
      [['queue-a'], 'array'],
      [{ name: 'queue-a' }, 'object'],
    ];
    for (const [value, valueType] of cases) {
      expect(resolveHandoffGroup(routing, 'group-default', meta(value))).toEqual({
        ok: true,
        groupId: 'group-default',
        miss: { field: 'queue_field', reason: 'not-a-string', valueType },
      });
    }
  });

  it('refuses when nothing matches and there is no default group', () => {
    const result = resolveHandoffGroup(routing, undefined, meta('queue-z'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('queue_field');
    expect(result.error).toContain('queue-z');
    expect(result.error).toContain('zenviaHandoffGroupId');
    expect(result.miss).toEqual({ field: 'queue_field', reason: 'unmatched', value: 'queue-z' });
  });

  it('refuses a missing field and a non-string value when there is no default group', () => {
    const missing = resolveHandoffGroup(routing, undefined, {});
    const odd = resolveHandoffGroup(routing, undefined, meta(12));

    expect(missing.ok).toBe(false);
    expect(odd.ok).toBe(false);
    if (missing.ok || odd.ok) return;
    expect(missing.error).toContain('queue_field');
    expect(odd.error).toContain('queue_field');
  });

  it('keeps the logged value short', () => {
    const result = resolveHandoffGroup(routing, 'group-default', meta('x'.repeat(500)));

    expect(result.ok && result.miss?.reason === 'unmatched' && result.miss.value.length).toBe(128);
  });

  it('without a routing map the default group is used as before', () => {
    expect(resolveHandoffGroup(undefined, 'group-default', meta('queue-a'))).toEqual({
      ok: true,
      groupId: 'group-default',
    });
  });

  it('without a routing map and without a default group there is nowhere to send', () => {
    expect(resolveHandoffGroup(undefined, undefined, meta('queue-a')).ok).toBe(false);
  });
});

describe('parseHandoffRouting', () => {
  it('is undefined when nothing is configured', () => {
    expect(parseHandoffRouting(undefined)).toBeUndefined();
    expect(parseHandoffRouting(null)).toBeUndefined();
    expect(parseHandoffRouting('   ')).toBeUndefined();
  });

  it('accepts the object and the same object as a JSON string', () => {
    expect(parseHandoffRouting(routing)).toEqual(routing);
    expect(parseHandoffRouting(JSON.stringify(routing))).toEqual(routing);
  });

  it('trims the field name and the group ids', () => {
    expect(parseHandoffRouting({ field: ' queue_field ', groups: { a: ' group-1 ' } })).toEqual({
      field: 'queue_field',
      groups: { a: 'group-1' },
    });
  });

  it('refuses an invalid configuration with an invalid-request error that names the key', () => {
    const invalid: unknown[] = [
      '{not json',
      '[]',
      42,
      [],
      { groups: { a: 'g' } },
      { field: 'queue_field' },
      { field: '', groups: { a: 'g' } },
      { field: '   ', groups: { a: 'g' } },
      { field: 'queue_field', groups: {} },
      { field: 'queue_field', groups: { a: 12 } },
      { field: 'queue_field', groups: { a: '' } },
      { field: 'queue_field', groups: { a: null } },
      { field: 'queue_field', groups: ['g'] },
      { field: 'queue_field', groups: { '   ': 'g' } },
      { field: 'queue_field', groups: { a: 'g' }, extra: true },
      { field: 'queue_field', groups: { a: 'g'.repeat(65) } },
    ];
    for (const raw of invalid) {
      let caught: unknown;
      try {
        parseHandoffRouting(raw);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ZenviaApiError);
      expect((caught as ZenviaApiError).channelCode).toBe(ZenviaErrorCode.INVALID_REQUEST);
      expect((caught as ZenviaApiError).message).toContain('zenviaHandoffRouting');
    }
  });

  it('refuses two values that become the same after normalization', () => {
    expect(() =>
      parseHandoffRouting({ field: 'queue_field', groups: { 'Queue A': 'group-1', ' queue   a': 'group-2' } }),
    ).toThrow(/same value|distinct|duplicate/i);
  });
});
