/**
 * OpenAPI schemas for payload storage endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

// Payload stages
const PayloadStageSchema = z.enum(['webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error']);

// Payload metadata schema
export const PayloadMetadataSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Payload UUID' }),
  eventId: z.string().uuid().openapi({ description: 'Event UUID' }),
  stage: PayloadStageSchema.openapi({ description: 'Payload stage' }),
  mimeType: z.string().openapi({ description: 'MIME type' }),
  sizeBytes: z.number().int().openapi({ description: 'Size in bytes' }),
  hasData: z.boolean().openapi({ description: 'Whether data is available' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
});

// Payload with data schema
export const PayloadWithDataSchema = PayloadMetadataSchema.extend({
  payload: z.unknown().openapi({ description: 'Decompressed payload data' }),
});

// Payload config schema
export const PayloadConfigSchema = z.object({
  eventType: z.string().openapi({ description: 'Event type pattern' }),
  storeWebhookRaw: z.boolean().openapi({ description: 'Store webhook raw' }),
  storeAgentRequest: z.boolean().openapi({ description: 'Store agent request' }),
  storeAgentResponse: z.boolean().openapi({ description: 'Store agent response' }),
  storeChannelSend: z.boolean().openapi({ description: 'Store channel send' }),
  storeError: z.boolean().openapi({ description: 'Store errors' }),
  retentionDays: z.number().int().openapi({ description: 'Retention in days' }),
});

// Update config request
export const UpdatePayloadConfigSchema = z.object({
  storeWebhookRaw: z.boolean().optional().openapi({ description: 'Store webhook raw' }),
  storeAgentRequest: z.boolean().optional().openapi({ description: 'Store agent request' }),
  storeAgentResponse: z.boolean().optional().openapi({ description: 'Store agent response' }),
  storeChannelSend: z.boolean().optional().openapi({ description: 'Store channel send' }),
  storeError: z.boolean().optional().openapi({ description: 'Store errors' }),
  retentionDays: z.number().int().min(1).max(365).optional().openapi({ description: 'Retention in days' }),
});

// Delete payloads request
export const DeletePayloadsSchema = z.object({
  reason: z.string().min(1).max(255).openapi({ description: 'Deletion reason' }),
});

// Payload stats
export const PayloadStatsSchema = z.object({
  totalPayloads: z.number().int().openapi({ description: 'Total payloads' }),
  totalSizeBytes: z.number().int().openapi({ description: 'Total size' }),
  byStage: z.record(PayloadStageSchema, z.number().int()).openapi({ description: 'Count by stage' }),
  oldestPayload: z.string().datetime().nullable().openapi({ description: 'Oldest payload date' }),
});

export function registerPayloadSchemas(registry: OpenAPIRegistry): void {
  registry.register('PayloadMetadata', PayloadMetadataSchema);
  registry.register('PayloadWithData', PayloadWithDataSchema);
  registry.register('PayloadConfig', PayloadConfigSchema);
  registry.register('UpdatePayloadConfigRequest', UpdatePayloadConfigSchema);
  registry.register('DeletePayloadsRequest', DeletePayloadsSchema);
  registry.register('PayloadStats', PayloadStatsSchema);

  registry.registerPath({
    method: 'get',
    path: '/events/{eventId}/payloads',
    tags: ['Payloads'],
    summary: 'List event payloads',
    description: 'Get all payloads for an event (metadata only).',
    request: { params: z.object({ eventId: z.string().uuid().openapi({ description: 'Event UUID' }) }) },
    responses: {
      200: {
        description: 'Payload list',
        content: { 'application/json': { schema: z.object({ items: z.array(PayloadMetadataSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/{eventId}/payloads/{stage}',
    tags: ['Payloads'],
    summary: 'Get event payload by stage',
    description: 'Get a specific stage payload with decompressed data.',
    request: {
      params: z.object({
        eventId: z.string().uuid().openapi({ description: 'Event UUID' }),
        stage: PayloadStageSchema.openapi({ description: 'Payload stage' }),
      }),
    },
    responses: {
      200: {
        description: 'Payload with data',
        content: { 'application/json': { schema: z.object({ data: PayloadWithDataSchema }) } },
      },
      400: { description: 'Invalid stage', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/events/{eventId}/payloads',
    tags: ['Payloads'],
    summary: 'Delete event payloads',
    description: 'Soft-delete all payloads for an event.',
    request: {
      params: z.object({ eventId: z.string().uuid().openapi({ description: 'Event UUID' }) }),
      body: { content: { 'application/json': { schema: DeletePayloadsSchema } } },
    },
    responses: {
      200: {
        description: 'Deleted count',
        content: { 'application/json': { schema: z.object({ deleted: z.number().int() }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/payload-config',
    tags: ['Payloads'],
    summary: 'List payload configs',
    description: 'Get all payload storage configurations.',
    responses: {
      200: {
        description: 'Config list',
        content: { 'application/json': { schema: z.object({ items: z.array(PayloadConfigSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/payload-config/{eventType}',
    tags: ['Payloads'],
    summary: 'Update payload config',
    description: 'Update or create payload storage config for an event type.',
    request: {
      params: z.object({ eventType: z.string().openapi({ description: 'Event type pattern' }) }),
      body: { content: { 'application/json': { schema: UpdatePayloadConfigSchema } } },
    },
    responses: {
      200: {
        description: 'Updated config',
        content: { 'application/json': { schema: z.object({ data: PayloadConfigSchema }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/payload-stats',
    tags: ['Payloads'],
    summary: 'Get payload stats',
    description: 'Get payload storage statistics.',
    responses: {
      200: {
        description: 'Stats',
        content: { 'application/json': { schema: z.object({ data: PayloadStatsSchema }) } },
      },
    },
  });
}
