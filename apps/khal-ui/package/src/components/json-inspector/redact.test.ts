import { describe, expect, test } from 'bun:test';
import { REDACTION_MASK, isSensitiveKey, redactDeep, redactedJson } from './redact';

describe('isSensitiveKey', () => {
  test.each(['apiKey', 'access_token', 'clientSecret', 'PASSWORD', 'Authorization', 'x-api-key'])('flags %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  test.each(['name', 'channel', 'instanceId', 'count'])('leaves %s alone', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('redactDeep', () => {
  test('masks sensitive scalar values but keeps other fields', () => {
    const out = redactDeep({ name: 'omni', apiKey: 'omni_sk_live_123', count: 3 }) as Record<string, unknown>;
    expect(out.name).toBe('omni');
    expect(out.count).toBe(3);
    expect(out.apiKey).toBe(REDACTION_MASK);
  });

  test('masks a whole subtree under a sensitive key', () => {
    const out = redactDeep({ token: { value: 'x', nested: { deep: 'y' } } }) as Record<string, unknown>;
    expect(out.token).toBe(REDACTION_MASK);
  });

  test('recurses into arrays and nested objects', () => {
    const out = redactDeep({
      items: [{ password: 'hunter2', label: 'a' }, { label: 'b' }],
    }) as { items: Array<Record<string, unknown>> };
    expect(out.items[0]?.password).toBe(REDACTION_MASK);
    expect(out.items[0]?.label).toBe('a');
    expect(out.items[1]?.label).toBe('b');
  });

  test('does not mutate the input', () => {
    const input = { secret: 'abc' };
    redactDeep(input);
    expect(input.secret).toBe('abc');
  });
});

describe('redactedJson', () => {
  test('emits redacted, formatted JSON', () => {
    const json = redactedJson({ authorization: 'Bearer x', ok: true });
    expect(json).toContain(REDACTION_MASK);
    expect(json).not.toContain('Bearer x');
    expect(json).toContain('"ok": true');
  });
});
