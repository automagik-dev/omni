/**
 * Agent routes - CRUD operations for agent routing configuration
 */

import { zValidator } from '@hono/zod-validator';
import { CreateAgentRouteSchema, ListAgentRoutesQuerySchema, UpdateAgentRouteSchema } from '@omni/core';
import { Hono } from 'hono';
import { requireInstanceAccess } from '../../middleware/auth';
import type { AppVariables } from '../../types';

const routesRoutes = new Hono<{ Variables: AppVariables }>();

// Instance access middleware for nested routes
const instanceAccess = requireInstanceAccess((c) => c.req.param('instanceId'));

/**
 * GET /instances/:instanceId/routes - List routes for an instance
 */
routesRoutes.get(
  '/instances/:instanceId/routes',
  instanceAccess,
  zValidator('query', ListAgentRoutesQuerySchema),
  async (c) => {
    const instanceId = c.req.param('instanceId');
    const query = c.req.valid('query');
    const services = c.get('services');

    const routes = await services.routes.list(instanceId, query);

    return c.json({ items: routes });
  },
);

/**
 * GET /instances/:instanceId/routes/:id - Get a specific route
 */
routesRoutes.get('/instances/:instanceId/routes/:id', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const route = await services.routes.getById(id);

  return c.json({ data: route });
});

/**
 * POST /instances/:instanceId/routes - Create a new route
 */
routesRoutes.post(
  '/instances/:instanceId/routes',
  instanceAccess,
  zValidator('json', CreateAgentRouteSchema),
  async (c) => {
    const instanceId = c.req.param('instanceId');
    const data = c.req.valid('json');
    const services = c.get('services');

    const route = await services.routes.create(instanceId, data);

    return c.json({ data: route }, 201);
  },
);

/**
 * PATCH /instances/:instanceId/routes/:id - Update a route
 */
routesRoutes.patch(
  '/instances/:instanceId/routes/:id',
  instanceAccess,
  zValidator('json', UpdateAgentRouteSchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    const services = c.get('services');

    const route = await services.routes.update(id, data);

    return c.json({ data: route });
  },
);

/**
 * DELETE /instances/:instanceId/routes/:id - Delete a route
 */
routesRoutes.delete('/instances/:instanceId/routes/:id', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  await services.routes.delete(id);

  return c.json({ success: true });
});

/**
 * GET /routes/metrics - Get cache metrics
 */
routesRoutes.get('/routes/metrics', async (c) => {
  const services = c.get('services');
  const metrics = services.routeResolver.getMetrics();

  return c.json({
    data: {
      cache: metrics,
      timestamp: new Date().toISOString(),
    },
  });
});

export { routesRoutes };
