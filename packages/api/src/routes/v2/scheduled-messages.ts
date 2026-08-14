/**
 * Scheduled message routes (#889)
 *
 * POST   /scheduled-messages          - schedule a message for later
 * GET    /scheduled-messages          - list pending for an instance
 * GET    /scheduled-messages/:id      - read one
 * DELETE /scheduled-messages/:id      - cancel a pending one
 *
 * The service picks the delivery mode from the channel's canScheduleMessage
 * capability: platform-native where available (Slack), otherwise omni's own
 * sweeper. Callers do not choose — a caller cannot know which channels have
 * native scheduling, and picking wrong would silently change the durability
 * guarantee.
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelType } from '@omni/core';
import { ERROR_CODES, OmniError } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { ScheduledMessageService, createPluginResolver } from '../../services/scheduled-messages';
import type { AppVariables } from '../../types';

export const scheduledMessagesRoutes = new Hono<{ Variables: AppVariables }>();

const scheduleSchema = z.object({
  instanceId: z.string().uuid(),
  chatId: z.string().min(1).describe('Platform chat/channel id (e.g. Slack C…/D…)'),
  content: z.record(z.unknown()).describe("OutgoingContent, e.g. { type: 'text', text: 'oi' }"),
  sendAt: z.string().datetime().describe('ISO-8601 delivery time (UTC-aware)'),
  threadId: z.string().optional().describe('Post into this thread (Slack thread_ts)'),
  isThreadBroadcast: z.boolean().optional().describe('Also surface it in the channel (Slack reply_broadcast)'),
});

const listQuerySchema = z.object({
  instanceId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Build the service from request context — the registry only exists per-request. */
function getService(c: { get: (k: 'db' | 'channelRegistry') => unknown }): ScheduledMessageService {
  const db = c.get('db') as Parameters<typeof createPluginResolver>[0];
  const registry = c.get('channelRegistry') as { get: (ch: ChannelType) => unknown } | null | undefined;

  if (!registry) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: 'Channel registry not available',
      recoverable: false,
    });
  }

  return new ScheduledMessageService(
    db,
    createPluginResolver(db, (channel) => registry.get(channel as ChannelType) as never),
  );
}

/** POST /scheduled-messages — schedule a message */
scheduledMessagesRoutes.post('/', zValidator('json', scheduleSchema), async (c) => {
  const body = c.req.valid('json');
  const sendAt = new Date(body.sendAt);

  try {
    const row = await getService(c).schedule({
      instanceId: body.instanceId,
      chatExternalId: body.chatId,
      content: body.content,
      sendAt,
      threadExternalId: body.threadId,
      isThreadBroadcast: body.isThreadBroadcast,
    });

    return c.json({ success: true, data: row }, 201);
  } catch (error) {
    if (error instanceof OmniError) throw error;
    // Past dates, over-the-limit lead times and malformed content are caller
    // errors, not server faults — surface them as such.
    throw new OmniError({
      code: ERROR_CODES.VALIDATION,
      message: error instanceof Error ? error.message : String(error),
      recoverable: false,
    });
  }
});

/** GET /scheduled-messages — list pending for an instance */
scheduledMessagesRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { instanceId, limit } = c.req.valid('query');
  const rows = await getService(c).listPending(instanceId, limit);

  return c.json({
    data: rows,
    meta: {
      count: rows.length,
      // Worth stating explicitly: this lists what omni scheduled. Anything a
      // human scheduled in the Slack UI is invisible to the API, because
      // chat.scheduledMessages.list only returns the calling token's own.
      scope: 'scheduled-via-omni',
    },
  });
});

/** GET /scheduled-messages/:id */
scheduledMessagesRoutes.get('/:id', async (c) => {
  const row = await getService(c).getById(c.req.param('id'));
  if (!row) {
    throw new OmniError({
      code: ERROR_CODES.NOT_FOUND,
      message: `Scheduled message ${c.req.param('id')} not found`,
      recoverable: false,
    });
  }
  return c.json({ data: row });
});

/** DELETE /scheduled-messages/:id — cancel */
scheduledMessagesRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await getService(c).cancel(id);

  if (!row) {
    throw new OmniError({
      code: ERROR_CODES.NOT_FOUND,
      message: `Scheduled message ${id} not found`,
      recoverable: false,
    });
  }

  return c.json({
    success: true,
    data: { id: row.id, status: row.status, canceledAt: row.canceledAt },
  });
});
