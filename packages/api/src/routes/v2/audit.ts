/**
 * Config-mutation audit log read API (issue #1152).
 *
 * GET /audit      - list rows written by configAuditMiddleware, newest first
 * GET /audit/:id  - one row
 */

import { zValidator } from '@hono/zod-validator';
import { configAuditLogs } from '@omni/db';
import { type SQL, and, desc, eq, gte, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { optionalDateParam } from '../../schemas/date-query';
import type { AppVariables } from '../../types';

const auditQuerySchema = z.object({
  targetType: z.string().max(50).optional().describe('Filter by resource type (instance, agent, provider, ...)'),
  target: z.string().max(255).optional().describe('Filter by target id'),
  actor: z.string().max(255).optional().describe('Filter by X-Omni-Actor or API key name'),
  since: optionalDateParam('since').describe('Only rows at or after this timestamp'),
  limit: z.coerce.number().int().min(1).max(200).default(50).describe('Max results'),
  cursor: optionalDateParam('cursor').describe('Pagination cursor (createdAt of the last row)'),
});

export const auditRoutes = new Hono<{ Variables: AppVariables }>();

auditRoutes.get('/', zValidator('query', auditQuerySchema), async (c) => {
  const { targetType, target, actor, since, limit, cursor } = c.req.valid('query');
  const conditions: SQL[] = [];
  if (targetType) conditions.push(eq(configAuditLogs.targetType, targetType));
  if (target) conditions.push(eq(configAuditLogs.targetId, target));
  const byActor = actor ? or(eq(configAuditLogs.actor, actor), eq(configAuditLogs.apiKeyName, actor)) : undefined;
  if (byActor) conditions.push(byActor);
  if (since) conditions.push(gte(configAuditLogs.createdAt, since));
  if (cursor) conditions.push(lt(configAuditLogs.createdAt, cursor));

  const rows = await c
    .get('db')
    .select()
    .from(configAuditLogs)
    .where(and(...conditions))
    .orderBy(desc(configAuditLogs.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return c.json({
    items,
    meta: { hasMore, cursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null },
  });
});

auditRoutes.get('/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
  const [row] = await c
    .get('db')
    .select()
    .from(configAuditLogs)
    .where(eq(configAuditLogs.id, c.req.valid('param').id));
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Audit entry not found' } }, 404);
  return c.json({ data: row });
});
