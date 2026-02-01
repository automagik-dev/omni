/**
 * OpenAPI schemas for event operations endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Replay options schema
export const ReplayOptionsSchema = z.object({
  since: z.string().datetime().openapi({ description: 'Start date (required)' }),
  until: z.string().datetime().optional().openapi({ description: 'End date' }),
  eventTypes: z.array(z.string()).optional().openapi({ description: 'Event types to replay' }),
  instanceId: z.string().uuid().optional().openapi({ description: 'Filter by instance' }),
  limit: z.number().int().positive().max(100000).optional().openapi({ description: 'Max events' }),
  speedMultiplier: z.number().min(0).max(100).optional().openapi({ description: 'Replay speed' }),
  skipProcessed: z.boolean().optional().openapi({ description: 'Skip already processed' }),
  dryRun: z.boolean().optional().openapi({ description: 'Dry run mode' }),
});

// Replay session schema
export const ReplaySessionSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Session UUID' }),
  status: z.enum(['running', 'completed', 'cancelled', 'failed']).openapi({ description: 'Status' }),
  options: ReplayOptionsSchema,
  progress: z.object({
    total: z.number().int(),
    processed: z.number().int(),
    failed: z.number().int(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  }),
});

// Event metrics schema
export const EventMetricsSchema = z.object({
  total: z.number().int().openapi({ description: 'Total events' }),
  today: z.number().int().openapi({ description: 'Events today' }),
  byType: z.record(z.string(), z.number()).openapi({ description: 'Count by type' }),
  byChannel: z.record(z.string(), z.number()).openapi({ description: 'Count by channel' }),
  avgProcessingTime: z.number().openapi({ description: 'Avg processing time (ms)' }),
});

// Scheduled ops result
export const ScheduledOpsResultSchema = z.object({
  deadLetterRetry: z.object({
    attempted: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
  }),
  payloadCleanup: z.object({
    deleted: z.number().int(),
  }),
});

export function registerEventOpsSchemas(registry: OpenAPIRegistry): void {
  registry.register('ReplayOptions', ReplayOptionsSchema);
  registry.register('ReplaySession', ReplaySessionSchema);
  registry.register('EventMetrics', EventMetricsSchema);
  registry.register('ScheduledOpsResult', ScheduledOpsResultSchema);

  registry.registerPath({
    method: 'get',
    path: '/event-ops/metrics',
    tags: ['Events'],
    summary: 'Get event metrics',
    description: 'Get event processing metrics.',
    responses: {
      200: {
        description: 'Metrics',
        content: { 'application/json': { schema: z.object({ data: EventMetricsSchema }) } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/event-ops/replay',
    tags: ['Events'],
    summary: 'Start replay session',
    description: 'Start an event replay session.',
    request: { body: { content: { 'application/json': { schema: ReplayOptionsSchema } } } },
    responses: {
      202: {
        description: 'Replay started',
        content: { 'application/json': { schema: z.object({ data: ReplaySessionSchema }) } },
      },
      400: { description: 'Invalid options', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/event-ops/replay',
    tags: ['Events'],
    summary: 'List replay sessions',
    description: 'List all replay sessions.',
    responses: {
      200: {
        description: 'Sessions',
        content: { 'application/json': { schema: z.object({ items: z.array(ReplaySessionSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/event-ops/replay/{id}',
    tags: ['Events'],
    summary: 'Get replay session',
    description: 'Get status of a replay session.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Session UUID' }) }) },
    responses: {
      200: {
        description: 'Session status',
        content: { 'application/json': { schema: z.object({ data: ReplaySessionSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/event-ops/replay/{id}',
    tags: ['Events'],
    summary: 'Cancel replay session',
    description: 'Cancel a running replay session.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Session UUID' }) }) },
    responses: {
      200: { description: 'Cancelled', content: { 'application/json': { schema: SuccessSchema } } },
      400: { description: 'Not running', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/event-ops/scheduled',
    tags: ['Events'],
    summary: 'Run scheduled operations',
    description: 'Manually trigger scheduled operations.',
    responses: {
      200: {
        description: 'Result',
        content: { 'application/json': { schema: z.object({ data: ScheduledOpsResultSchema }) } },
      },
    },
  });
}
