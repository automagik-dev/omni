/**
 * Event Operations API routes
 *
 * Endpoints for event replay, metrics, and scheduled operations.
 *
 * @see events-ops wish
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const eventOpsRoutes = new Hono<{ Variables: AppVariables }>();

// Replay options schema
const replayOptionsSchema = z.object({
  since: z
    .string()
    .datetime()
    .transform((v) => new Date(v)),
  until: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  eventTypes: z.array(z.string()).optional(),
  instanceId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(100000).optional(),
  speedMultiplier: z.number().min(0).max(100).optional(),
  skipProcessed: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

/**
 * GET /event-ops/metrics - Get event metrics
 */
eventOpsRoutes.get('/metrics', async (c) => {
  const services = c.get('services');
  const metrics = await services.eventOps.getMetrics();

  return c.json({ data: metrics });
});

/**
 * POST /event-ops/replay - Start a replay session
 */
eventOpsRoutes.post('/replay', zValidator('json', replayOptionsSchema), async (c) => {
  const options = c.req.valid('json');
  const services = c.get('services');

  try {
    const session = await services.eventOps.startReplay(options);
    return c.json({ data: session }, 202);
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }
});

/**
 * GET /event-ops/replay - List replay sessions
 */
eventOpsRoutes.get('/replay', async (c) => {
  const services = c.get('services');
  const sessions = services.eventOps.listReplaySessions();

  return c.json({ items: sessions });
});

/**
 * GET /event-ops/replay/:id - Get replay session status
 */
eventOpsRoutes.get('/replay/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const session = services.eventOps.getReplaySession(id);
  if (!session) {
    return c.json({ error: 'Replay session not found' }, 404);
  }

  return c.json({ data: session });
});

/**
 * DELETE /event-ops/replay/:id - Cancel a replay session
 */
eventOpsRoutes.delete('/replay/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const cancelled = services.eventOps.cancelReplay(id);
  if (!cancelled) {
    return c.json({ error: 'Replay session not found or not running' }, 400);
  }

  return c.json({ success: true });
});

/**
 * POST /event-ops/scheduled - Trigger scheduled operations manually
 */
eventOpsRoutes.post('/scheduled', async (c) => {
  const services = c.get('services');

  const result = await services.eventOps.runScheduledOps();

  return c.json({ data: result });
});

export { eventOpsRoutes };
