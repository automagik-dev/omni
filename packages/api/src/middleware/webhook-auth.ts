/**
 * Webhook signature verification middleware
 *
 * Verifies the X-Telegram-Bot-Api-Secret-Token header on incoming
 * Telegram webhook requests. When a webhookSecret is configured,
 * requests without a valid token are rejected with 401.
 */

import { createLogger } from '@omni/core';
import { createMiddleware } from 'hono/factory';

const log = createLogger('api:webhook-auth');

export interface WebhookAuthConfig {
  /** The expected secret token value (from Telegram setWebhook secret_token param) */
  webhookSecret?: string;
}

/**
 * Create webhook authentication middleware for Telegram.
 *
 * Verifies the `X-Telegram-Bot-Api-Secret-Token` header matches the configured secret.
 * If no secret is configured, requests pass through (backward compatible).
 */
export function createWebhookAuthMiddleware(config: WebhookAuthConfig) {
  return createMiddleware(async (c, next) => {
    const { webhookSecret } = config;

    // No secret configured — pass through (backward compatible)
    if (!webhookSecret) {
      return next();
    }

    const token = c.req.header('x-telegram-bot-api-secret-token');

    if (!token) {
      const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
      log.warn('Webhook request missing secret token', { ip });
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing webhook secret token' } }, 401);
    }

    if (token !== webhookSecret) {
      const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
      log.warn('Webhook request with invalid secret token', { ip });
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret token' } }, 401);
    }

    return next();
  });
}
