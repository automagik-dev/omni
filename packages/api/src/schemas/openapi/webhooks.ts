/**
 * OpenAPI schemas for webhook endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import {
  connectorLivenessStatuses,
  connectorMutationPolicies,
  connectorWindowSemanticsValues,
  webhookSignatureAlgorithms,
} from '@omni/db';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Signature verification contract (issue #928). This is the ONE Zod
// definition: the route validator (`routes/v2/webhooks.ts`) imports it, so the
// published OpenAPI document and the runtime validation cannot drift. The
// bounds and the token-match/prefix refinement are enforced at the boundary;
// the config/secret pairing is enforced by `WebhookService` (create/update).
// The secret itself is write-only — it never appears in any response schema.
export const WebhookSignatureConfigSchema = z
  .object({
    algorithm: z.enum(webhookSignatureAlgorithms).openapi({
      description: 'How to verify: HMAC over the raw request body, or direct token match',
    }),
    header: z.string().min(1).max(200).openapi({
      description: 'Header carrying the signature/token (e.g. X-Hub-Signature-256). 1-200 characters',
    }),
    prefix: z.string().max(50).optional().openapi({
      description:
        'Prefix before the hex digest (e.g. "sha256="), at most 50 characters. HMAC algorithms only — rejected with token-match',
    }),
  })
  .refine((config) => config.algorithm !== 'token-match' || config.prefix === undefined, {
    message: "prefix is not applicable to algorithm 'token-match'",
    path: ['prefix'],
  });

// Webhook source schema
export const WebhookSourceSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Source UUID' }),
  name: z.string().openapi({ description: 'Source name' }),
  description: z.string().nullable().openapi({ description: 'Description' }),
  expectedHeaders: z.record(z.string(), z.boolean()).nullable().openapi({ description: 'Expected headers' }),
  signatureConfig: WebhookSignatureConfigSchema.nullable().openapi({ description: 'Signature verification config' }),
  hasSignatureSecret: z
    .boolean()
    .openapi({ description: 'Whether a signature secret is stored (secret is write-only)' }),
  enabled: z.boolean().openapi({ description: 'Whether enabled' }),
  lastReceivedAt: z.string().datetime().nullable().openapi({ description: 'When the last webhook was received' }),
  totalReceived: z.number().int().openapi({ description: 'Total webhooks received' }),
  // Connector lifecycle contract (#961)
  expectedIntervalSeconds: z
    .number()
    .int()
    .nullable()
    .openapi({ description: 'Declared cadence: >=1 event or heartbeat per N seconds. Null = unsupervised' }),
  lastHeartbeatAt: z.string().datetime().nullable().openapi({ description: 'Last heartbeat ("ran, zero events")' }),
  heartbeatCount: z.number().int().openapi({ description: 'Total heartbeats received' }),
  livenessStatus: z
    .enum(connectorLivenessStatuses)
    .nullable()
    .openapi({ description: 'Liveness state; null = unsupervised. Transitions emit system.connector.* events' }),
  livenessArmedAt: z.string().datetime().nullable().openapi({ description: 'When the cadence was (re)declared' }),
  stalledAt: z.string().datetime().nullable().openapi({ description: 'When the current stall began' }),
  windowSemantics: z
    .enum(connectorWindowSemanticsValues)
    .nullable()
    .openapi({ description: 'Declared window semantics; null = undeclared' }),
  mutationPolicy: z
    .enum(connectorMutationPolicies)
    .nullable()
    .openapi({ description: 'Declared upstream-mutation re-emit policy; null = undeclared' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create webhook source request
export const CreateWebhookSourceSchema = z.object({
  name: z.string().min(1).max(100).openapi({ description: 'Unique source name (e.g., github, stripe, agno)' }),
  description: z.string().optional().openapi({ description: 'Description' }),
  expectedHeaders: z.record(z.string(), z.boolean()).optional().openapi({ description: 'Headers to validate' }),
  signatureConfig: WebhookSignatureConfigSchema.nullable()
    .optional()
    .openapi({
      description:
        'Signature verification config; required for the source to be reachable on the public ingress. ' +
        'Always paired with signatureSecret: a config without a stored secret is rejected (400), and clearing ' +
        'the config (null) also clears the stored secret.',
    }),
  signatureSecret: z
    .string()
    .min(8)
    .max(512)
    .nullable()
    .optional()
    .openapi({
      description:
        'Shared secret used by signatureConfig (write-only, never returned; 8-512 characters). Cannot be set ' +
        'without a signatureConfig (given in the same request, or already stored on update); null clears it.',
    }),
  enabled: z.boolean().default(true).openapi({ description: 'Whether enabled' }),
  // Connector lifecycle contract (#961)
  expectedIntervalSeconds: z
    .number()
    .int()
    .min(1)
    .max(2_592_000)
    .nullable()
    .optional()
    .openapi({
      description:
        'Declared cadence: the connector promises >=1 event or heartbeat per N seconds (1s-30d). Declaring it ' +
        'arms liveness supervision (silence beyond the window emits system.connector.stalled and marks the ' +
        'source unhealthy); null disarms it.',
    }),
  windowSemantics: z
    .enum(connectorWindowSemanticsValues)
    .nullable()
    .optional()
    .openapi({
      description:
        "Declared time-window semantics: 'future_only' (only not-yet-started items) or 'includes_in_progress'. " +
        'Informational contract for consumers; null = undeclared.',
    }),
  mutationPolicy: z
    .enum(connectorMutationPolicies)
    .nullable()
    .optional()
    .openapi({
      description:
        "How the source re-emits a changed upstream item: 'same_id' (reschedule case — consumers must key on " +
        "id+content) or 'new_id'. Feeds the idempotency key template choice; null = undeclared.",
    }),
});

// Heartbeat response (#961)
export const WebhookHeartbeatResponseSchema = z.object({
  ok: z.literal(true).openapi({ description: 'Heartbeat recorded' }),
  source: z.string().openapi({ description: 'Webhook source name' }),
  heartbeatAt: z.string().datetime().openapi({ description: 'When the heartbeat was recorded' }),
  livenessStatus: z
    .enum(connectorLivenessStatuses)
    .nullable()
    .openapi({ description: 'Status before this heartbeat (a stalled source recovers on the next sweep tick)' }),
  expectedIntervalSeconds: z.number().int().nullable().openapi({ description: 'Declared cadence, if any' }),
});

// Trigger event request
export const TriggerEventSchema = z.object({
  eventType: z.string().min(1).openapi({ description: 'Event type (must start with custom.)' }),
  payload: z.record(z.string(), z.unknown()).openapi({ description: 'Event payload' }),
  correlationId: z.string().optional().openapi({ description: 'Correlation ID' }),
  instanceId: z.string().uuid().optional().openapi({ description: 'Instance ID for context' }),
});

// Webhook receive response
export const WebhookReceiveResponseSchema = z.object({
  eventId: z.string().uuid().openapi({ description: 'Created event ID' }),
  source: z.string().openapi({ description: 'Webhook source name' }),
  eventType: z.string().openapi({ description: 'Event type' }),
});

export function registerWebhookSchemas(registry: OpenAPIRegistry): void {
  registry.register('WebhookSignatureConfig', WebhookSignatureConfigSchema);
  registry.register('WebhookSource', WebhookSourceSchema);
  registry.register('CreateWebhookSourceRequest', CreateWebhookSourceSchema);
  registry.register('TriggerEventRequest', TriggerEventSchema);
  registry.register('WebhookReceiveResponse', WebhookReceiveResponseSchema);
  registry.register('WebhookHeartbeatResponse', WebhookHeartbeatResponseSchema);

  registry.registerPath({
    method: 'get',
    path: '/webhook-sources',
    operationId: 'listWebhookSources',
    tags: ['Webhooks'],
    summary: 'List webhook sources',
    description: 'Get all configured webhook sources.',
    request: { query: z.object({ enabled: z.boolean().optional().openapi({ description: 'Filter by enabled' }) }) },
    responses: {
      200: {
        description: 'List of sources',
        content: { 'application/json': { schema: z.object({ items: z.array(WebhookSourceSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/webhook-sources/{id}',
    operationId: 'getWebhookSource',
    tags: ['Webhooks'],
    summary: 'Get webhook source',
    description: 'Get details of a specific webhook source.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Source UUID' }) }) },
    responses: {
      200: {
        description: 'Source details',
        content: { 'application/json': { schema: z.object({ data: WebhookSourceSchema }) } },
      },
      404: { description: 'Source not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/webhook-sources',
    operationId: 'createWebhookSource',
    tags: ['Webhooks'],
    summary: 'Create webhook source',
    description: 'Create a new webhook source.',
    request: { body: { content: { 'application/json': { schema: CreateWebhookSourceSchema } } } },
    responses: {
      201: {
        description: 'Source created',
        content: { 'application/json': { schema: z.object({ data: WebhookSourceSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/webhook-sources/{id}',
    operationId: 'updateWebhookSource',
    tags: ['Webhooks'],
    summary: 'Update webhook source',
    description: 'Update an existing webhook source.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Source UUID' }) }),
      body: { content: { 'application/json': { schema: CreateWebhookSourceSchema.partial() } } },
    },
    responses: {
      200: {
        description: 'Source updated',
        content: { 'application/json': { schema: z.object({ data: WebhookSourceSchema }) } },
      },
      404: { description: 'Source not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/webhook-sources/{id}',
    operationId: 'deleteWebhookSource',
    tags: ['Webhooks'],
    summary: 'Delete webhook source',
    description: 'Delete a webhook source.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Source UUID' }) }) },
    responses: {
      200: { description: 'Source deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Source not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/webhooks/{source}',
    operationId: 'receiveWebhook',
    tags: ['Webhooks'],
    summary: 'Receive webhook',
    description:
      'Receive webhook from external system. Creates a custom event. An empty body is accepted as an empty ' +
      'payload; a non-empty body that is not a JSON object (malformed, array, scalar) is rejected.',
    request: {
      params: z.object({ source: z.string().openapi({ description: 'Source name' }) }),
      body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
    },
    responses: {
      200: {
        description: 'Webhook received',
        content: { 'application/json': { schema: WebhookReceiveResponseSchema } },
      },
      400: { description: 'Body is not a JSON object', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/webhooks/{source}/heartbeat',
    operationId: 'heartbeatWebhookSource',
    tags: ['Webhooks'],
    summary: 'Connector heartbeat',
    description:
      'Record a connector heartbeat: "I ran, zero events found". Resets the liveness window of a supervised ' +
      'source (one declaring expectedIntervalSeconds) so silence-beyond-window detection can tell quiet from ' +
      'dead. Creates NO journal event — only the stalled/recovered transitions are journaled. No request body.',
    request: {
      params: z.object({ source: z.string().openapi({ description: 'Source name' }) }),
    },
    responses: {
      200: {
        description: 'Heartbeat recorded',
        content: { 'application/json': { schema: WebhookHeartbeatResponseSchema } },
      },
      403: { description: 'Source disabled', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Source not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/webhooks/ingress/{source}',
    operationId: 'receiveWebhookIngress',
    tags: ['Webhooks'],
    summary: 'Public webhook ingress',
    description:
      'Auth-exempt receiver for third-party webhook senders. Requires the source to have a signature ' +
      'configuration; the request is verified against it (HMAC over the raw body, or token match) before any ' +
      'event is published. Unknown, disabled, unconfigured, or badly signed requests all return the same 401. ' +
      'A non-empty body that is not a JSON object (malformed, array, scalar) is rejected with 400.',
    security: [],
    request: {
      params: z.object({ source: z.string().openapi({ description: 'Source name' }) }),
      body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
    },
    responses: {
      200: {
        description: 'Webhook received',
        content: { 'application/json': { schema: WebhookReceiveResponseSchema } },
      },
      400: { description: 'Body is not a JSON object', content: { 'application/json': { schema: ErrorSchema } } },
      401: { description: 'Verification failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/events/trigger',
    operationId: 'triggerEvent',
    tags: ['Webhooks'],
    summary: 'Trigger custom event',
    description: 'Manually trigger a custom event.',
    request: { body: { content: { 'application/json': { schema: TriggerEventSchema } } } },
    responses: {
      201: {
        description: 'Event triggered',
        content: { 'application/json': { schema: WebhookReceiveResponseSchema } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
