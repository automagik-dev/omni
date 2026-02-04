/**
 * OpenAPI schemas for webhook endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Webhook source schema
export const WebhookSourceSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Source UUID' }),
  name: z.string().openapi({ description: 'Source name' }),
  description: z.string().nullable().openapi({ description: 'Description' }),
  expectedHeaders: z.record(z.string(), z.boolean()).nullable().openapi({ description: 'Expected headers' }),
  enabled: z.boolean().openapi({ description: 'Whether enabled' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create webhook source request
export const CreateWebhookSourceSchema = z.object({
  name: z.string().min(1).max(100).openapi({ description: 'Unique source name' }),
  description: z.string().optional().openapi({ description: 'Description' }),
  expectedHeaders: z.record(z.string(), z.boolean()).optional().openapi({ description: 'Headers to validate' }),
  enabled: z.boolean().default(true).openapi({ description: 'Whether enabled' }),
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
  registry.register('WebhookSource', WebhookSourceSchema);
  registry.register('CreateWebhookSourceRequest', CreateWebhookSourceSchema);
  registry.register('TriggerEventRequest', TriggerEventSchema);
  registry.register('WebhookReceiveResponse', WebhookReceiveResponseSchema);

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
    description: 'Receive webhook from external system. Creates a custom event.',
    request: {
      params: z.object({ source: z.string().openapi({ description: 'Source name' }) }),
      body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
    },
    responses: {
      200: {
        description: 'Webhook received',
        content: { 'application/json': { schema: WebhookReceiveResponseSchema } },
      },
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
