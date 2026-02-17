/**
 * Webhook Authentication Middleware Tests
 *
 * Tests X-Telegram-Bot-Api-Secret-Token header verification:
 * - Valid token passes through
 * - Invalid token returns 401
 * - Missing token when secret is configured returns 401
 * - No secret configured passes through (backward compatible)
 * - No body leak on auth failures
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createWebhookAuthMiddleware } from '../middleware/webhook-auth';

function createTestApp(webhookSecret?: string) {
  const app = new Hono();
  const middleware = createWebhookAuthMiddleware({ webhookSecret });

  app.use('/webhook', middleware);
  app.post('/webhook', (c) => c.json({ ok: true }));

  return app;
}

describe('Webhook Auth Middleware', () => {
  test('request with valid secret token passes through to handler', async () => {
    const app = createTestApp('my-secret-token');
    const res = await app.request('/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'my-secret-token' },
      body: JSON.stringify({ update_id: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  test('request with invalid token returns 401 Unauthorized', async () => {
    const app = createTestApp('my-secret-token');
    const res = await app.request('/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-token' },
      body: JSON.stringify({ update_id: 1 }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid webhook secret token');
    // Verify no extra data leaks
    expect(Object.keys(body)).toEqual(['error']);
  });

  test('request with missing token when secret is configured returns 401', async () => {
    const app = createTestApp('my-secret-token');
    const res = await app.request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ update_id: 1 }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Missing webhook secret token');
    // Verify no extra data leaks
    expect(Object.keys(body)).toEqual(['error']);
  });

  test('request when no secret is configured passes through (backward compatible)', async () => {
    const app = createTestApp(undefined);
    const res = await app.request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ update_id: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  test('request when secret is empty string passes through', async () => {
    const app = createTestApp('');
    const res = await app.request('/webhook', {
      method: 'POST',
      body: JSON.stringify({ update_id: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  test('auth failure response has no body leak (only error field)', async () => {
    const app = createTestApp('secret');
    const res = await app.request('/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'bad' },
      body: JSON.stringify({ sensitive: 'data' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    // Only error field, no leaking of request data
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
