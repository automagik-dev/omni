/**
 * Event schema registry routes (issue #959, RFC #925 G1).
 *
 * CRUD-lite over `event_schemas`: register (POST), list, get. Registered
 * types are validated at the publish gates (webhook ingress, automation
 * emit_event); unregistered types pass through — the registry is opt-in per
 * type. The evolution rule is enforced by the service: an incompatible
 * replacement is refused with 409.
 *
 * Mounted at root BEFORE `/events` (see routes/v2/index.ts): eventsRoutes
 * carries a `/:id` catch-all that would otherwise swallow `/events/schemas`.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { RegisterEventSchemaSchema } from '../../schemas/openapi/event-schemas';
import type { AppVariables } from '../../types';

const eventSchemasRoutes = new Hono<{ Variables: AppVariables }>();

const listQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
});

/**
 * GET /events/schemas - List registered event schemas
 */
eventSchemasRoutes.get('/events/schemas', zValidator('query', listQuerySchema), async (c) => {
  const { enabled } = c.req.valid('query');
  const services = c.get('services');

  const items = await services.eventSchemas.list({ enabled });

  return c.json({ items });
});

/**
 * GET /events/schemas/:eventType - Get one registered event schema
 */
eventSchemasRoutes.get('/events/schemas/:eventType', async (c) => {
  const eventType = c.req.param('eventType');
  const services = c.get('services');

  const data = await services.eventSchemas.getByTypeOrThrow(eventType);

  return c.json({ data });
});

/**
 * POST /events/schemas - Register or (compatibly) revise an event schema
 */
eventSchemasRoutes.post('/events/schemas', zValidator('json', RegisterEventSchemaSchema), async (c) => {
  const input = c.req.valid('json');
  const services = c.get('services');

  const data = await services.eventSchemas.register(input);

  return c.json({ data }, 201);
});

export { eventSchemasRoutes };
