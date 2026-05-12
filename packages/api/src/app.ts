/**
 * Hono application setup
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChannelRegistry } from '@omni/channel-sdk';
import { type EventBus, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

const httpLog = createLogger('http');

/**
 * Get allowed CORS origins from environment
 * OMNI_CORS_ORIGINS can be comma-separated list or '*' for development
 */
function getAllowedOrigins(): string[] | '*' {
  const envOrigins = process.env.OMNI_CORS_ORIGINS;

  // If not set, default to restrictive (localhost only in dev)
  if (!envOrigins) {
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      return ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];
    }
    // Production: require explicit configuration
    return [];
  }

  // Allow wildcard for development
  if (envOrigins === '*') {
    return '*';
  }

  // Parse comma-separated origins
  return envOrigins.split(',').map((origin) => origin.trim());
}

import { authMiddleware, requireInstanceAccess } from './middleware/auth';
import { defaultBodyLimitMiddleware } from './middleware/body-limit';
import { genieSignatureMiddleware } from './middleware/genie-signature';
import { outputRedactorMiddleware } from './middleware/output-redactor';
import { requireSignedInstanceMiddleware } from './middleware/require-signed-instance';
import { scopeEnforcerMiddleware } from './middleware/scope-enforcer';

import { createContextMiddleware } from './middleware/context';
import { errorHandler } from './middleware/error';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { defaultTimeoutMiddleware } from './middleware/timeout';
import { versionHeadersMiddleware } from './middleware/version-headers';
import { createWebhookAuthMiddleware } from './middleware/webhook-auth';
import { healthRoutes } from './routes/health';
import { openapiRoutes } from './routes/openapi';
import { v2Routes } from './routes/v2';
import type { Services } from './services';
import type { AppVariables } from './types';

/**
 * Create app result with app and services
 */
export interface CreateAppResult {
  app: Hono<{ Variables: AppVariables }>;
  services: Services;
}

/**
 * Create the Hono application
 */
export function createApp(
  db: Database,
  eventBus: EventBus | null = null,
  channelRegistry: ChannelRegistry | null = null,
): CreateAppResult {
  const app = new Hono<{ Variables: AppVariables }>();

  // Create context middleware and get services
  const { middleware: contextMiddleware, services } = createContextMiddleware(db, eventBus, channelRegistry);

  // Global middleware
  app.use('*', timing());

  // Request safety: timeout and body size limits
  // Promise.race timeout is only safe for reads (GETs) — abandoning a read
  // result is harmless. For writes, the handler keeps running after timeout,
  // orphaning mutexes and corrupting state (see #72 / #70).
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    return defaultTimeoutMiddleware(c, next);
  });
  app.use('*', defaultBodyLimitMiddleware);

  // HTTP logging
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    httpLog.info(`→ ${c.req.method} ${c.req.path}`, { status: c.res.status, ms });
  });

  // NOTE: Compression disabled - Hono's compress middleware with Bun has bugs
  // that cause ERR_CONTENT_DECODING_FAILED in browsers (Content-Encoding mismatch)
  // API responses are small enough that compression isn't critical
  // app.use('/api/*', gzipMiddleware);
  // Configure CORS with allowed origins
  const allowedOrigins = getAllowedOrigins();
  app.use(
    '*',
    cors({
      origin: allowedOrigins === '*' ? '*' : allowedOrigins,
      allowHeaders: ['Content-Type', 'x-api-key', 'x-request-id'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['x-request-id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
      maxAge: 86400,
    }),
  );
  app.use('*', secureHeaders());
  app.use('*', contextMiddleware);
  app.use('*', versionHeadersMiddleware);

  // Error handler - must be registered with onError, not as middleware
  app.onError(errorHandler);

  // Root-level health redirect for external checkers (k8s probes, genie providers)
  app.get('/health', (c) => c.redirect('/api/v2/health', 307));

  // Health routes (no auth required)
  app.route('/api/v2', healthRoutes);

  // OpenAPI spec and Swagger UI (no auth required)
  app.route('/api/v2', openapiRoutes);

  // ── A2A protocol endpoints — feature-flagged, disabled by default ───────────
  if (process.env.A2A_ENABLED === 'true') {
    // Agent Card: GET /.well-known/agent.json?instanceId={id}
    app.get('/.well-known/agent.json', async (c) => {
      const channelRegistry = c.get('channelRegistry');
      const plugin = channelRegistry?.get('a2a');
      if (!plugin?.handleWebhook) {
        return c.json({ error: 'A2A channel not available' }, 503);
      }
      return plugin.handleWebhook(c.req.raw);
    });

    // A2A JSON-RPC: POST /a2a/:instanceId (requires auth + instance-level access)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    app.post(
      '/a2a/:instanceId',
      authMiddleware,
      requireInstanceAccess((c) => c.req.param('instanceId') ?? ''),
      rateLimitMiddleware,
      async (c) => {
        const instanceId = c.req.param('instanceId') ?? '';
        if (!UUID_REGEX.test(instanceId)) {
          return c.json({ error: 'Invalid instance ID format' }, 400);
        }
        const channelRegistry = c.get('channelRegistry');
        const plugin = channelRegistry?.get('a2a');
        if (!plugin?.handleWebhook) {
          return c.json({ error: 'A2A channel not available' }, 503);
        }
        return plugin.handleWebhook(c.req.raw);
      },
    );
  } else {
    app.all('/a2a/*', (c) => c.json({ error: 'A2A channel not enabled. Set A2A_ENABLED=true.' }, 503));
    app.get('/.well-known/agent.json', (c) => c.json({ error: 'A2A not enabled' }, 503));
  }

  // Public Telegram webhook endpoint — auth-exempt, verified by X-Telegram-Bot-Api-Secret-Token.
  // Must be mounted before protectedApp so Telegram's servers (which send no x-api-key) can reach it.
  app.post('/api/v2/instances/:id/telegram/webhook', async (c) => {
    const id = c.req.param('id');
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('telegram');
    if (!plugin) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'Telegram plugin not loaded' } }, 503);
    }

    const telegramPlugin = plugin as unknown as {
      getGrammyBot: (instanceId: string) => { handleUpdate: (update: unknown) => Promise<void> } | undefined;
      getWebhookSecret: (instanceId: string) => string | undefined;
    };

    const webhookSecret = telegramPlugin.getWebhookSecret(id);

    let authPassed = false;
    await createWebhookAuthMiddleware({ webhookSecret })(c, async () => {
      authPassed = true;
    });
    if (!authPassed) return c.res;

    const bot = telegramPlugin.getGrammyBot(id);
    if (!bot) {
      return c.json({ error: { code: 'NOT_CONNECTED', message: `Bot not connected for instance ${id}` } }, 404);
    }

    let update: unknown;
    try {
      update = await c.req.json();
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
    }

    await bot.handleUpdate(update);
    return c.json({ ok: true });
  });

  // Public Gupshup webhook endpoint — auth-exempt, verified by optional ?token= query param.
  // Must be mounted before protectedApp so Gupshup's servers (no x-api-key) can reach it.
  app.post('/api/v2/channels/gupshup/:instanceId/webhook', async (c) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('gupshup');
    if (!plugin?.handleWebhook) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'Gupshup plugin not loaded' } }, 503);
    }

    return plugin.handleWebhook(c.req.raw);
  });

  // Public WhatsApp Cloud (Meta) webhook endpoint — auth-exempt, signed by Meta with HMAC-SHA256.
  // Unlike Gupshup/Twilio, the URL is GLOBAL (no :instanceId in path): instance resolution
  // happens inside the plugin via `metadata.phone_number_id` from the payload.
  //
  // - GET: Meta verification challenge (hub.mode=subscribe + hub.verify_token).
  // - POST: signed event delivery (X-Hub-Signature-256 verified against META_APP_SECRET).
  //
  // Both methods delegate to `plugin.handleWebhook(request)`, which internally
  // calls `handlers/webhook.ts::handleMetaWebhook` (reading META_VERIFY_TOKEN
  // and META_APP_SECRET from env). The plugin owns env access — keeping the
  // app.ts wiring identical to the Gupshup/Twilio pattern.
  app.get('/api/v2/channels/whatsapp-cloud/webhook', async (c) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('whatsapp-cloud');
    if (!plugin?.handleWebhook) {
      return c.json(
        { error: { code: 'PLUGIN_NOT_FOUND', message: 'WhatsApp Cloud plugin not loaded' } },
        503,
      );
    }

    return plugin.handleWebhook(c.req.raw);
  });

  app.post('/api/v2/channels/whatsapp-cloud/webhook', async (c) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('whatsapp-cloud');
    if (!plugin?.handleWebhook) {
      return c.json(
        { error: { code: 'PLUGIN_NOT_FOUND', message: 'WhatsApp Cloud plugin not loaded' } },
        503,
      );
    }

    return plugin.handleWebhook(c.req.raw);
  });

  // Public Twilio WhatsApp webhook endpoint - auth-exempt, verified by X-Twilio-Signature in the plugin.
  // Must be mounted before protectedApp so Twilio's servers (no x-api-key) can reach it.
  app.post('/api/v2/channels/twilio-whatsapp/:instanceId/webhook', async (c) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('twilio-whatsapp');
    if (!plugin?.handleWebhook) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'Twilio WhatsApp plugin not loaded' } }, 503);
    }

    return plugin.handleWebhook(c.req.raw);
  });

  // Protected routes
  const protectedApp = new Hono<{ Variables: AppVariables }>();
  protectedApp.use('*', authMiddleware);
  // Genie host signature verification (omni-host-fingerprint-trust group 4).
  // Runs BEFORE scope-enforcer so `signedBy`/`signedByScopes` are populated
  // on the context when scope-enforcer reads them for the per-host scope
  // intersection added in group 5. Bearer-only requests fall through unchanged.
  protectedApp.use('*', genieSignatureMiddleware);
  // Per-instance signature requirement (omni-host-fingerprint-trust group 6).
  // When `instance.requireGenieSignature = true` is set on the targeted
  // instance, requests without a verified `signedBy` are rejected with 401.
  // Default: false (additive rollout).
  protectedApp.use('*', requireSignedInstanceMiddleware);
  protectedApp.use('*', scopeEnforcerMiddleware);
  protectedApp.use('*', outputRedactorMiddleware);
  protectedApp.use('*', rateLimitMiddleware);

  // Mount v2 routes
  protectedApp.route('/', v2Routes);

  app.route('/api/v2', protectedApp);

  // ============================================
  // UI Static Files (production only)
  // ============================================
  // Serve built UI from apps/ui/dist when available
  // In dev, use Vite on :5173 instead
  // Try cwd first (works for worktrees), then fall back to OMNI_PACKAGES_DIR
  const cwdUiPath = path.resolve(process.cwd(), 'apps/ui/dist');
  const packagesUiPath = process.env.OMNI_PACKAGES_DIR
    ? path.resolve(process.env.OMNI_PACKAGES_DIR, '..', 'apps/ui/dist')
    : null;

  const uiDistPath = existsSync(cwdUiPath)
    ? cwdUiPath
    : packagesUiPath && existsSync(packagesUiPath)
      ? packagesUiPath
      : cwdUiPath; // fallback to cwd path even if not exists
  const serveUI = existsSync(uiDistPath);

  if (serveUI) {
    httpLog.info('Serving UI from apps/ui/dist');

    // Serve static assets (JS, CSS, images, fonts)
    app.use(
      '/assets/*',
      serveStatic({
        root: uiDistPath,
        rewriteRequestPath: (p) => p.replace(/^\/assets/, '/assets'),
      }),
    );

    // Serve other static files (favicon, etc.)
    app.get('/favicon.svg', serveStatic({ path: `${uiDistPath}/favicon.svg` }));
    app.get('/favicon.ico', serveStatic({ path: `${uiDistPath}/favicon.ico` }));

    // SPA fallback - serve index.html for non-API routes
    app.get('*', async (c) => {
      // Don't catch API routes
      if (c.req.path.startsWith('/api')) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: `Endpoint not found: ${c.req.method} ${c.req.path}`,
            },
          },
          404,
        );
      }
      // Serve index.html for client-side routing
      const indexPath = `${uiDistPath}/index.html`;
      const file = Bun.file(indexPath);
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' },
      });
    });
  }

  // 404 handler (only for API routes when UI is served, or all routes when not)
  app.notFound((c) => {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Endpoint not found: ${c.req.method} ${c.req.path}`,
        },
      },
      404,
    );
  });

  return { app, services };
}

export type App = Hono<{ Variables: AppVariables }>;
