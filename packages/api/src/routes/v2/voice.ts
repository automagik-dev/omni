/**
 * Voice REST API routes.
 *
 * POST /v2/voice/join   — Join a voice channel
 * POST /v2/voice/leave  — Leave a voice session
 * GET  /v2/voice/sessions       — List active voice sessions
 * GET  /v2/voice/sessions/:id   — Get session detail
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

export const voiceRoutes = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ──────────────────────────────────────────────

const joinSchema = z.object({
  instanceId: z.string().min(1),
  channelId: z.string().min(1),
  guildId: z.string().min(1),
});

const leaveSchema = z.object({
  sessionId: z.string().min(1),
});

const sessionIdParamSchema = z.object({
  id: z.string().min(1),
});

// ─── Routes ───────────────────────────────────────────────

/**
 * POST /v2/voice/join
 * Join a Discord voice channel.
 */
voiceRoutes.post('/join', zValidator('json', joinSchema), async (c) => {
  const { instanceId, channelId, guildId } = c.req.valid('json');
  const channelRegistry = c.get('channelRegistry');

  if (!channelRegistry) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get('discord');
  if (!plugin) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Discord plugin not available' } }, 404);
  }

  // Access the voice manager from the plugin (per-instance)
  const voiceManager = (
    plugin as {
      voiceManagers?: Map<string, { joinChannel: (guildId: string, channelId: string) => Promise<unknown> }>;
    }
  ).voiceManagers?.get(instanceId);
  if (!voiceManager) {
    return c.json(
      { error: { code: 'NOT_AVAILABLE', message: `Voice manager not initialized for instance ${instanceId}` } },
      400,
    );
  }

  try {
    const session = await voiceManager.joinChannel(guildId, channelId);

    // Publish session started event
    const eventBus = c.get('eventBus');
    if (eventBus) {
      await eventBus.publish('voice.session_started', {
        sessionId: (session as { sessionId: string }).sessionId,
        channelId,
        instanceId,
        guildId,
      });
    }

    return c.json({ data: session }, 201);
  } catch (err) {
    return c.json({ error: { code: 'VOICE_JOIN_FAILED', message: String(err) } }, 500);
  }
});

/**
 * POST /v2/voice/leave
 * Leave a voice session.
 */
voiceRoutes.post('/leave', zValidator('json', leaveSchema), async (c) => {
  const { sessionId } = c.req.valid('json');
  const channelRegistry = c.get('channelRegistry');

  if (!channelRegistry) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get('discord');
  if (!plugin) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Discord plugin not available' } }, 404);
  }

  const voiceManager = (plugin as { voiceManager?: { leaveChannel: (sessionId: string) => Promise<void> } })
    .voiceManager;
  if (!voiceManager) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'Voice manager not initialized' } }, 400);
  }

  try {
    await voiceManager.leaveChannel(sessionId);

    const eventBus = c.get('eventBus');
    if (eventBus) {
      await eventBus.publish('voice.session_ended', { sessionId, reason: 'manual' });
    }

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: { code: 'VOICE_LEAVE_FAILED', message: String(err) } }, 500);
  }
});

/**
 * GET /v2/voice/sessions
 * List all active voice sessions.
 */
voiceRoutes.get('/sessions', async (c) => {
  const channelRegistry = c.get('channelRegistry');

  if (!channelRegistry) {
    return c.json({ items: [] });
  }

  const plugin = channelRegistry.get('discord');
  if (!plugin) {
    return c.json({ items: [] });
  }

  const voiceManager = (plugin as { voiceManager?: { getSessions: () => unknown[] } }).voiceManager;
  if (!voiceManager) {
    return c.json({ items: [] });
  }

  const sessions = voiceManager.getSessions();
  return c.json({ items: sessions });
});

/**
 * GET /v2/voice/sessions/:id
 * Get a specific voice session with detail.
 */
voiceRoutes.get('/sessions/:id', zValidator('param', sessionIdParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const channelRegistry = c.get('channelRegistry');

  if (!channelRegistry) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get('discord');
  if (!plugin) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Discord plugin not available' } }, 404);
  }

  const voiceManager = (plugin as { voiceManager?: { getSession: (id: string) => unknown | undefined } }).voiceManager;
  if (!voiceManager) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'Voice manager not initialized' } }, 400);
  }

  const session = voiceManager.getSession(id);
  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Voice session ${id} not found` } }, 404);
  }

  return c.json({ data: session });
});
