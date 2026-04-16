/**
 * OpenAPI schemas for voice endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

// ─── Schemas ──────────────────────────────────────────────

const VoiceSessionSchema = z.object({
  sessionId: z.string().openapi({ description: 'Voice session ID' }),
  instanceId: z.string().openapi({ description: 'Channel instance ID' }),
  channelId: z.string().openapi({ description: 'Voice channel ID' }),
  state: z.string().openapi({ description: 'Session state (e.g. connecting, ready, disconnected)' }),
  participants: z.array(z.string()).openapi({ description: 'User IDs of current participants' }),
  createdAt: z.string().datetime().optional().openapi({ description: 'Session creation timestamp' }),
});

const VoiceJoinRequestSchema = z.object({
  instanceId: z.string().min(1).openapi({ description: 'Channel instance ID' }),
  channelId: z.string().min(1).openapi({ description: 'Voice channel ID to join' }),
  guildId: z.string().optional().openapi({ description: 'Guild/server ID (required for Discord)' }),
});

const VoiceLeaveRequestSchema = z.object({
  sessionId: z.string().min(1).openapi({ description: 'Voice session ID to leave' }),
});

const VoiceErrorSchema = z.object({
  error: z.object({
    code: z.string().openapi({ description: 'Error code' }),
    message: z.string().openapi({ description: 'Error message' }),
  }),
});

// ─── Registration ─────────────────────────────────────────

export function registerVoiceSchemas(registry: OpenAPIRegistry): void {
  registry.register('VoiceSession', VoiceSessionSchema);
  registry.register('VoiceJoinRequest', VoiceJoinRequestSchema);
  registry.register('VoiceLeaveRequest', VoiceLeaveRequestSchema);

  // POST /v2/voice/join
  registry.registerPath({
    method: 'post',
    path: '/voice/join',
    operationId: 'voiceJoin',
    tags: ['Voice'],
    summary: 'Join a voice channel',
    description: 'Join a voice channel via a voice-capable channel plugin. Returns the created session.',
    request: { body: { content: { 'application/json': { schema: VoiceJoinRequestSchema } } } },
    responses: {
      201: {
        description: 'Successfully joined voice channel',
        content: {
          'application/json': {
            schema: z.object({ data: VoiceSessionSchema }),
          },
        },
      },
      400: {
        description: 'No voice-capable channel plugin available',
        content: {
          'application/json': { schema: VoiceErrorSchema },
        },
      },
      500: {
        description: 'Failed to join voice channel',
        content: {
          'application/json': { schema: VoiceErrorSchema },
        },
      },
    },
  });

  // POST /v2/voice/leave
  registry.registerPath({
    method: 'post',
    path: '/voice/leave',
    operationId: 'voiceLeave',
    tags: ['Voice'],
    summary: 'Leave a voice session',
    description: 'Leave an active voice session.',
    request: { body: { content: { 'application/json': { schema: VoiceLeaveRequestSchema } } } },
    responses: {
      200: {
        description: 'Successfully left voice session',
        content: {
          'application/json': {
            schema: z.object({ success: z.boolean() }),
          },
        },
      },
      400: {
        description: 'No voice-capable channel plugin available',
        content: {
          'application/json': { schema: VoiceErrorSchema },
        },
      },
      500: {
        description: 'Failed to leave voice session',
        content: {
          'application/json': { schema: VoiceErrorSchema },
        },
      },
    },
  });

  // GET /v2/voice/sessions
  registry.registerPath({
    method: 'get',
    path: '/voice/sessions',
    operationId: 'listVoiceSessions',
    tags: ['Voice'],
    summary: 'List active voice sessions',
    description: 'List all active voice sessions across voice-capable plugins.',
    responses: {
      200: {
        description: 'List of active voice sessions',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(VoiceSessionSchema),
            }),
          },
        },
      },
    },
  });

  // GET /v2/voice/sessions/:id
  registry.registerPath({
    method: 'get',
    path: '/voice/sessions/{id}',
    operationId: 'getVoiceSession',
    tags: ['Voice'],
    summary: 'Get voice session details',
    description: 'Get details of a specific voice session by ID.',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Voice session ID',
      },
    ],
    responses: {
      200: {
        description: 'Voice session details',
        content: {
          'application/json': {
            schema: z.object({ data: VoiceSessionSchema }),
          },
        },
      },
      400: {
        description: 'No voice-capable channel plugin available',
        content: {
          'application/json': { schema: VoiceErrorSchema },
        },
      },
      404: {
        description: 'Voice session not found',
        content: {
          'application/json': { schema: VoiceErrorSchema },
        },
      },
    },
  });
}
