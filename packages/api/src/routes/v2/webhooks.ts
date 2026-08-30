/**
 * Webhook routes - webhook receiver and source management
 */

import { zValidator } from '@hono/zod-validator';
import type { CustomEventType } from '@omni/core';
import type { WebhookSource } from '@omni/db';
import { webhookSignatureAlgorithms } from '@omni/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiKeyService } from '../../services/api-keys';
import type { AppVariables } from '../../types';

const webhooksRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// Webhook Source CRUD
// ============================================================================

// Signature verification contract for the source (issue #928)
const signatureConfigSchema = z.object({
  algorithm: z.enum(webhookSignatureAlgorithms).describe('How to verify: HMAC over the raw body, or token match'),
  header: z.string().min(1).max(200).describe('Header carrying the signature/token (e.g. X-Hub-Signature-256)'),
  prefix: z.string().max(50).optional().describe('Prefix before the hex digest (e.g. "sha256=")'),
});

// Create webhook source schema
const createWebhookSourceSchema = z.object({
  name: z.string().min(1).max(100).describe('Unique source name (e.g., github, stripe, agno)'),
  description: z.string().optional().describe('Description of the webhook source'),
  expectedHeaders: z.record(z.string(), z.boolean()).optional().describe('Headers to validate'),
  signatureConfig: signatureConfigSchema.nullable().optional().describe('Signature verification config'),
  signatureSecret: z.string().min(8).max(512).nullable().optional().describe('Shared secret (write-only)'),
  enabled: z.boolean().default(true).describe('Whether source is enabled'),
});

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
 */
webhooksRoutes.post('/webhooks/:source', async (c) => {
  const sourceName = c.req.param('source');
  const services = c.get('services');

  // Keep the raw bytes: HMAC signature verification must run over them
  const rawBody = await c.req.text();
  let payload: Record<string, unknown>;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {}; // Empty payload is fine for some webhooks
  }

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
