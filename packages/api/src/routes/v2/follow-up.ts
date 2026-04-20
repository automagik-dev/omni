/**
 * Follow-up config routes
 *
 * GET/PUT/DELETE `followUpConfig` at three scopes:
 *   - /follow-up/agents/:id
 *   - /follow-up/instances/:id
 *   - /follow-up/chats/:id
 *
 * Each level stores the same `FollowUpSequenceConfig` shape. The resolver in
 * `packages/core/src/automations/follow-up/resolve-config.ts` picks the
 * closest-defined config at runtime (chat → instance → agent → off).
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { zValidator } from '@hono/zod-validator';
import { FollowUpSequenceConfigSchema } from '@omni/core';
import type { ChatSettings } from '@omni/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const followUpRoutes = new Hono<{ Variables: AppVariables }>();

const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * GET /follow-up/agents/:id — read the follow-up config stored at the agent scope.
 */
followUpRoutes.get('/agents/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');
  const agent = await services.agents.getById(id);
  return c.json({ data: agent.followUpConfig ?? null });
});

/**
 * PUT /follow-up/agents/:id — replace the follow-up config at the agent scope.
 */
followUpRoutes.put(
  '/agents/:id',
  zValidator('param', idParamSchema),
  zValidator('json', FollowUpSequenceConfigSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const config = c.req.valid('json');
    const services = c.get('services');
    const agent = await services.agents.update(id, { followUpConfig: config });
    return c.json({ data: agent.followUpConfig ?? null });
  },
);

/**
 * DELETE /follow-up/agents/:id — clear the override so broader scopes apply.
 */
followUpRoutes.delete('/agents/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');
  await services.agents.update(id, { followUpConfig: null });
  return c.json({ success: true });
});

/**
 * GET /follow-up/instances/:id
 */
followUpRoutes.get('/instances/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');
  const instance = await services.instances.getById(id);
  return c.json({ data: instance.followUpConfig ?? null });
});

/**
 * PUT /follow-up/instances/:id
 */
followUpRoutes.put(
  '/instances/:id',
  zValidator('param', idParamSchema),
  zValidator('json', FollowUpSequenceConfigSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const config = c.req.valid('json');
    const services = c.get('services');
    const instance = await services.instances.update(id, { followUpConfig: config });
    return c.json({ data: instance.followUpConfig ?? null });
  },
);

/**
 * DELETE /follow-up/instances/:id
 */
followUpRoutes.delete('/instances/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');
  await services.instances.update(id, { followUpConfig: null });
  return c.json({ success: true });
});

/**
 * GET /follow-up/chats/:id — read from `chats.settings.followUpConfig`.
 */
followUpRoutes.get('/chats/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');
  const chat = await services.chats.getById(id);
  const settings = (chat.settings ?? {}) as ChatSettings;
  return c.json({ data: settings.followUpConfig ?? null });
});

/**
 * PUT /follow-up/chats/:id — merges `followUpConfig` into `chats.settings` without
 * clobbering unrelated keys (agentPaused, muted, etc.).
 */
followUpRoutes.put(
  '/chats/:id',
  zValidator('param', idParamSchema),
  zValidator('json', FollowUpSequenceConfigSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const config = c.req.valid('json');
    const services = c.get('services');

    const chat = await services.chats.getById(id);
    const current = (chat.settings ?? {}) as ChatSettings;
    const nextSettings: ChatSettings = { ...current, followUpConfig: config };

    const updated = await services.chats.update(id, { settings: nextSettings });
    const updatedSettings = (updated.settings ?? {}) as ChatSettings;
    return c.json({ data: updatedSettings.followUpConfig ?? null });
  },
);

/**
 * DELETE /follow-up/chats/:id — drops only `followUpConfig` from settings.
 */
followUpRoutes.delete('/chats/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');

  const chat = await services.chats.getById(id);
  const current = (chat.settings ?? {}) as ChatSettings;
  if (!('followUpConfig' in current)) {
    return c.json({ success: true });
  }
  const { followUpConfig: _removed, ...rest } = current;
  await services.chats.update(id, { settings: rest as ChatSettings });
  return c.json({ success: true });
});

export { followUpRoutes };
