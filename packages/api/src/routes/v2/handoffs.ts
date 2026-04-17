/**
 * Handoff logs routes
 *
 * GET /handoffs - List handoff events with full payload
 * GET /handoffs/:id - Get a single handoff log
 */

import { zValidator } from '@hono/zod-validator';
import { handoffLogs } from '@omni/db';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

export const handoffsRoutes = new Hono<{ Variables: AppVariables }>();

const listQuerySchema = z.object({
  instanceId: z.string().uuid().optional(),
  chatId: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /handoffs - List handoff logs (newest first)
 */
handoffsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { instanceId, chatId, since, until, limit, offset } = c.req.valid('query');
  const db = c.get('db');

  const conditions = [];
  if (instanceId) conditions.push(eq(handoffLogs.instanceId, instanceId));
  if (chatId) conditions.push(eq(handoffLogs.chatId, chatId));
  if (since) conditions.push(gte(handoffLogs.sentAt, new Date(since)));
  if (until) conditions.push(lte(handoffLogs.sentAt, new Date(until)));

  const rows = await db
    .select()
    .from(handoffLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(handoffLogs.sentAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows, meta: { limit, offset, count: rows.length } });
});

/**
 * GET /handoffs/:id - Get a single handoff log by ID
 */
handoffsRoutes.get('/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
  const { id } = c.req.valid('param');
  const db = c.get('db');

  const [row] = await db.select().from(handoffLogs).where(eq(handoffLogs.id, id)).limit(1);

  if (!row) return c.json({ error: 'Not found' }, 404);

  return c.json({ data: row });
});
