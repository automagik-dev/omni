/**
 * API Key Management Routes
 *
 * CRUD operations for API keys with scope-based authorization.
 * Keys are used to authenticate agents and services with specific permissions.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireScope } from '../../middleware/auth';
import type { AppVariables } from '../../types';

export const keysRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// SCHEMAS
// ============================================================================

const createKeySchema = z.object({
  name: z.string().min(1).max(255).describe('Human-readable key name'),
  description: z.string().optional().describe('Key description'),
  scopes: z.array(z.string()).min(1).describe('Permission scopes (e.g. messages:read, instances:write)'),
  instanceIds: z.array(z.string().uuid()).optional().describe('Restrict key to specific instance IDs'),
  rateLimit: z.number().int().positive().optional().describe('Rate limit in requests per minute'),
  expiresAt: z.string().datetime().optional().describe('Expiration timestamp (ISO 8601)'),
});

const updateKeySchema = z.object({
  name: z.string().min(1).max(255).optional().describe('Human-readable key name'),
  description: z.string().nullable().optional().describe('Key description'),
  scopes: z.array(z.string()).min(1).optional().describe('Permission scopes'),
  instanceIds: z.array(z.string().uuid()).nullable().optional().describe('Instance ID restrictions (null = all)'),
  rateLimit: z.number().int().positive().nullable().optional().describe('Rate limit (null = default)'),
  expiresAt: z.string().datetime().nullable().optional().describe('Expiration timestamp (null = never)'),
});

const revokeKeySchema = z.object({
  reason: z.string().optional().describe('Reason for revocation'),
  revokedBy: z.string().optional().describe('Who revoked the key'),
});

const listQuerySchema = z.object({
  status: z.enum(['active', 'revoked', 'expired']).optional().describe('Filter by status'),
  limit: z.coerce.number().int().min(1).max(100).default(50).describe('Max results'),
});

const auditQuerySchema = z.object({
  since: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .describe('Filter logs from this timestamp'),
  until: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .describe('Filter logs until this timestamp'),
  path: z.string().optional().describe('Filter by request path (partial match)'),
  statusCode: z.coerce.number().int().optional().describe('Filter by HTTP status code'),
  limit: z.coerce.number().int().min(1).max(100).default(50).describe('Max results'),
  cursor: z.string().optional().describe('Pagination cursor'),
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /keys - Create a new API key
 * Returns the plaintext key ONLY in this response.
 */
keysRoutes.post('/', requireScope('keys:write'), zValidator('json', createKeySchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const result = await services.apiKeys.create({
    name: data.name,
    description: data.description,
    scopes: data.scopes,
    instanceIds: data.instanceIds,
    rateLimit: data.rateLimit,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    createdBy: c.get('apiKey')?.name,
  });

  return c.json(
    {
      data: {
        ...result.key,
        plainTextKey: result.plainTextKey,
      },
    },
    201,
  );
});

/**
 * GET /keys - List all API keys
 */
keysRoutes.get('/', requireScope('keys:read'), zValidator('query', listQuerySchema), async (c) => {
  const { status, limit } = c.req.valid('query');
  const services = c.get('services');

  let items = await services.apiKeys.list();

  if (status) {
    items = items.filter((k) => k.status === status);
  }

  items = items.slice(0, limit);

  return c.json({
    items,
    meta: {
      total: items.length,
    },
  });
});

/**
 * GET /keys/:id - Get a single API key
 */
keysRoutes.get('/:id', requireScope('keys:read'), async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const key = await services.apiKeys.getById(id);
  if (!key) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
  }

  return c.json({ data: key });
});

/**
 * PATCH /keys/:id - Update an API key
 */
keysRoutes.patch('/:id', requireScope('keys:write'), zValidator('json', updateKeySchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  try {
    const updated = await services.apiKeys.update(id, {
      ...data,
      expiresAt: data.expiresAt === null ? null : data.expiresAt ? new Date(data.expiresAt) : undefined,
    });

    if (!updated) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
    }

    return c.json({ data: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Cannot rename primary')) {
      return c.json({ error: { code: 'FORBIDDEN', message } }, 403);
    }
    throw error;
  }
});

/**
 * POST /keys/:id/revoke - Revoke an API key
 */
keysRoutes.post('/:id/revoke', requireScope('keys:write'), zValidator('json', revokeKeySchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const revoked = await services.apiKeys.revoke(id, data.reason, data.revokedBy ?? c.get('apiKey')?.name);

  if (!revoked) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
  }

  return c.json({ data: revoked });
});

/**
 * DELETE /keys/:id - Permanently delete an API key
 */
keysRoutes.delete('/:id', requireScope('keys:write'), async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  try {
    const deleted = await services.apiKeys.delete(id);
    if (!deleted) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
    }
    return c.json({ data: { deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Cannot delete primary')) {
      return c.json({ error: { code: 'FORBIDDEN', message } }, 403);
    }
    throw error;
  }
});

/**
 * GET /keys/:id/audit - Get audit logs for an API key
 */
keysRoutes.get('/:id/audit', requireScope('keys:read'), zValidator('query', auditQuerySchema), async (c) => {
  const id = c.req.param('id');
  const { since, until, path, statusCode, limit, cursor } = c.req.valid('query');
  const services = c.get('services');

  // Verify key exists
  const key = await services.apiKeys.getById(id);
  if (!key) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
  }

  const result = await services.audit.listByKeyId(id, {
    since,
    until,
    path,
    statusCode,
    limit,
    cursor,
  });

  return c.json({
    items: result.items,
    meta: {
      total: result.total,
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});
