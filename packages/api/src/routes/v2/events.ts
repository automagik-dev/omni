/**
 * Events routes - Query message events/traces
 */

import { zValidator } from '@hono/zod-validator';
import { ChannelTypeSchema, ContentTypeSchema, EventTypeSchema } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const eventsRoutes = new Hono<{ Variables: AppVariables }>();

// List events query schema
const listQuerySchema = z.object({
  channel: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof ChannelTypeSchema>[] | undefined),
  instanceId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  eventType: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof EventTypeSchema>[] | undefined),
  contentType: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof ContentTypeSchema>[] | undefined),
  direction: z.enum(['inbound', 'outbound']).optional(),
  since: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  until: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// Search events body schema
const searchBodySchema = z.object({
  query: z.string().optional(),
  filters: z
    .object({
      channel: z.array(ChannelTypeSchema).optional(),
      instanceId: z.string().uuid().optional(),
      personId: z.string().uuid().optional(),
      eventType: z.array(EventTypeSchema).optional(),
      contentType: z.array(ContentTypeSchema).optional(),
      direction: z.enum(['inbound', 'outbound']).optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
    })
    .optional(),
  format: z.enum(['full', 'summary', 'agent']).default('full'),
  limit: z.number().int().min(1).max(100).default(50),
});

// Analytics query schema
const analyticsQuerySchema = z.object({
  since: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  until: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  instanceId: z.string().uuid().optional(),
  allTime: z.coerce.boolean().optional(),
});

// Timeline query schema
const timelineQuerySchema = z.object({
  channels: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof ChannelTypeSchema>[] | undefined),
  since: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  until: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

/**
 * GET /events - List events
 */
eventsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const services = c.get('services');

  const result = await services.events.list(query);

  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
      total: result.total,
    },
  });
});

/**
 * GET /events/analytics - Get analytics summary
 */
eventsRoutes.get('/analytics', zValidator('query', analyticsQuerySchema), async (c) => {
  const { since, until, instanceId, allTime } = c.req.valid('query');
  const services = c.get('services');

  // Default to last 24 hours if no date filter and not allTime
  const effectiveSince = allTime ? undefined : (since ?? new Date(Date.now() - 24 * 60 * 60 * 1000));
  const effectiveUntil = allTime ? undefined : until;

  const analytics = await services.events.getAnalytics({
    since: effectiveSince,
    until: effectiveUntil,
    instanceId,
  });

  return c.json(analytics);
});

/**
 * GET /events/timeline/:personId - Get timeline for a person
 */
eventsRoutes.get('/timeline/:personId', zValidator('query', timelineQuerySchema), async (c) => {
  const personId = c.req.param('personId');
  const query = c.req.valid('query');
  const services = c.get('services');

  const result = await services.events.getTimeline(personId, {
    channels: query.channels,
    since: query.since,
    until: query.until,
    limit: query.limit,
    cursor: query.cursor,
  });

  return c.json({
    personId,
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * POST /events/search - Advanced event search
 */
eventsRoutes.post('/search', zValidator('json', searchBodySchema), async (c) => {
  const { query, filters, format, limit } = c.req.valid('json');
  const services = c.get('services');

  const result = await services.events.list({
    channel: filters?.channel,
    instanceId: filters?.instanceId,
    personId: filters?.personId,
    eventType: filters?.eventType,
    contentType: filters?.contentType,
    direction: filters?.direction,
    since: filters?.since ? new Date(filters.since) : undefined,
    until: filters?.until ? new Date(filters.until) : undefined,
    search: query,
    limit,
  });

  // Transform based on format
  if (format === 'summary') {
    return c.json({
      items: result.items.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        contentType: e.contentType,
        receivedAt: e.receivedAt,
        textPreview: e.textContent?.substring(0, 100),
      })),
      meta: { hasMore: result.hasMore, cursor: result.cursor },
    });
  }

  if (format === 'agent') {
    // LLM-friendly format
    const asContext = result.items
      .map((e) => {
        const content = e.textContent ?? e.transcription ?? e.imageDescription ?? '[media]';
        return `[${e.receivedAt.toISOString()}] ${e.direction}: ${content}`;
      })
      .join('\n');

    return c.json({
      items: result.items,
      summary: `Found ${result.items.length} events`,
      asContext,
      meta: { hasMore: result.hasMore, cursor: result.cursor },
    });
  }

  return c.json({
    items: result.items,
    meta: { hasMore: result.hasMore, cursor: result.cursor },
  });
});

/**
 * GET /events/:id - Get event by ID
 */
eventsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const event = await services.events.getById(id);

  return c.json({ data: event });
});

/**
 * GET /events/by-sender/:senderId - Get events by sender
 */
eventsRoutes.get('/by-sender/:senderId', async (c) => {
  const senderId = c.req.param('senderId');
  const instanceId = c.req.query('instanceId');
  const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const services = c.get('services');

  // Search by sender in textContent/platform user id
  const result = await services.events.list({
    instanceId,
    search: senderId,
    limit,
  });

  return c.json({
    items: result.items,
    meta: {
      total: result.items.length,
      hasMore: result.hasMore,
    },
  });
});

export { eventsRoutes };
