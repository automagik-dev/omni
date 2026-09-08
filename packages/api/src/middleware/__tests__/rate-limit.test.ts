/**
 * Per-IP rate-limit keying behind a trusted proxy.
 *
 * With TRUSTED_PROXY_HEADER set, the bucket must be keyed on the hop the
 * trusted proxy wrote — the RIGHTMOST entry of an append-style header such as
 * X-Forwarded-For — never on the client-controlled leftmost hop, otherwise a
 * forged header lets a client pick its own bucket or evict a victim's.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { rateLimitMiddleware, resolveClientIp } from '../rate-limit';

describe('resolveClientIp', () => {
  test('single-value (overwrite-style) header is used as-is', () => {
    expect(resolveClientIp('203.0.113.7', '10.0.0.1')).toBe('203.0.113.7');
  });

  test('append-style header: the rightmost hop wins, not the client-controlled first hop', () => {
    expect(resolveClientIp('1.2.3.4, 198.51.100.9, 203.0.113.7', '10.0.0.1')).toBe('203.0.113.7');
  });

  test('whitespace and empty entries are tolerated', () => {
    expect(resolveClientIp(' 1.2.3.4 ,, 203.0.113.7 , ', '10.0.0.1')).toBe('203.0.113.7');
  });

  test('falls back to the socket peer address when no trusted header value is present', () => {
    expect(resolveClientIp(undefined, '10.0.0.1')).toBe('10.0.0.1');
  });

  test('an empty header value does not yield an empty identifier', () => {
    expect(resolveClientIp('', undefined)).toBeUndefined();
    expect(resolveClientIp(',', undefined)).toBeUndefined();
  });

  test('a hop that is not an IP literal yields no identifier instead of an attacker-shaped key', () => {
    // A port suffix would otherwise give every connection its own bucket.
    expect(resolveClientIp('1.1.1.1, 203.0.113.7:5678', '10.0.0.1')).toBeUndefined();
    expect(resolveClientIp('[::1]:8080', '10.0.0.1')).toBeUndefined();
    expect(resolveClientIp('not-an-address', '10.0.0.1')).toBeUndefined();
    expect(resolveClientIp('999.1.1.1', '10.0.0.1')).toBeUndefined();
    expect(resolveClientIp(undefined, 'garbage')).toBeUndefined();
  });

  test('IPv6 and IPv4-mapped IPv6 peers (what Bun reports on dual-stack sockets) are accepted', () => {
    expect(resolveClientIp(undefined, '::ffff:127.0.0.1')).toBe('::ffff:127.0.0.1');
    expect(resolveClientIp('2001:db8::1', undefined)).toBe('2001:db8::1');
  });
});

describe('rateLimitMiddleware behind a trusted proxy', () => {
  const originalHeader = process.env.TRUSTED_PROXY_HEADER;

  beforeEach(() => {
    process.env.TRUSTED_PROXY_HEADER = 'X-Forwarded-For';
  });

  afterEach(() => {
    if (originalHeader === undefined) Reflect.deleteProperty(process.env, 'TRUSTED_PROXY_HEADER');
    else process.env.TRUSTED_PROXY_HEADER = originalHeader;
  });

  function buildApp() {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', rateLimitMiddleware);
    app.get('/ping', (c) => c.json({ ok: true }));
    return app;
  }

  async function remaining(app: Hono<{ Variables: AppVariables }>, xff: string): Promise<number> {
    const res = await app.request('/ping', { headers: { 'X-Forwarded-For': xff } });
    expect(res.status).toBe(200);
    return Number(res.headers.get('X-RateLimit-Remaining'));
  }

  test('requests that differ only in the forged first hop share one bucket', async () => {
    const app = buildApp();
    // Unique trusted hop per test run so the module-global store cannot bleed
    // state in from other tests.
    const trustedHop = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    const first = await remaining(app, `1.1.1.1, ${trustedHop}`);
    const second = await remaining(app, `2.2.2.2, ${trustedHop}`);

    expect(second).toBe(first - 1);
  });

  test('requests from different trusted hops are keyed separately', async () => {
    const app = buildApp();
    const hopA = `198.51.100.${Math.floor(Math.random() * 100) + 1}`;
    const hopB = `198.51.100.${Math.floor(Math.random() * 100) + 101}`;

    const firstA = await remaining(app, `1.1.1.1, ${hopA}`);
    const firstB = await remaining(app, `1.1.1.1, ${hopB}`);

    // Same forged first hop, different trusted hop: B is a fresh window, not
    // one request behind A.
    expect(firstB).toBe(firstA);
  });
});
