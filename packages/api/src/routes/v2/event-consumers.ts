/**
 * Durable event consumer routes (#989, RFC #925 G7).
 *
 * Register / list / inspect / delete named consumers over the event journal,
 * plus the delivery surface: `pull` (page from the stored cursor, optional
 * long-poll) and `ack` (advance the cursor, monotonic). Backs
 * `omni events consumers ...` and `omni events follow --consumer <name>`.
 *
 * Mounted at root BEFORE `/events` (see routes/v2/index.ts): eventsRoutes
 * carries a `/:id` catch-all that would otherwise swallow `/events/consumers`
 * — same invariant as eventSchemasRoutes (#959).
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  AckConsumerSchema,
  CreateConsumerSchema,
  PullConsumerQuerySchema,
} from '../../schemas/openapi/event-consumers';
import type { AppVariables } from '../../types';

const eventConsumersRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * GET /events/consumers - List durable consumers (with live lag)
 */
eventConsumersRoutes.get('/events/consumers', async (c) => {
  const services = c.get('services');
  const items = await services.eventConsumers.list();
  return c.json({ items });
});

/**
 * POST /events/consumers - Register a durable consumer
 */
eventConsumersRoutes.post('/events/consumers', zValidator('json', CreateConsumerSchema), async (c) => {
  const input = c.req.valid('json');
  const services = c.get('services');
  const data = await services.eventConsumers.create(input);
  return c.json({ data }, 201);
});

/**
 * GET /events/consumers/:name - Inspect one consumer (filter + cursor + lag)
 */
eventConsumersRoutes.get('/events/consumers/:name', async (c) => {
  const name = c.req.param('name');
  const services = c.get('services');
  const data = await services.eventConsumers.inspect(name);
  return c.json({ data });
});

/**
 * DELETE /events/consumers/:name - Remove a consumer registration
 */
eventConsumersRoutes.delete('/events/consumers/:name', async (c) => {
  const name = c.req.param('name');
  const services = c.get('services');
  await services.eventConsumers.delete(name);
  return c.json({ success: true });
});

/**
 * POST /events/consumers/:name/pull - Page events from the stored cursor
 *
 * Read-only w.r.t. the cursor (ack commits progress), but POST: a pull with
 * waitMs long-polls server-side, and the paging contract ("strictly after the
 * stored cursor") is consumer state, not a cacheable resource read.
 */
eventConsumersRoutes.post('/events/consumers/:name/pull', zValidator('query', PullConsumerQuerySchema), async (c) => {
  const name = c.req.param('name');
  const { limit, waitMs } = c.req.valid('query');
  const services = c.get('services');
  const result = await services.eventConsumers.pull(name, { limit, waitMs });
  return c.json(result);
});

/**
 * POST /events/consumers/:name/ack - Advance the cursor (monotonic)
 */
eventConsumersRoutes.post('/events/consumers/:name/ack', zValidator('json', AckConsumerSchema), async (c) => {
  const name = c.req.param('name');
  const { cursor } = c.req.valid('json');
  const services = c.get('services');
  const data = await services.eventConsumers.ack(name, cursor);
  return c.json({ data });
});

export { eventConsumersRoutes };
