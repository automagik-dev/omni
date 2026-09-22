/**
 * The public Slack OAuth callback as `createApp` actually mounts it
 * (wish: slack-personal-oauth).
 *
 * The other Slack suites mount the handler themselves, so they cannot prove
 * anything about the real app's middleware chain: removing the rate limiter or
 * the timeout exemption from `app.ts` would leave them all green. This file
 * drives the app `createApp` builds, and pins the two properties that live on
 * that mount:
 *
 *   * the callback is auth-exempt and IP rate-limited (success criterion 7):
 *     an unauthenticated caller gets the handler's own 400 rather than a 401,
 *     and the same IP is cut off with 429 after the ingress budget;
 *   * the callback is exempt from the GET timeout race, because it is a GET
 *     that exchanges a code, writes a row and connects a plugin — a 408 there
 *     would answer the browser with a failure for an install that completes.
 *
 * No database is touched: every request is refused before the handler reads
 * anything, and `createApp` only builds routers.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { configureLogging } from '@omni/core';
import type { Database } from '@omni/db';
import { createApp, shouldTimeoutRequest } from '../../../app';
import { SLACK_OAUTH_CALLBACK_PATH } from '../../../constants/slack-app';

/** `RATE_LIMITS.events` in middleware/rate-limit.ts: 100 per minute. */
const INGRESS_BUDGET = 100;

/**
 * A bucket of this file's own: the limiter store is module-global, so a shared
 * key would couple this test to any other suite that hits the ingress surface.
 */
const CALLER_IP = '203.0.113.77';

/** Named indirectly so the restore below is a computed delete, as elsewhere. */
const PROXY_HEADER_ENV = 'TRUSTED_PROXY_HEADER';
const savedProxyHeader = process.env[PROXY_HEADER_ENV];

beforeAll(() => {
  configureLogging({ level: 'silent' });
  process.env[PROXY_HEADER_ENV] = 'x-forwarded-for';
});

afterAll(() => {
  if (savedProxyHeader === undefined) delete process.env[PROXY_HEADER_ENV];
  else process.env[PROXY_HEADER_ENV] = savedProxyHeader;
});

describe('GET /api/v2/slack/oauth/callback on the real app', () => {
  test('is public and rate-limited per IP by the ingress budget', async () => {
    const { app } = createApp({} as Database);
    const call = () => app.request(SLACK_OAUTH_CALLBACK_PATH, { headers: { 'x-forwarded-for': CALLER_IP } });

    // No credential, no state: the handler's own fixed failure page, not a 401
    // from the protected chain. That is the auth exemption.
    const first = await call();
    expect(first.status).toBe(400);
    expect(first.headers.get('content-type')).toContain('text/html');
    expect(first.headers.get('x-ratelimit-limit')).toBe(String(INGRESS_BUDGET));

    // Spend the rest of the window.
    for (let sent = 2; sent <= INGRESS_BUDGET; sent++) {
      expect((await call()).status).toBe(400);
    }

    const limited = await call();
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
  });
});

describe('shouldTimeoutRequest', () => {
  test('exempts the Slack OAuth callback, and only it, from the GET timeout race', () => {
    expect(shouldTimeoutRequest('GET', SLACK_OAUTH_CALLBACK_PATH)).toBe(false);
    expect(shouldTimeoutRequest('HEAD', SLACK_OAUTH_CALLBACK_PATH)).toBe(false);

    // Every other read is still raced against the 30 s budget.
    expect(shouldTimeoutRequest('GET', '/api/v2/instances')).toBe(true);
    expect(shouldTimeoutRequest('HEAD', '/api/v2/instances')).toBe(true);
    expect(shouldTimeoutRequest('GET', '/api/v2/slack/oauth/result/slackoauth_abc')).toBe(true);
    // A prefix of the exempt path is not the exempt path.
    expect(shouldTimeoutRequest('GET', '/api/v2/slack/oauth')).toBe(true);

    // Writes are never raced: abandoning one orphans the handler mid-write.
    expect(shouldTimeoutRequest('POST', '/api/v2/instances')).toBe(false);
    expect(shouldTimeoutRequest('POST', SLACK_OAUTH_CALLBACK_PATH)).toBe(false);
  });
});
