/**
 * OpenAPI schemas for event endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, PaginationMetaSchema } from './common';

// Event schema
export const EventSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Event UUID' }),
  eventType: z.string().openapi({ description: 'Event type' }),
  contentType: z.string().nullable().openapi({ description: 'Content type' }),
  instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
  personId: z.string().uuid().nullable().openapi({ description: 'Person UUID' }),
  direction: z.enum(['inbound', 'outbound']).openapi({ description: 'Message direction' }),
  textContent: z.string().nullable().openapi({ description: 'Text content' }),
  transcription: z.string().nullable().openapi({ description: 'Audio transcription' }),
  imageDescription: z.string().nullable().openapi({ description: 'Image description' }),
  receivedAt: z.string().datetime().openapi({ description: 'When event was received' }),
  processedAt: z.string().datetime().nullable().openapi({ description: 'When event was processed' }),
});

// Event summary schema
export const EventSummarySchema = z.object({
  id: z.string().uuid().openapi({ description: 'Event UUID' }),
  eventType: z.string().openapi({ description: 'Event type' }),
  contentType: z.string().nullable().openapi({ description: 'Content type' }),
  receivedAt: z.string().datetime().openapi({ description: 'When event was received' }),
  textPreview: z.string().nullable().openapi({ description: 'First 100 chars of text' }),
});

// Analytics schema
export const EventAnalyticsSchema = z.object({
  totalEvents: z.number().int().openapi({ description: 'Total event count' }),
  byEventType: z.record(z.string(), z.number()).openapi({ description: 'Count by event type' }),
  byChannel: z.record(z.string(), z.number()).openapi({ description: 'Count by channel' }),
  byDirection: z.object({
    inbound: z.number().int(),
    outbound: z.number().int(),
  }),
});

// Search body schema
export const EventSearchSchema = z.object({
  query: z.string().optional().openapi({ description: 'Full-text search query' }),
  filters: z
    .object({
      channel: z.array(z.string()).optional().openapi({ description: 'Channel types' }),
      instanceId: z.string().uuid().optional().openapi({ description: 'Instance UUID' }),
      personId: z.string().uuid().optional().openapi({ description: 'Person UUID' }),
      eventType: z.array(z.string()).optional().openapi({ description: 'Event types' }),
      contentType: z.array(z.string()).optional().openapi({ description: 'Content types' }),
      direction: z.enum(['inbound', 'outbound']).optional().openapi({ description: 'Direction' }),
      since: z.string().datetime().optional().openapi({ description: 'Start date' }),
      until: z.string().datetime().optional().openapi({ description: 'End date' }),
    })
    .optional(),
  format: z.enum(['full', 'summary', 'agent']).default('full').openapi({ description: 'Response format' }),
  limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
});

export function registerEventSchemas(registry: OpenAPIRegistry): void {
  registry.register('Event', EventSchema);
  registry.register('EventSummary', EventSummarySchema);
  registry.register('EventAnalytics', EventAnalyticsSchema);
  registry.register('EventSearch', EventSearchSchema);

  registry.registerPath({
    method: 'get',
    path: '/events',
    operationId: 'listEvents',
    tags: ['Events'],
    summary: 'List events',
    description: 'Get a paginated list of message events with optional filtering.',
    request: {
      query: z.object({
        channel: z.string().optional().openapi({ description: 'Channel types (comma-separated)' }),
        instanceId: z.string().uuid().optional().openapi({ description: 'Filter by instance' }),
        personId: z.string().uuid().optional().openapi({ description: 'Filter by person' }),
        eventType: z.string().optional().openapi({ description: 'Event types (comma-separated)' }),
        contentType: z.string().optional().openapi({ description: 'Content types (comma-separated)' }),
        direction: z.enum(['inbound', 'outbound']).optional().openapi({ description: 'Direction' }),
        since: z.string().datetime().optional().openapi({ description: 'Start date' }),
        until: z.string().datetime().optional().openapi({ description: 'End date' }),
        search: z.string().optional().openapi({ description: 'Full-text search' }),
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
        cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
      }),
    },
    responses: {
      200: {
        description: 'List of events',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(EventSchema),
              meta: PaginationMetaSchema.extend({ total: z.number().int().optional() }),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/analytics',
    operationId: 'getEventAnalytics',
    tags: ['Events'],
    summary: 'Get event analytics',
    description: 'Get analytics summary for events.',
    request: {
      query: z.object({
        since: z.string().datetime().optional().openapi({ description: 'Start date' }),
        until: z.string().datetime().optional().openapi({ description: 'End date' }),
        instanceId: z.string().uuid().optional().openapi({ description: 'Filter by instance' }),
        allTime: z.boolean().optional().openapi({ description: 'Include all time data' }),
      }),
    },
    responses: {
      200: { description: 'Analytics data', content: { 'application/json': { schema: EventAnalyticsSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/timeline/{personId}',
    operationId: 'getPersonTimeline',
    tags: ['Events'],
    summary: 'Get person timeline',
    description: 'Get cross-channel timeline for a person.',
    request: {
      params: z.object({ personId: z.string().uuid().openapi({ description: 'Person UUID' }) }),
      query: z.object({
        channels: z.string().optional().openapi({ description: 'Channel types (comma-separated)' }),
        since: z.string().datetime().optional().openapi({ description: 'Start date' }),
        until: z.string().datetime().optional().openapi({ description: 'End date' }),
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
        cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
      }),
    },
    responses: {
      200: {
        description: 'Timeline events',
        content: {
          'application/json': {
            schema: z.object({ personId: z.string().uuid(), items: z.array(EventSchema), meta: PaginationMetaSchema }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/events/search',
    operationId: 'searchEvents',
    tags: ['Events'],
    summary: 'Advanced event search',
    description: 'Search events with advanced filters and multiple output formats.',
    request: { body: { content: { 'application/json': { schema: EventSearchSchema } } } },
    responses: {
      200: {
        description: 'Search results',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(EventSchema),
              meta: PaginationMetaSchema,
              summary: z.string().optional(),
              asContext: z.string().optional(),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/{id}',
    operationId: 'getEvent',
    tags: ['Events'],
    summary: 'Get event by ID',
    description: 'Get details of a specific event.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Event UUID' }) }) },
    responses: {
      200: {
        description: 'Event details',
        content: { 'application/json': { schema: z.object({ data: EventSchema }) } },
      },
      404: { description: 'Event not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/by-sender/{senderId}',
    operationId: 'getEventsBySender',
    tags: ['Events'],
    summary: 'Get events by sender',
    description: 'Get events from a specific sender.',
    request: {
      params: z.object({ senderId: z.string().openapi({ description: 'Sender ID' }) }),
      query: z.object({
        instanceId: z.string().uuid().optional().openapi({ description: 'Filter by instance' }),
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
      }),
    },
    responses: {
      200: {
        description: 'Events from sender',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(EventSchema),
              meta: z.object({ total: z.number().int(), hasMore: z.boolean() }),
            }),
          },
        },
      },
    },
  });
}
