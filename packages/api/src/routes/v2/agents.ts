/**
 * Agents routes - First-class agent entity management
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const agentsRoutes = new Hono<{ Variables: AppVariables }>();

// List query schema
const listQuerySchema = z.object({
  ownerId: z.string().uuid().optional(),
  provider: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50).optional(),
});

// Create/update agent schema
const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  provider: z.enum(['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal']),
  model: z.string().max(120).optional(),
  agentType: z.enum(['assistant', 'workflow', 'team', 'tool']).default('assistant'),
  capabilities: z.array(z.string()).default([]),
  ownerId: z.string().uuid().optional(),
  agentProviderId: z.string().uuid().optional(),
  configPath: z.string().optional(),
  isInternal: z.boolean().default(false),
  isActive: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateAgentSchema = createAgentSchema.partial();

/**
 * GET /agents - List agents
 */
agentsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { ownerId, provider, isActive, limit } = c.req.valid('query');
  const services = c.get('services');

  const items = await services.agents.list({ ownerId, provider, isActive, limit });

  return c.json({ items });
});

/**
 * GET /agents/:id - Get agent by ID
 */
agentsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const agent = await services.agents.getById(id);

  return c.json({ data: agent });
});

/**
 * POST /agents - Create agent
 */
agentsRoutes.post('/', zValidator('json', createAgentSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const agent = await services.agents.create(data);

  return c.json({ data: agent }, 201);
});

/**
 * PATCH /agents/:id - Update agent
 */
agentsRoutes.patch('/:id', zValidator('json', updateAgentSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const agent = await services.agents.update(id, data);

  return c.json({ data: agent });
});

/**
 * DELETE /agents/:id - Soft-delete agent (sets isActive = false)
 */
agentsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  await services.agents.delete(id);

  return c.json({ success: true });
});

export { agentsRoutes };
