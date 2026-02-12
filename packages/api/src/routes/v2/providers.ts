/**
 * Providers routes - Agent provider management
 */

import { zValidator } from '@hono/zod-validator';
import { ProviderSchemaEnum, createAgnoClient } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const providersRoutes = new Hono<{ Variables: AppVariables }>();

// List query schema
const listQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
});

// Create provider schema
const createProviderSchema = z.object({
  name: z.string().min(1).max(255).describe('Unique provider name'),
  schema: ProviderSchemaEnum.default('agno').describe('Provider schema type'),
  baseUrl: z.string().url().describe('Base URL for provider API'),
  apiKey: z.string().optional().describe('API key (stored encrypted)'),
  schemaConfig: z.record(z.string(), z.unknown()).optional().describe('Schema-specific configuration'),
  defaultStream: z.boolean().default(true).describe('Default streaming setting'),
  defaultTimeout: z.number().int().positive().default(60).describe('Default timeout in seconds'),
  supportsStreaming: z.boolean().default(true).describe('Provider supports streaming'),
  supportsImages: z.boolean().default(false).describe('Provider supports image inputs'),
  supportsAudio: z.boolean().default(false).describe('Provider supports audio inputs'),
  supportsDocuments: z.boolean().default(false).describe('Provider supports document inputs'),
  description: z.string().optional().describe('Provider description'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
});

// Update provider schema
const updateProviderSchema = createProviderSchema.partial();

/**
 * GET /providers - List all providers
 */
providersRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { active } = c.req.valid('query');
  const services = c.get('services');

  const providers = await services.providers.list({ active });

  // Mask API keys
  const items = providers.map((p) => ({
    ...p,
    apiKey: p.apiKey ? '********' : null,
  }));

  return c.json({ items });
});

/**
 * GET /providers/:id - Get provider by ID
 */
providersRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const provider = await services.providers.getById(id);

  return c.json({
    data: {
      ...provider,
      apiKey: provider.apiKey ? '********' : null,
    },
  });
});

/**
 * POST /providers - Create provider
 */
providersRoutes.post('/', zValidator('json', createProviderSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const provider = await services.providers.create(data);

  return c.json(
    {
      data: {
        ...provider,
        apiKey: provider.apiKey ? '********' : null,
      },
    },
    201,
  );
});

/**
 * PATCH /providers/:id - Update provider
 */
providersRoutes.patch('/:id', zValidator('json', updateProviderSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const provider = await services.providers.update(id, data);

  return c.json({
    data: {
      ...provider,
      apiKey: provider.apiKey ? '********' : null,
    },
  });
});

/**
 * DELETE /providers/:id - Delete provider
 */
providersRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  await services.providers.delete(id);

  return c.json({ success: true });
});

/**
 * POST /providers/:id/health - Health check provider
 */
providersRoutes.post('/:id/health', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const result = await services.providers.checkHealth(id);

  return c.json({
    healthy: result.healthy,
    latency: result.latency,
    error: result.error,
  });
});

/**
 * GET /providers/:id/agents - List agents from provider (AgnoOS only)
 */
providersRoutes.get('/:id/agents', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const provider = await services.providers.getById(id);

  if (provider.schema !== 'agno') {
    return c.json({ items: [], message: 'Agent listing only supported for Agno providers' });
  }

  if (!provider.apiKey) {
    return c.json({ error: 'Provider has no API key configured' }, 400);
  }

  const client = createAgnoClient({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
  });

  const agents = await client.listAgents();

  return c.json({ items: agents });
});

/**
 * GET /providers/:id/teams - List teams from provider (AgnoOS only)
 */
providersRoutes.get('/:id/teams', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const provider = await services.providers.getById(id);

  if (provider.schema !== 'agno') {
    return c.json({ items: [], message: 'Team listing only supported for Agno providers' });
  }

  if (!provider.apiKey) {
    return c.json({ error: 'Provider has no API key configured' }, 400);
  }

  const client = createAgnoClient({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
  });

  const teams = await client.listTeams();

  return c.json({ items: teams });
});

/**
 * GET /providers/:id/workflows - List workflows from provider (AgnoOS only)
 */
providersRoutes.get('/:id/workflows', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const provider = await services.providers.getById(id);

  if (provider.schema !== 'agno') {
    return c.json({ items: [], message: 'Workflow listing only supported for Agno providers' });
  }

  if (!provider.apiKey) {
    return c.json({ error: 'Provider has no API key configured' }, 400);
  }

  const client = createAgnoClient({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
  });

  const workflows = await client.listWorkflows();

  return c.json({ items: workflows });
});

export { providersRoutes };
