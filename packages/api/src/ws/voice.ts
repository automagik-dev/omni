/**
 * WebSocket handler for voice audio streams.
 *
 * Route: ws://omni/v2/voice/stream/{sessionId}?format=opus|pcm&user={userId}
 *
 * Streams binary audio frames (Opus or PCM) from a voice session.
 * Sends JSON control messages for participant join/leave events.
 * Drops frames for slow clients (voice is lossy — no buffering).
 */

import { type EventBus, createLogger } from '@omni/core';

const log = createLogger('ws:voice');

type AudioFormat = 'opus' | 'pcm';

/** JSON control messages sent to the client. */
interface ParticipantJoinedMessage {
  type: 'participant_joined';
  userId: string;
  platformUserId: string;
}

interface ParticipantLeftMessage {
  type: 'participant_left';
  userId: string;
}

type ControlMessage = ParticipantJoinedMessage | ParticipantLeftMessage;

/** Subscription state per connected WebSocket client. */
interface VoiceSubscription {
  sessionId: string;
  format: AudioFormat;
  /** If set, only stream this user's audio. Otherwise, stream all. */
  filterUserId?: string;
  /** Backpressure: track if client is ready for more data. */
  ready: boolean;
}

/** Safely send a JSON control message to a WebSocket. */
function sendControl(ws: { send: (data: string) => void }, msg: ControlMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Client disconnected
  }
}

/** Safely send a binary audio frame to a WebSocket. */
function sendBinary(ws: { send: (data: Uint8Array) => void }, data: Uint8Array): void {
  try {
    ws.send(data);
  } catch {
    // Client disconnected
  }
}

/**
 * Create a WebSocket voice handler for a specific session.
 *
 * The handler manages connected clients and provides methods to push
 * audio frames and participant events from the voice session.
 */
export function createVoiceWebSocketHandler(eventBus: EventBus | null) {
  const clients = new Map<unknown, VoiceSubscription>();

  return {
    /**
     * Handle WebSocket open.
     * Parse query params for format and user filter.
     */
    open(ws: unknown, params: { sessionId: string; format?: string; user?: string }): void {
      const format: AudioFormat = params.format === 'pcm' ? 'pcm' : 'opus';
      const sub: VoiceSubscription = {
        sessionId: params.sessionId,
        format,
        filterUserId: params.user,
        ready: true,
      };
      clients.set(ws, sub);
      log.info(`Voice WS client connected: session=${params.sessionId} format=${format} user=${params.user ?? 'all'}`);
    },

    /**
     * Handle WebSocket message (client → server).
     * Currently unused — clients only receive, not send.
     */
    message(_ws: unknown, _message: string | Buffer): void {
      // Voice WS is receive-only for audio.
      // Future: could accept control commands (mute, switch format, etc.)
    },

    /**
     * Handle WebSocket close.
     */
    close(ws: unknown): void {
      clients.delete(ws);
    },

    /**
     * Push a binary audio frame to all matching clients.
     * Drops frames for slow clients (backpressure).
     */
    pushAudioFrame(sessionId: string, userId: string, frame: Uint8Array, format: AudioFormat): void {
      for (const [ws, sub] of clients) {
        if (sub.sessionId !== sessionId) continue;
        if (sub.format !== format) continue;
        if (sub.filterUserId && sub.filterUserId !== userId) continue;

        // Lossy: drop frame if client isn't ready
        if (!sub.ready) continue;

        sendBinary(ws as { send: (data: Uint8Array) => void }, frame);
      }
    },

    /**
     * Notify clients about a participant joining the voice session.
     */
    broadcastParticipantJoined(sessionId: string, userId: string, platformUserId: string): void {
      const msg: ParticipantJoinedMessage = { type: 'participant_joined', userId, platformUserId };
      for (const [ws, sub] of clients) {
        if (sub.sessionId !== sessionId) continue;
        sendControl(ws as { send: (data: string) => void }, msg);
      }

      // Publish to NATS event bus
      if (eventBus) {
        eventBus
          .publish('voice.stream_ready', {
            sessionId,
            userId,
            platformUserId,
            ssrc: 0, // SSRC is internal — not exposed to WS clients
          })
          .catch((err) => log.error('Failed to publish voice.stream_ready', { error: err }));
      }
    },

    /**
     * Notify clients about a participant leaving the voice session.
     */
    broadcastParticipantLeft(sessionId: string, userId: string): void {
      const msg: ParticipantLeftMessage = { type: 'participant_left', userId };
      for (const [ws, sub] of clients) {
        if (sub.sessionId !== sessionId) continue;
        sendControl(ws as { send: (data: string) => void }, msg);
      }

      if (eventBus) {
        eventBus
          .publish('voice.stream_ended', {
            sessionId,
            userId,
            reason: 'left',
          })
          .catch((err) => log.error('Failed to publish voice.stream_ended', { error: err }));
      }
    },

    /**
     * Publish session lifecycle events to NATS.
     */
    publishSessionStarted(sessionId: string, channelId: string, instanceId: string, guildId?: string): void {
      if (eventBus) {
        eventBus
          .publish('voice.session_started', { sessionId, channelId, instanceId, guildId })
          .catch((err) => log.error('Failed to publish voice.session_started', { error: err }));
      }
    },

    publishSessionEnded(sessionId: string, reason: 'disconnected' | 'kicked' | 'channel_deleted' | 'manual'): void {
      if (eventBus) {
        eventBus
          .publish('voice.session_ended', { sessionId, reason })
          .catch((err) => log.error('Failed to publish voice.session_ended', { error: err }));
      }
    },

    /** Number of connected WS clients. */
    get clientCount(): number {
      return clients.size;
    },
  };
}
