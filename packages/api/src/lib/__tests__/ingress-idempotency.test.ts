/**
 * Ingress idempotency key derivation (#958).
 *
 * The derivation must be TOTAL (same request → same key, never empty) and
 * fall back to the body-hash default whenever a placeholder cannot resolve —
 * a literal fallback key would collide every keyless delivery into one
 * "duplicate" and silently drop real events.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  DEFAULT_IDEMPOTENCY_KEY_TEMPLATE,
  deriveIdempotencyKey,
  isValidIdempotencyKeyTemplate,
} from '../ingress-idempotency';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const base = {
  sourceName: 'github',
  rawBody: '{"action":"push"}',
  payload: { action: 'push' } as Record<string, unknown>,
  headers: {} as Record<string, string>,
};

describe('deriveIdempotencyKey', () => {
  test('default template hashes the raw body under the source prefix', () => {
    const key = deriveIdempotencyKey({ ...base, template: DEFAULT_IDEMPOTENCY_KEY_TEMPLATE });
    expect(key).toBe(`github:${sha256(base.rawBody)}`);
  });

  test('same body derives the same key; different body a different one', () => {
    const template = DEFAULT_IDEMPOTENCY_KEY_TEMPLATE;
    const a = deriveIdempotencyKey({ ...base, template });
    const b = deriveIdempotencyKey({ ...base, template });
    const c = deriveIdempotencyKey({ ...base, template, rawBody: '{"action":"pull"}' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('header placeholder resolves case-insensitively (GitHub delivery id)', () => {
    const key = deriveIdempotencyKey({
      ...base,
      template: 'github:{headers.X-GitHub-Delivery}',
      headers: { 'x-github-delivery': 'd-123' },
    });
    expect(key).toBe('github:d-123');
  });

  test('payload dot-path placeholders resolve scalars (Slack-style compound key)', () => {
    const key = deriveIdempotencyKey({
      ...base,
      template: 'slack:{payload.team_id}:{payload.event.channel}:{payload.event.event_ts}',
      payload: { team_id: 'T1', event: { channel: 'C9', event_ts: 1725.0001 } },
    });
    expect(key).toBe('slack:T1:C9:1725.0001');
  });

  test('an unresolvable placeholder falls back to the body-hash default', () => {
    const key = deriveIdempotencyKey({ ...base, template: 'github:{headers.x-github-delivery}' });
    expect(key).toBe(`github:${sha256(base.rawBody)}`);
  });

  test('a placeholder resolving to an object (not a scalar) falls back', () => {
    const key = deriveIdempotencyKey({
      ...base,
      template: '{source}:{payload.event}',
      payload: { event: { nested: true } },
    });
    expect(key).toBe(`github:${sha256(base.rawBody)}`);
  });

  test('an oversized resolved key collapses to a deterministic hash', () => {
    const long = 'x'.repeat(600);
    const input = { ...base, template: '{source}:{payload.id}', payload: { id: long } };
    const key = deriveIdempotencyKey(input);
    expect(key).toBe(`github:overflow:${sha256(`github:${long}`)}`);
    expect(key.length).toBeLessThan(120);
    expect(deriveIdempotencyKey(input)).toBe(key);
  });
});

describe('isValidIdempotencyKeyTemplate', () => {
  test('accepts templates with at least one placeholder', () => {
    expect(isValidIdempotencyKeyTemplate(DEFAULT_IDEMPOTENCY_KEY_TEMPLATE)).toBe(true);
    expect(isValidIdempotencyKeyTemplate('github:{headers.x-github-delivery}')).toBe(true);
  });

  test('rejects empty, oversized, and placeholder-free literals', () => {
    expect(isValidIdempotencyKeyTemplate('')).toBe(false);
    expect(isValidIdempotencyKeyTemplate('a'.repeat(501))).toBe(false);
    // A pure literal would collide EVERY delivery into one "duplicate".
    expect(isValidIdempotencyKeyTemplate('github:static')).toBe(false);
  });
});
