/**
 * Journey tracing routes - Message journey instrumentation endpoints
 *
 * GET /api/v2/journeys/:correlationId - Get a specific journey
 * GET /api/v2/journeys/summary - Get aggregated journey metrics
 *
 * @see .wishes/message-journey-tracing/message-journey-tracing-wish.md (DEC-8)
 */

import { zValidator } from '@hono/zod-validator';
import { getJourneyTracker } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const journeysRoutes = new Hono<{ Variables: AppVariables }>();

// Summary query schema
const summaryQuerySchema = z.object({
  since: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      // Support ISO datetime or relative durations like "1h", "30m", "24h"
      const match = v.match(/^(\d+)(m|h|d)$/);
      if (match?.[1] && match[2]) {
        const amount = Number.parseInt(match[1], 10);
        const unit = match[2] as 'm' | 'h' | 'd';
        const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
        return Date.now() - amount * multipliers[unit];
      }
      // Try as ISO datetime
      const ts = new Date(v).getTime();
      return Number.isNaN(ts) ? undefined : ts;
    }),
});

/**
 * GET /journeys/summary - Aggregated journey metrics
 *
 * Must be registered BEFORE /:correlationId to avoid route collision.
 */
journeysRoutes.get('/summary', zValidator('query', summaryQuerySchema), (c) => {
  const { since } = c.req.valid('query');
  const tracker = getJourneyTracker();
  const summary = tracker.getSummary({ since });
  return c.json(summary);
});

/**
 * GET /journeys/:correlationId - Specific journey timeline
 */
journeysRoutes.get('/:correlationId', (c) => {
  const correlationId = c.req.param('correlationId');
  const tracker = getJourneyTracker();
  const journey = tracker.getJourney(correlationId);

  if (!journey) {
    return c.json(
      {
        error: {
          code: 'JOURNEY_NOT_FOUND',
          message: `No journey found for correlation ID: ${correlationId}`,
        },
      },
      404,
    );
  }

  return c.json(journey);
});

export { journeysRoutes };
