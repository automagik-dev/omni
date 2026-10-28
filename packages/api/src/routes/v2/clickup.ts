/**
 * ClickUp action routes (issue #1413).
 *
 *   POST /instances/:id/clickup/actions — run one ClickUp task action
 *
 * ClickUp is a non-messaging channel: this route is its entire runtime surface
 * (task create/update/comment/list). It is auth-required and instance-scoped
 * like every other v2 instance route.
 *
 * The plugin is resolved from the registry and used through a structural
 * `ClickUpActionRunner` type, never the class. The schema comes from the
 * package's `/types` subpath for the same reason: importing the package entry
 * would self-register the plugin before the loader runs and short-circuit
 * filesystem discovery of every other channel (the channel-harness precedent).
 * Error classes are therefore recognised by name, not by a runtime import.
 */

import { zValidator } from '@hono/zod-validator';
import type { ClickUpActionRequest, ClickUpActionRunner } from '@omni/channel-clickup';
import { ClickUpActionRequestSchema } from '@omni/channel-clickup/types';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { requireInstanceAccess } from '../../middleware/auth';
import type { AppVariables } from '../../types';

export const clickupRoutes = new Hono<{ Variables: AppVariables }>();

const instanceAccess = requireInstanceAccess((c) => c.req.param('id') ?? '');

const NOT_CLICKUP = (id: string, channel: string) =>
  `Instance ${id} is a ${channel} instance; ClickUp actions need a clickup instance`;

/**
 * POST /instances/:id/clickup/actions - Run a ClickUp action
 *
 * Body: a `ClickUpActionRequest` discriminated on `operation`. Responses are
 * normalized (`{ data: task | comment | { tasks } }`), never raw ClickUp JSON,
 * and never carry the personal API token.
 */
clickupRoutes.post(
  '/:id/clickup/actions',
  instanceAccess,
  zValidator('json', ClickUpActionRequestSchema),
  async (c) => {
    const id = c.req.param('id') ?? '';
    const services = c.get('services');

    let instance: Awaited<ReturnType<typeof services.instances.getById>>;
    try {
      instance = await services.instances.getById(id);
    } catch (error) {
      // getById throws NotFoundError; the route's contract is an explicit 404.
      if (error instanceof NotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: `Instance not found: ${id}` } }, 404);
      }
      throw error;
    }

    if (instance.channel !== 'clickup') {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: NOT_CLICKUP(id, instance.channel) } }, 400);
    }

    const plugin = c.get('channelRegistry')?.get('clickup');
    if (!plugin) {
      return c.json(
        { error: { code: 'CLICKUP_PLUGIN_UNAVAILABLE', message: 'ClickUp plugin is not registered' } },
        503,
      );
    }

    try {
      const runner = plugin as unknown as ClickUpActionRunner;
      const result = await runner.execute(id, c.req.valid('json') as ClickUpActionRequest);
      return c.json({ data: result });
    } catch (error) {
      if (error instanceof Error && error.name === 'ClickUpApiError') {
        return c.json({ error: { code: 'CLICKUP_API_ERROR', message: error.message } }, 502);
      }
      if (error instanceof Error && error.name === 'ClickUpError') {
        return c.json({ error: { code: 'CLICKUP_ACTION_FAILED', message: error.message } }, 400);
      }
      throw error;
    }
  },
);
