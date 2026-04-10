/**
 * Voice REST API routes — platform-agnostic.
 *
 * Uses VoiceCapable interface from channel-sdk. Works with any channel
 * plugin that implements voice (Discord today, Twilio/LiveKit/WebRTC tomorrow).
 *
 * POST /v2/voice/join   — Join a voice channel
 * POST /v2/voice/leave  — Leave a voice session
 * GET  /v2/voice/sessions       — List active voice sessions
 * GET  /v2/voice/sessions/:id   — Get session detail
 */

import { zValidator } from '@hono/zod-validator';
import { isVoiceCapable } from '@omni/channel-sdk';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

export const voiceRoutes = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ──────────────────────────────────────────────

const joinSchema = z.object({
  instanceId: z.string().min(1),
  channelId: z.string().min(1),
  guildId: z.string().optional(),
});

const leaveSchema = z.object({
  sessionId: z.string().min(1),
});

const sessionIdParamSchema = z.object({
  id: z.string().min(1),
});

/** Find the first voice-capable plugin in the registry. */
function findVoicePlugin(channelRegistry: AppVariables['channelRegistry']) {
  if (!channelRegistry) return null;
  for (const plugin of channelRegistry.getAll()) {
    if (isVoiceCapable(plugin)) return plugin;
  }
  return null;
}

// ─── Routes ───────────────────────────────────────────────

voiceRoutes.post('/join', zValidator('json', joinSchema), async (c) => {
  const { instanceId, channelId, guildId } = c.req.valid('json');
  const plugin = findVoicePlugin(c.get('channelRegistry'));

  if (!plugin) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'No voice-capable channel plugin found' } }, 400);
  }

  try {
    const session = await plugin.voiceJoin(channelId, { instanceId, guildId });

    const eventBus = c.get('eventBus');
    if (eventBus) {
      eventBus
        .publish('voice.session_started', { sessionId: session.id, channelId, instanceId, guildId })
        .catch(() => {});
    }

    return c.json(
      {
        data: {
          sessionId: session.id,
          instanceId: session.instanceId,
          channelId: session.channelId,
          state: session.state,
          participants: session.participants,
          createdAt: session.createdAt,
        },
      },
      201,
    );
  } catch (err) {
    return c.json({ error: { code: 'VOICE_JOIN_FAILED', message: String(err) } }, 500);
  }
});

voiceRoutes.post('/leave', zValidator('json', leaveSchema), async (c) => {
  const { sessionId } = c.req.valid('json');
  const plugin = findVoicePlugin(c.get('channelRegistry'));

  if (!plugin) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'No voice-capable plugin' } }, 400);
  }

  try {
    await plugin.voiceLeave(sessionId);

    const eventBus = c.get('eventBus');
    if (eventBus) {
      eventBus.publish('voice.session_ended', { sessionId, reason: 'manual' }).catch(() => {});
    }

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: { code: 'VOICE_LEAVE_FAILED', message: String(err) } }, 500);
  }
});

voiceRoutes.get('/sessions', async (c) => {
  const plugin = findVoicePlugin(c.get('channelRegistry'));
  if (!plugin) return c.json({ items: [] });

  const sessions = plugin.voiceSessions().map((s) => ({
    sessionId: s.id,
    instanceId: s.instanceId,
    channelId: s.channelId,
    state: s.state,
    participants: s.participants,
    createdAt: s.createdAt,
  }));

  return c.json({ items: sessions });
});

voiceRoutes.get('/sessions/:id', zValidator('param', sessionIdParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const plugin = findVoicePlugin(c.get('channelRegistry'));

  if (!plugin) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'No voice-capable plugin' } }, 400);
  }

  const session = plugin.voiceSession(id);
  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Voice session ${id} not found` } }, 404);
  }

  return c.json({
    data: {
      sessionId: session.id,
      instanceId: session.instanceId,
      channelId: session.channelId,
      state: session.state,
      participants: session.participants,
      createdAt: session.createdAt,
    },
  });
});
