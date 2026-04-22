/**
 * Context Routes
 *
 * GET/POST/DELETE conversation context for the authenticated API key.
 * Context tracks active instance, chat, and message for turn-based agents and CLI.
 */

import { zValidator } from '@hono/zod-validator';
import { apiKeys } from '@omni/db/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

export const contextRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// SCHEMAS
// ============================================================================

const setContextSchema = z.object({
  instanceId: z.string().uuid().optional().describe('Active instance ID'),
  chatId: z.string().uuid().optional().describe('Active chat ID'),
  messageId: z.string().uuid().optional().describe('Trigger message ID'),
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /context - Get current conversation context for this API key
 */
contextRoutes.get('/', async (c) => {
  const keyData = c.get('apiKey');
  if (!keyData) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401);
  }

  const db = c.get('db');
  const [row] = await db
    .select({
      activeInstanceId: apiKeys.activeInstanceId,
      contextInstanceId: apiKeys.contextInstanceId,
      contextChatId: apiKeys.contextChatId,
      contextMessageId: apiKeys.contextMessageId,
      contextUpdatedAt: apiKeys.contextUpdatedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyData.id))
    .limit(1);

  if (!row) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
  }

  return c.json({
    data: {
      instanceId: row.contextInstanceId ?? row.activeInstanceId ?? null,
      chatId: row.contextChatId ?? null,
      messageId: row.contextMessageId ?? null,
      activeInstanceId: row.activeInstanceId ?? null,
      updatedAt: row.contextUpdatedAt?.toISOString() ?? null,
    },
  });
});

/**
 * POST /context - Set conversation context for this API key
 */
contextRoutes.post('/', zValidator('json', setContextSchema), async (c) => {
  const keyData = c.get('apiKey');
  if (!keyData) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401);
  }

  const body = c.req.valid('json');
  const db = c.get('db');

  // If instanceId is set, verify it's within this key's allowed instances
  if (body.instanceId && keyData.instanceIds && keyData.instanceIds.length > 0) {
    if (!keyData.instanceIds.includes(body.instanceId)) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Instance not in allowed list for this API key',
          },
        },
        403,
      );
    }
  }

  const updates: Record<string, unknown> = {
    contextUpdatedAt: new Date(),
  };

  if (body.instanceId !== undefined) {
    updates.contextInstanceId = body.instanceId;
  }
  if (body.chatId !== undefined) {
    updates.contextChatId = body.chatId;
  }
  if (body.messageId !== undefined) {
    updates.contextMessageId = body.messageId;
  }

  await db.update(apiKeys).set(updates).where(eq(apiKeys.id, keyData.id));

  return c.json({
    data: {
      instanceId: body.instanceId ?? null,
      chatId: body.chatId ?? null,
      messageId: body.messageId ?? null,
      updatedAt: new Date().toISOString(),
    },
  });
});

/**
 * POST /context/use - Set active instance (admin convenience)
 */
contextRoutes.post('/use', zValidator('json', z.object({ instanceId: z.string().uuid() })), async (c) => {
  const keyData = c.get('apiKey');
  if (!keyData) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401);
  }

  const { instanceId } = c.req.valid('json');
  const db = c.get('db');

  // Verify instance is in allowed list (if scoped)
  if (keyData.instanceIds && keyData.instanceIds.length > 0) {
    if (!keyData.instanceIds.includes(instanceId)) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Instance not in allowed list for this API key',
          },
        },
        403,
      );
    }
  }

  await db
    .update(apiKeys)
    .set({ activeInstanceId: instanceId, contextUpdatedAt: new Date() })
    .where(eq(apiKeys.id, keyData.id));

  return c.json({ data: { activeInstanceId: instanceId } });
});

/**
 * DELETE /context - Clear conversation context for this API key
 */
contextRoutes.delete('/', async (c) => {
  const keyData = c.get('apiKey');
  if (!keyData) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401);
  }

  const db = c.get('db');

  await db
    .update(apiKeys)
    .set({
      contextInstanceId: null,
      contextChatId: null,
      contextMessageId: null,
      contextUpdatedAt: new Date(),
    })
    .where(eq(apiKeys.id, keyData.id));

  return c.json({ data: { cleared: true } });
});
