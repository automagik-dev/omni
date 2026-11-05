/**
 * Connector routes.
 *
 * A connector is a tenant-owned integration account, never a channel. These
 * routes are mounted at `/api/v2/connectors` ABOVE the root `/:id` catch-all
 * (the registration-order invariant in routes/v2/index.ts, issue #496), and the
 * static `/providers` paths are registered before `/:id`.
 *
 * Instance-restricted API keys are refused: a tenant-wide credential cannot be
 * narrowed to an instance, so silently widening such a key would be a privilege
 * escalation (D12).
 */

import { type Hook, zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Env } from 'hono';
import { z } from 'zod';
import {
  ConnectorListQuerySchema,
  CreateConnectorBodySchema,
  CreateSubscriptionBodySchema,
  InvokeActionBodySchema,
  TestDeliveryBodySchema,
  UpdateConnectorBodySchema,
  UpdateSubscriptionBodySchema,
} from '../../schemas/connectors';
import type { AppVariables } from '../../types';

const connectorRoutes = new Hono<{ Variables: AppVariables }>();

const UUID = z.string().uuid();

const validationHook: Hook<unknown, Env, string> = (result, c) => {
  if (result.success) return;
  const message = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
  return c.json({ error: { code: 'VALIDATION_ERROR', message, issues: result.error.issues } }, 400);
};

/**
 * Connectors are tenant-wide credentials. An instance-scoped key has no
 * instance to be scoped to here, and widening it silently would be escalation.
 */
connectorRoutes.use('*', async (c, next) => {
  const apiKey = c.get('apiKey');
  if (apiKey?.instanceIds && apiKey.instanceIds.length > 0) {
    return c.json(
      {
        error: {
          code: 'CONNECTORS_TENANT_SCOPED',
          message: 'Connectors are tenant-wide and cannot be accessed with an instance-restricted API key',
        },
      },
      403,
    );
  }
  return next();
});

/** GET /connectors/providers — the manifest catalog (static path before /:id). */
connectorRoutes.get('/providers', (c) => {
  return c.json({ data: c.get('services').connectors.listProviders() });
});

/** GET /connectors/providers/:provider — events, actions (JSON Schema) and guide copy. */
connectorRoutes.get('/providers/:provider', (c) => {
  return c.json({ data: c.get('services').connectors.getProvider(c.req.param('provider')) });
});

/** GET /connectors */
connectorRoutes.get('/', zValidator('query', ConnectorListQuerySchema, validationHook), async (c) => {
  const query = c.req.valid('query');
  const result = await c.get('services').connectors.list(query);
  return c.json({ data: result.items, meta: { hasMore: result.hasMore, cursor: result.cursor ?? null } });
});

/** POST /connectors */
connectorRoutes.post('/', zValidator('json', CreateConnectorBodySchema, validationHook), async (c) => {
  const body = c.req.valid('json');
  const apiKey = c.get('apiKey');
  const actor = c.req.header('x-omni-actor') ?? apiKey?.name ?? null;
  const connector = await c.get('services').connectors.create(body, actor);
  return c.json({ data: connector }, 201);
});

/** GET /connectors/:id */
connectorRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
  }
  return c.json({ data: await c.get('services').connectors.getById(id) });
});

/** PATCH /connectors/:id */
connectorRoutes.patch('/:id', zValidator('json', UpdateConnectorBodySchema, validationHook), async (c) => {
  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
  }
  return c.json({ data: await c.get('services').connectors.update(id, c.req.valid('json')) });
});

/** DELETE /connectors/:id */
connectorRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!z.string().uuid().safeParse(id).success) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
  }
  await c.get('services').connectors.delete(id);
  return c.json({ success: true });
});

/** POST /connectors/:id/subscriptions */
connectorRoutes.post(
  '/:id/subscriptions',
  zValidator('json', CreateSubscriptionBodySchema, validationHook),
  async (c) => {
    const connectorId = c.req.param('id');
    if (!z.string().uuid().safeParse(connectorId).success) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
    }
    const subscription = await c.get('services').connectors.createSubscription(connectorId, c.req.valid('json'));
    return c.json({ data: subscription }, 201);
  },
);

/** GET /connectors/:id/subscriptions */
connectorRoutes.get('/:id/subscriptions', async (c) => {
  const connectorId = c.req.param('id');
  if (!z.string().uuid().safeParse(connectorId).success) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
  }
  return c.json({ data: await c.get('services').connectors.listSubscriptions(connectorId) });
});

/** PATCH /connectors/:id/subscriptions/:subscriptionId */
connectorRoutes.patch(
  '/:id/subscriptions/:subscriptionId',
  zValidator('json', UpdateSubscriptionBodySchema, validationHook),
  async (c) => {
    if (!UUID.safeParse(c.req.param('id')).success) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
    }
    if (!UUID.safeParse(c.req.param('subscriptionId')).success) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'ConnectorEventSubscription not found' } }, 404);
    }
    const subscription = await c
      .get('services')
      .connectors.updateSubscription(c.req.param('id'), c.req.param('subscriptionId'), c.req.valid('json'));
    return c.json({ data: subscription });
  },
);

/** DELETE /connectors/:id/subscriptions/:subscriptionId */
connectorRoutes.delete('/:id/subscriptions/:subscriptionId', async (c) => {
  if (!UUID.safeParse(c.req.param('id')).success) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
  }
  if (!UUID.safeParse(c.req.param('subscriptionId')).success) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'ConnectorEventSubscription not found' } }, 404);
  }
  await c.get('services').connectors.deleteSubscription(c.req.param('id'), c.req.param('subscriptionId'));
  return c.json({ success: true });
});

/** POST /connectors/:id/subscriptions/:subscriptionId/test — a real delivery, signature bypassed. */
connectorRoutes.post(
  '/:id/subscriptions/:subscriptionId/test',
  zValidator('json', TestDeliveryBodySchema, validationHook),
  async (c) => {
    if (!UUID.safeParse(c.req.param('id')).success) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
    }
    if (!UUID.safeParse(c.req.param('subscriptionId')).success) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'ConnectorEventSubscription not found' } }, 404);
    }
    const result = await c
      .get('services')
      .connectors.testSubscription(c.req.param('id'), c.req.param('subscriptionId'), c.req.valid('json').payload);
    return c.json(result);
  },
);

/** POST /connectors/:id/actions/:action — typed provider action. */
connectorRoutes.post('/:id/actions/:action', zValidator('json', InvokeActionBodySchema, validationHook), async (c) => {
  if (!UUID.safeParse(c.req.param('id')).success) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Connector not found' } }, 404);
  }
  const data = await c
    .get('services')
    .connectors.invoke(c.req.param('id'), c.req.param('action'), c.req.valid('json').input);
  return c.json({ data });
});

export { connectorRoutes };
