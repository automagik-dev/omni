/**
 * Hono application setup
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChannelRegistry } from '@omni/channel-sdk';
import type { WhatsAppBusinessPlugin } from '@omni/channel-whatsapp-business';
import { type EventBus, createLogger } from '@omni/core';
import { type Database, type Instance, whatsappFlowKeys } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import { openCredentialField } from './tenancy/sealed-credentials';

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

type A2AInstanceValidationError = {
  body: { error: string };
  status: 400 | 403 | 404 | 409;
};

function validateA2AInstance(instance: Instance | null): A2AInstanceValidationError | null {
  if (!instance) {
    return { body: { error: 'Instance not found' }, status: 404 };
  }
  if (instance.channel !== 'a2a') {
    return { body: { error: 'Instance is not an A2A channel instance' }, status: 400 };
  }
  if (!instance.isActive) {
    return { body: { error: 'A2A instance is inactive' }, status: 403 };
  }
  if (!instance.agentId) {
    return { body: { error: 'A2A instance has no linked agent' }, status: 409 };
  }
  return null;
}

import { authMiddleware, requireAnyScope, requireInstanceAccess } from './middleware/auth';
import { defaultBodyLimitMiddleware } from './middleware/body-limit';
import { genieSignatureMiddleware } from './middleware/genie-signature';
import { outputRedactorMiddleware } from './middleware/output-redactor';
import { requireSignedInstanceMiddleware } from './middleware/require-signed-instance';
import { scopeEnforcerMiddleware } from './middleware/scope-enforcer';
import { tenancyMiddleware } from './middleware/tenancy';

import { createContextMiddleware } from './middleware/context';
import { errorHandler } from './middleware/error';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { defaultTimeoutMiddleware } from './middleware/timeout';
import { versionHeadersMiddleware } from './middleware/version-headers';
import { createWebhookAuthMiddleware } from './middleware/webhook-auth';
import { getHealth, healthRoutes } from './routes/health';
import { openapiRoutes } from './routes/openapi';
import { v2Routes } from './routes/v2';
import { platformTenantRoutes } from './routes/v2/platform-tenants';
import type { Services } from './services';
import { resolveA2AAgentCard } from './services/a2a-discovery';
import { isMultitenancyEnabled } from './tenancy/feature-flag';
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
      allowHeaders: ['Authorization', 'Content-Type', 'x-api-key', 'x-request-id', 'A2A-Version', 'A2A-Extensions'],
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
  app.get('/health', getHealth);

  // Health routes (no auth required)
  app.route('/api/v2', healthRoutes);

  // OpenAPI spec and Swagger UI (no auth required)
  app.route('/api/v2', openapiRoutes);

  // ── A2A protocol endpoints — feature-flagged, disabled by default ───────────
  if (process.env.A2A_ENABLED === 'true') {
    // Agent Card: GET /.well-known/agent-card.json?instanceId={id}
    const handleWellKnownAgentCard = async (c: Context<{ Variables: AppVariables }>) => {
      const url = new URL(c.req.url);
      const baseUrl = `${url.protocol}//${url.host}`;
      const resolved = await resolveA2AAgentCard({
        services: c.get('services'),
        baseUrl,
        instanceId: url.searchParams.get('instanceId'),
        agentId: url.searchParams.get('agentId'),
      });

      if (!resolved) {
        return c.json(
          {
            error: {
              code: 'A2A_AGENT_CARD_NOT_FOUND',
              message:
                'No active A2A agent card matched the request. Pass instanceId or agentId when multiple agents exist.',
            },
          },
          404,
        );
      }

      return c.json(resolved.card);
    };

    app.get('/.well-known/agent-card.json', handleWellKnownAgentCard);
    app.get('/.well-known/agent.json', handleWellKnownAgentCard);

    // A2A JSON-RPC: POST /a2a/:instanceId (requires auth + instance-level access)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    app.post(
      '/a2a/:instanceId',
      authMiddleware,
      requireInstanceAccess((c) => c.req.param('instanceId') ?? ''),
      requireAnyScope(['a2a:invoke', 'messages:send']),
      rateLimitMiddleware,
      async (c) => {
        const instanceId = c.req.param('instanceId') ?? '';
        if (!UUID_REGEX.test(instanceId)) {
          return c.json({ error: 'Invalid instance ID format' }, 400);
        }
        const services = c.get('services');
        const instance = await services.instances.getById(instanceId);
        const validationError = validateA2AInstance(instance);
        if (validationError) {
          return c.json(validationError.body, validationError.status);
        }
        const channelRegistry = c.get('channelRegistry');
        const plugin = channelRegistry?.get('a2a');
        if (!plugin?.handleWebhook) {
          return c.json({ error: 'A2A channel not available' }, 503);
        }
        const headers = new Headers(c.req.raw.headers);
        const apiKey = c.get('apiKey');
        if (apiKey?.id) {
          headers.set('x-omni-api-key-id', apiKey.id);
        }
        return plugin.handleWebhook(new Request(c.req.raw, { headers }));
      },
    );
  } else {
    app.all('/a2a/*', (c) => c.json({ error: 'A2A channel not enabled. Set A2A_ENABLED=true.' }, 503));
    app.get('/.well-known/agent-card.json', (c) => c.json({ error: 'A2A not enabled' }, 503));
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

  // Public Hermes (Mutant WhatsApp gateway) webhook endpoint — auth-exempt.
  // Hermes has no signature mechanism: authenticity rests on the per-instance
  // path (unguessable instance UUID) plus the handler's cross-check of the
  // payload's media_id against the instance's configured hermes_media_id.
  // Must be mounted before protectedApp so Mutant's servers can reach it.
  app.post('/api/v2/channels/hermes/:instanceId/webhook', async (c) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('hermes');
    if (!plugin?.handleWebhook) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'Hermes plugin not loaded' } }, 503);
    }

    return plugin.handleWebhook(c.req.raw);
  });

  // Public ASC Brazil (ASCWhats GW) webhook endpoint — auth-exempt.
  // ASC documents no payload signature: authenticity rests on the per-instance
  // path (unguessable instance UUID) plus an optional verify token (`chave`)
  // checked by the handler when configured on the instance.
  // - GET: Meta-style verification challenge (hub.challenge echo).
  // - POST: Meta Cloud API-format event delivery.
  // Must be mounted before protectedApp so ASC's servers can reach it.
  const handleAscWebhook = async (c: Context<{ Variables: AppVariables }>) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('asc');
    if (!plugin?.handleWebhook) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'ASC plugin not loaded' } }, 503);
    }

    return plugin.handleWebhook(c.req.raw);
  };
  app.post('/api/v2/channels/asc/:instanceId/webhook', handleAscWebhook);
  app.get('/api/v2/channels/asc/:instanceId/webhook', handleAscWebhook);

  // Public WhatsApp Business API (Meta) webhook endpoint — auth-exempt, signed by Meta with HMAC-SHA256.
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
  //
  // Registered under TWO paths: `channels/whatsapp-business` (canonical) and
  // `channels/whatsapp-cloud` (frozen legacy alias — this URL is pasted into
  // Meta App dashboards by customers; renaming it would break every already-
  // configured app, so the alias is PERMANENT).
  const handleWhatsAppBusinessWebhook = async (c: Context<{ Variables: AppVariables }>) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('whatsapp-business');
    if (!plugin?.handleWebhook) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'WhatsApp Business plugin not loaded' } }, 503);
    }

    return plugin.handleWebhook(c.req.raw);
  };

  app.get('/api/v2/channels/whatsapp-business/webhook', handleWhatsAppBusinessWebhook);
  app.post('/api/v2/channels/whatsapp-business/webhook', handleWhatsAppBusinessWebhook);
  // Legacy alias (pre-rename channel id) — see comment above. Do not remove.
  app.get('/api/v2/channels/whatsapp-cloud/webhook', handleWhatsAppBusinessWebhook);
  app.post('/api/v2/channels/whatsapp-cloud/webhook', handleWhatsAppBusinessWebhook);

  // Public WhatsApp Flows data-exchange endpoint — auth-exempt sibling of the
  // webhook above. Authenticated by X-Hub-Signature-256 + payload encryption
  // (only the instance's registered private key can decrypt). `:instanceId`
  // selects the keypair; the whatsapp-flows routes set this URL as the flow's
  // `endpoint_uri` when created/updated with `dynamic: true`.
  //
  // Instance lookup + private-key unsealing happen HERE (the API owns DB and
  // sealing); signature/crypto/screen-resolution happen in the plugin
  // (`handleFlowData` → handlers/flow-data.ts). Status codes are part of
  // Meta's contract: 404 unknown instance, 421 undecryptable (client
  // re-fetches the public key), 427 bad flow token, 432 bad signature.
  //
  // Dual-registered like the webhook: flows created before the rename carry
  // the whatsapp-cloud path in their Meta-side `endpoint_uri` — the legacy
  // alias keeps them serving. New flows are wired to the canonical path.
  const handleWhatsAppFlowsData = async (c: Context<{ Variables: AppVariables }>) => {
    const channelRegistry = c.get('channelRegistry');

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get('whatsapp-business') as WhatsAppBusinessPlugin | undefined;
    if (!plugin?.handleFlowData) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'WhatsApp Business plugin not loaded' } }, 503);
    }

    const instanceId = c.req.param('instanceId') ?? '';
    const services = c.get('services');
    const instance = await services.instances.getById(instanceId).catch(() => null);
    if (!instance || instance.channel !== 'whatsapp-business') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Unknown instance' } }, 404);
    }

    const db = c.get('db');
    const [keyRow] = await db
      .select()
      .from(whatsappFlowKeys)
      .where(eq(whatsappFlowKeys.instanceId, instanceId))
      .limit(1);
    // No key row, or sealed under a key we can't open → 421: Meta re-fetches
    // the public key and ops gets a signal instead of a silent decrypt loop.
    const privateKeyPem = keyRow ? openCredentialField(instance.tenantId, keyRow.privateKeyPem) : null;
    if (!privateKeyPem) {
      httpLog.warn('Flow data request without usable private key', { instanceId, hasKeyRow: Boolean(keyRow) });
      return c.body(null, 421);
    }

    return plugin.handleFlowData(c.req.raw, { instanceId, privateKeyPem });
  };

  app.post('/api/v2/channels/whatsapp-business/flows/data/:instanceId', handleWhatsAppFlowsData);
  // Legacy alias (pre-rename channel id) — see comment above. Do not remove.
  app.post('/api/v2/channels/whatsapp-cloud/flows/data/:instanceId', handleWhatsAppFlowsData);

  // Legacy REST alias: /api/v2/instances/:id/whatsapp-cloud/* re-dispatches to
  // the canonical /whatsapp-business/* path through the full pipeline (auth,
  // scopes and ownership are enforced by the INNER canonical match — this
  // catch-all only rewrites the URL). Kept permanently for pre-rename API
  // consumers (older SDKs, khal-ui builds, remote installs).
  app.all('/api/v2/instances/:instanceId/whatsapp-cloud/*', (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace('/whatsapp-cloud/', '/whatsapp-business/');
    return app.fetch(new Request(url.toString(), c.req.raw), c.env);
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

  // ── Multitenancy control plane — feature-flagged, OFF by default ────────────
  // Mounted ONLY when OMNI_MULTITENANCY_ENABLED === "true". When off, this
  // surface does not exist (404) and legacy route/auth behavior is untouched.
  // These routes carry their OWN platform-class auth guard (platformAuthMiddleware)
  // and deliberately bypass the legacy bearer authMiddleware / scope-enforcer so
  // tenant/legacy keys can never reach the control plane.
  if (isMultitenancyEnabled()) {
    app.route('/api/v2/platform', platformTenantRoutes);
    httpLog.info('Multitenancy control plane mounted at /api/v2/platform (OMNI_MULTITENANCY_ENABLED=true)');
  }

  // Protected routes
  const protectedApp = new Hono<{ Variables: AppVariables }>();
  // Tenancy edge (wish: omni-full-multitenancy, G4). Runs BEFORE the legacy
  // bearer auth so a tenant-class credential is recognised, given its immutable
  // context, and wrapped in a tenant-stamped transaction for the whole chain.
  // A credential the auth plane does not know falls straight through and the
  // legacy path below behaves exactly as it did pre-G4.
  protectedApp.use('*', tenancyMiddleware);
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
  // OMNI_FORCE_UI_ROUTES makes registration independent of the filesystem so the
  // route-ownership gate enumerates the same surface whether or not the UI bundle
  // has been built. Enumeration-only: it is set (and restored) inside
  // enumerateRegisteredRoutes, never in a serving configuration.
  const serveUI = process.env.OMNI_FORCE_UI_ROUTES === 'true' || existsSync(uiDistPath);

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
