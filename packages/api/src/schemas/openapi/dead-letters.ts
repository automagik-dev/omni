/**
 * OpenAPI schemas for dead letter endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, PaginationMetaSchema } from './common';

// Dead letter schema
export const DeadLetterSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Dead letter UUID' }),
  eventId: z.string().uuid().openapi({ description: 'Original event UUID' }),
  eventType: z.string().openapi({ description: 'Event type' }),
  status: z.enum(['pending', 'retrying', 'resolved', 'abandoned']).openapi({ description: 'Status' }),
  errorMessage: z.string().openapi({ description: 'Error message' }),
  errorStack: z.string().nullable().openapi({ description: 'Error stack trace' }),
  retryCount: z.number().int().openapi({ description: 'Retry attempts' }),
  lastRetryAt: z.string().datetime().nullable().openapi({ description: 'Last retry timestamp' }),
  resolvedAt: z.string().datetime().nullable().openapi({ description: 'Resolution timestamp' }),
  resolutionNote: z.string().nullable().openapi({ description: 'Resolution note' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
});

// Dead letter stats
export const DeadLetterStatsSchema = z.object({
  total: z.number().int().openapi({ description: 'Total count' }),
  pending: z.number().int().openapi({ description: 'Pending count' }),
  retrying: z.number().int().openapi({ description: 'Retrying count' }),
  resolved: z.number().int().openapi({ description: 'Resolved count' }),
  abandoned: z.number().int().openapi({ description: 'Abandoned count' }),
  byEventType: z.record(z.string(), z.number()).openapi({ description: 'Count by event type' }),
});

// Resolve request
export const ResolveDeadLetterSchema = z.object({
  note: z.string().min(1).max(500).openapi({ description: 'Resolution note' }),
});

export function registerDeadLetterSchemas(registry: OpenAPIRegistry): void {
  registry.register('DeadLetter', DeadLetterSchema);
  registry.register('DeadLetterStats', DeadLetterStatsSchema);
  registry.register('ResolveDeadLetterRequest', ResolveDeadLetterSchema);

  registry.registerPath({
    method: 'get',
    path: '/dead-letters',
    tags: ['Dead Letters'],
    summary: 'List dead letters',
    description: 'Get dead letters with filtering.',
    request: {
      query: z.object({
        status: z.string().optional().openapi({ description: 'Status filter (comma-separated)' }),
        eventType: z.string().optional().openapi({ description: 'Event type filter (comma-separated)' }),
        since: z.string().datetime().optional().openapi({ description: 'Start date' }),
        until: z.string().datetime().optional().openapi({ description: 'End date' }),
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
        cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
      }),
    },
    responses: {
      200: {
        description: 'List of dead letters',
        content: {
          'application/json': { schema: z.object({ items: z.array(DeadLetterSchema), meta: PaginationMetaSchema }) },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/dead-letters/stats',
    tags: ['Dead Letters'],
    summary: 'Get dead letter stats',
    description: 'Get statistics about dead letters.',
    responses: {
      200: {
        description: 'Statistics',
        content: { 'application/json': { schema: z.object({ data: DeadLetterStatsSchema }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/dead-letters/{id}',
    tags: ['Dead Letters'],
    summary: 'Get dead letter',
    description: 'Get details of a specific dead letter with payload.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Dead letter UUID' }) }) },
    responses: {
      200: {
        description: 'Dead letter details',
        content: { 'application/json': { schema: z.object({ data: DeadLetterSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/dead-letters/{id}/retry',
    tags: ['Dead Letters'],
    summary: 'Retry dead letter',
    description: 'Manually retry a dead letter.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Dead letter UUID' }) }) },
    responses: {
      200: {
        description: 'Retry result',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              deadLetterId: z.string().uuid().optional(),
              error: z.string().optional(),
            }),
          },
        },
      },
      400: { description: 'Retry failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/dead-letters/{id}/resolve',
    tags: ['Dead Letters'],
    summary: 'Resolve dead letter',
    description: 'Mark a dead letter as resolved with a note.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Dead letter UUID' }) }),
      body: { content: { 'application/json': { schema: ResolveDeadLetterSchema } } },
    },
    responses: {
      200: {
        description: 'Resolved',
        content: { 'application/json': { schema: z.object({ data: DeadLetterSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/dead-letters/{id}/abandon',
    tags: ['Dead Letters'],
    summary: 'Abandon dead letter',
    description: 'Give up on auto-retrying a dead letter.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Dead letter UUID' }) }) },
    responses: {
      200: {
        description: 'Abandoned',
        content: { 'application/json': { schema: z.object({ data: DeadLetterSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
