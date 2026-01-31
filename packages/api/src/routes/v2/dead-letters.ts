/**
 * Dead Letters API routes
 *
 * Endpoints for managing failed events in the dead letter queue.
 *
 * @see events-ops wish
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const deadLettersRoutes = new Hono<{ Variables: AppVariables }>();

// List query schema
const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as ('pending' | 'retrying' | 'resolved' | 'abandoned')[] | undefined),
  eventType: z
    .string()
    .optional()
    .transform((v) => v?.split(',') ?? undefined),
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

// Resolve body schema
const resolveBodySchema = z.object({
  note: z.string().min(1).max(500),
});

/**
 * GET /dead-letters - List dead letters with filtering
 */
deadLettersRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const services = c.get('services');

  const result = await services.deadLetters.list(query);

  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * GET /dead-letters/stats - Get dead letter statistics
 */
deadLettersRoutes.get('/stats', async (c) => {
  const services = c.get('services');

  const stats = await services.deadLetters.getStats();

  return c.json({ data: stats });
});

/**
 * GET /dead-letters/:id - Get single dead letter with payload
 */
deadLettersRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const deadLetter = await services.deadLetters.getById(id);

  return c.json({ data: deadLetter });
});

/**
 * POST /dead-letters/:id/retry - Manual retry
 */
deadLettersRoutes.post('/:id/retry', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const result = await services.deadLetters.retry(id);

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }

  return c.json({ success: true, deadLetterId: result.deadLetterId });
});

/**
 * POST /dead-letters/:id/resolve - Mark as resolved with note
 */
deadLettersRoutes.post('/:id/resolve', zValidator('json', resolveBodySchema), async (c) => {
  const id = c.req.param('id');
  const { note } = c.req.valid('json');
  const services = c.get('services');

  const deadLetter = await services.deadLetters.resolve(id, note);

  return c.json({ data: deadLetter });
});

/**
 * POST /dead-letters/:id/abandon - Give up on auto-retry
 */
deadLettersRoutes.post('/:id/abandon', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const deadLetter = await services.deadLetters.abandon(id);

  return c.json({ data: deadLetter });
});

export { deadLettersRoutes };
