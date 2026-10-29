import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { redactSecrets, redactValue, verifyDelivery, verifyHmacSha256 } from '../index';

const SECRET = 'super-secret-value';
const BODY = JSON.stringify({ event: 'taskStatusUpdated', task_id: 'abc' });
const HEX = createHmac('sha256', SECRET).update(BODY).digest('hex');
const BASE64 = createHmac('sha256', SECRET).update(BODY).digest('base64');

describe('HMAC verification', () => {
  test('accepts a valid hex digest case-insensitively and rejects a bad one', () => {
    expect(verifyHmacSha256({ secret: SECRET, rawBody: BODY, provided: HEX, encoding: 'hex' })).toBe(true);
    expect(verifyHmacSha256({ secret: SECRET, rawBody: BODY, provided: HEX.toUpperCase(), encoding: 'hex' })).toBe(
      true,
    );
    expect(verifyHmacSha256({ secret: SECRET, rawBody: BODY, provided: `${HEX.slice(0, -1)}0`, encoding: 'hex' })).toBe(
      false,
    );
    expect(verifyHmacSha256({ secret: SECRET, rawBody: BODY, provided: undefined, encoding: 'hex' })).toBe(false);
  });

  test('accepts base64 and a declared prefix', () => {
    expect(verifyHmacSha256({ secret: SECRET, rawBody: BODY, provided: BASE64, encoding: 'base64' })).toBe(true);
    expect(
      verifyHmacSha256({
        secret: SECRET,
        rawBody: BODY,
        provided: `sha256=${HEX}`,
        encoding: 'hex',
        prefix: 'sha256=',
      }),
    ).toBe(true);
  });

  test('verifies through the manifest scheme with a case-insensitive header', async () => {
    const verification = { kind: 'hmac-sha256' as const, header: 'X-Signature', encoding: 'hex' as const };
    expect(await verifyDelivery(verification, BODY, { 'x-signature': HEX }, SECRET)).toBe(true);
    expect(await verifyDelivery(verification, BODY, { 'x-signature': 'nope' }, SECRET)).toBe(false);
    expect(await verifyDelivery(verification, BODY, {}, SECRET)).toBe(false);
  });

  test('supports a custom scheme that runs before anything is parsed', async () => {
    const calls: string[] = [];
    const verification = {
      kind: 'custom' as const,
      async verify(rawBody: string, headers: Record<string, string>, secret: string) {
        calls.push(rawBody, secret, headers.authorization ?? '');
        return headers.authorization === `Bearer ${secret}`;
      },
    };
    expect(await verifyDelivery(verification, 'not-json', { authorization: `Bearer ${SECRET}` }, SECRET)).toBe(true);
    expect(calls).toEqual(['not-json', SECRET, `Bearer ${SECRET}`]);
  });
});

describe('redaction', () => {
  test('scrubs every occurrence of every secret', () => {
    const text = `token ${SECRET} appeared twice: ${SECRET}`;
    const redacted = redactSecrets(text, [SECRET, null, '']);
    expect(redacted).toBe('token [redacted] appeared twice: [redacted]');
    expect(redacted).not.toContain(SECRET);
  });

  test('deep-redacts strings and preserves shape', () => {
    const value = { error: { message: `bad ${SECRET}`, nested: [SECRET, 42] } };
    const redacted = redactValue(value, [SECRET]);
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(redacted.error.nested[1]).toBe(42);
  });
});
