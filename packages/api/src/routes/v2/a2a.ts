/**
 * A2A discovery routes.
 *
 * These authenticated registry endpoints complement the public well-known
 * Agent Card endpoint by exposing Omni's multi-agent catalog.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { listA2ADiscoverableAgents, resolveA2AAgentCard } from '../../services/a2a-discovery';
import type { AppVariables } from '../../types';

const a2aRoutes = new Hono<{ Variables: AppVariables }>();

const listQuerySchema = z.object({
  includeUnconfigured: z.coerce.boolean().optional().default(false),
});

const agentParamSchema = z.object({
  agentId: z.string().uuid(),
});

function baseUrlFromRequest(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

a2aRoutes.get('/agents', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const url = new URL(c.req.url);
  const items = await listA2ADiscoverableAgents({
    services: c.get('services'),
    baseUrl: baseUrlFromRequest(url),
    includeUnconfigured: query.includeUnconfigured,
  });

  return c.json({ items });
});

a2aRoutes.get('/agents/:agentId/card', zValidator('param', agentParamSchema), async (c) => {
  const { agentId } = c.req.valid('param');
  const url = new URL(c.req.url);
  const resolved = await resolveA2AAgentCard({
    services: c.get('services'),
    baseUrl: baseUrlFromRequest(url),
    agentId,
    extended: true,
  });

  if (!resolved) {
    return c.json({ error: { code: 'A2A_AGENT_NOT_CONFIGURED', message: 'Agent has no active A2A instance' } }, 404);
  }

  return c.json({ data: resolved.card });
});

export { a2aRoutes };
