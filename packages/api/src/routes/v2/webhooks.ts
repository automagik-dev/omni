/**
 * Webhook routes - webhook receiver and source management
 */

import { zValidator } from '@hono/zod-validator';
import type { CustomEventType } from '@omni/core';
import type { WebhookSource } from '@omni/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { CreateWebhookSourceSchema } from '../../schemas/openapi/webhooks';
import { ApiKeyService } from '../../services/api-keys';
import type { AppVariables } from '../../types';
import { parseJsonObjectBody } from '../../utils/json-body';

const webhooksRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// Webhook Source CRUD
// ============================================================================

// Create webhook source schema — the shared OpenAPI definition IS the runtime
// validator (signature contract, bounds and refinements included), so the
// published document and what the route accepts cannot drift (issue #928).
const createWebhookSourceSchema = CreateWebhookSourceSchema;

/** The secret is write-only: strip it from every response shape. */
function sanitizeSource(source: WebhookSource): Omit<WebhookSource, 'signatureSecret'> & {
  hasSignatureSecret: boolean;
} {
  const { signatureSecret, ...rest } = source;
  return { ...rest, hasSignatureSecret: Boolean(signatureSecret) };
}

// Update webhook source schema
const updateWebhookSourceSchema = createWebhookSourceSchema.partial();

// List query schema
const listQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
});

/**
 * GET /webhook-sources - List all webhook sources
 */
webhooksRoutes.get('/webhook-sources', zValidator('query', listQuerySchema), async (c) => {
  const { enabled } = c.req.valid('query');
  const services = c.get('services');

  const sources = await services.webhooks.list({ enabled });

  return c.json({ items: sources.map(sanitizeSource) });
});

/**
 * GET /webhook-sources/:id - Get webhook source by ID
 */
webhooksRoutes.get('/webhook-sources/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const source = await services.webhooks.getById(id);

  return c.json({ data: sanitizeSource(source) });
});

/**
 * POST /webhook-sources - Create webhook source
 */
webhooksRoutes.post('/webhook-sources', zValidator('json', createWebhookSourceSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const source = await services.webhooks.create(data);

  return c.json({ data: sanitizeSource(source) }, 201);
});

/**
 * PATCH /webhook-sources/:id - Update webhook source
 */
webhooksRoutes.patch('/webhook-sources/:id', zValidator('json', updateWebhookSourceSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const source = await services.webhooks.update(id, data);

  return c.json({ data: sanitizeSource(source) });
});

/**
 * DELETE /webhook-sources/:id - Delete webhook source
 */
webhooksRoutes.delete('/webhook-sources/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  await services.webhooks.delete(id);

  return c.json({ success: true });
});

// ============================================================================
// Webhook Receiver
// ============================================================================

/**
 * POST /webhooks/:source - Receive webhook from external system
 *
 * The payload is passed through to the event system as-is.
 * Creates `custom.webhook.{source}` event.
 *
 * Sources are created administratively (POST /webhook-sources); a request for
 * an unknown source is a 404 unless OMNI_WEBHOOK_AUTOCREATE=true opts the
 * deployment into the old auto-create behavior (dev convenience, issue #928).
 *
 * Body contract matches the public ingress: empty body → `{}`; a non-empty
 * body that is not a JSON object (malformed, array, scalar) is a 400 —
 * silently publishing an empty payload would fire automations on a hollow
 * event.
 */
webhooksRoutes.post('/webhooks/:source', async (c) => {
  const sourceName = c.req.param('source');
  const services = c.get('services');

  // Keep the raw bytes: HMAC signature verification must run over them
  const rawBody = await c.req.text();
  const payload = parseJsonObjectBody(rawBody);

  // Extract headers (lowercase keys)
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(c.req.header())) {
    headers[key.toLowerCase()] = value ?? '';
  }

  // Receive and process the webhook
  const result = await services.webhooks.receive(sourceName, payload, headers, {
    autoCreate: process.env.OMNI_WEBHOOK_AUTOCREATE === 'true',
    rawBody,
  });

  return c.json(result);
});

/**
 * POST /webhooks/:source/heartbeat - Connector heartbeat (#961)
 *
 * A supervised connector's cheap "I ran, zero events found": resets the
 * liveness window (distinguishing quiet from dead) without creating a journal
 * event per heartbeat — the source row's lastHeartbeatAt/heartbeatCount is
 * the compacted trace, and only the stalled/recovered TRANSITIONS are
 * journaled (by the liveness sweeper). Authenticated route only; no body.
 */
webhooksRoutes.post('/webhooks/:source/heartbeat', async (c) => {
  const sourceName = c.req.param('source');
  const services = c.get('services');

  const result = await services.webhooks.heartbeat(sourceName);

  return c.json(result);
});

// ============================================================================
// Manual Event Trigger
// ============================================================================

// Trigger event schema
const triggerEventSchema = z.object({
  eventType: z
    .string()
    .min(1)
    .refine((t) => t.startsWith('custom.'), { message: 'Event type must start with "custom."' })
    .describe('Event type (must be custom.*)'),
  payload: z.record(z.string(), z.unknown()).describe('Event payload'),
  correlationId: z.string().optional().describe('Optional correlation ID'),
  instanceId: z.string().uuid().optional().describe('Optional instance ID for context'),
});

/**
 * POST /events/trigger - Manually trigger a custom event
 */
webhooksRoutes.post('/events/trigger', zValidator('json', triggerEventSchema), async (c) => {
  const { eventType, payload, correlationId, instanceId } = c.req.valid('json');
  const services = c.get('services');
  const apiKey = c.get('apiKey');

  // Enforce instance access on trigger
  if (instanceId && apiKey && !ApiKeyService.instanceAllowed(apiKey.instanceIds, instanceId)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'API key does not have access to this instance' } }, 403);
  }

  const result = await services.webhooks.trigger(eventType as CustomEventType, payload, {
    correlationId,
    instanceId,
  });

  return c.json(result, 201);
});

export { webhooksRoutes };
