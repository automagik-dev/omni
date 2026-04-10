/**
 * Voice Stream WebSocket — Bidirectional audio bridge.
 *
 * ## Endpoint
 *   ws://omni/api/v2/voice/stream/{sessionId}?api_key=<key>&format=opus|pcm&user=<userId>
 *
 * ## Authentication
 *   API key validated on upgrade via `api_key` query parameter.
 *   Invalid or missing key → connection rejected (no upgrade).
 *
 * ## Protocol
 *
 * ### Server → Client (downstream)
 *
 * **Binary frames** — audio from Discord participants:
 *   [userId_length: u8][userId: N bytes][audio_data: rest]
 *   The first byte is the length of the userId string, followed by the userId
 *   in UTF-8, followed by the raw audio data (Opus or PCM per `format` param).
 *
 * **Text frames** — JSON control messages:
 *   { type: "session_ready", sessionId: string }
 *   { type: "participant_joined", userId: string, ssrc: number }
 *   { type: "participant_left", userId: string }
 *   { type: "speaking", userId: string, speaking: boolean }
 *   { type: "error", message: string }
 *
 * ### Client → Server (upstream)
 *
 * **Binary frames** — audio for the bot to speak in Discord:
 *   Raw Opus frames (20ms each, 48kHz stereo). The bot sends them verbatim.
 *   If `format=pcm`, client sends raw PCM s16le 48kHz stereo and the server
 *   encodes to Opus before sending to Discord.
 *
 * **Text frames** — JSON control messages:
 *   { type: "speaking", speaking: boolean }  — toggle bot speaking indicator
 *
 * ### Query Parameters
 *   - api_key (required): Omni API key for authentication
 *   - format (optional): "opus" (default) or "pcm"
 *   - user (optional): filter to receive only this user's audio
 *
 * ### Backpressure
 *   Audio is lossy — frames are dropped if the client can't keep up.
 *   This is standard for real-time voice; buffering adds latency.
 *
 * ### Example (Node/Bun client)
 *   ```
 *   const ws = new WebSocket('ws://localhost:8882/api/v2/voice/stream/voice-xxx?api_key=omni_sk_xxx&format=opus');
 *   ws.binaryType = 'arraybuffer';
 *   ws.onmessage = (ev) => {
 *     if (typeof ev.data === 'string') {
 *       const msg = JSON.parse(ev.data);
 *       console.log('control:', msg);
 *     } else {
 *       const buf = Buffer.from(ev.data);
 *       const userIdLen = buf[0];
 *       const userId = buf.subarray(1, 1 + userIdLen).toString('utf8');
 *       const audio = buf.subarray(1 + userIdLen);
 *       console.log(`audio from ${userId}: ${audio.length} bytes`);
 *     }
 *   };
 *   // Send audio for bot to speak:
 *   ws.send(opusFrameBuffer);
 *   ```
 */

import { createLogger } from '@omni/core';

const log = createLogger('ws:voice');

type AudioFormat = 'opus' | 'pcm';

/** Parsed query params from the WS URL. */
export interface VoiceStreamParams {
  sessionId: string;
  apiKey: string;
  format: AudioFormat;
  filterUserId?: string;
}

/** A connected WS client subscription. */
export interface VoiceStreamClient {
  params: VoiceStreamParams;
  send: (data: string | ArrayBuffer | Uint8Array) => void;
}

/**
 * Registry of active voice stream WS clients.
 * The voice session pushes audio here; the WS handler pushes client audio to the session.
 */
export class VoiceStreamRegistry {
  private clients = new Map<unknown, VoiceStreamClient>();

  /** Register a new WS client. */
  add(ws: unknown, client: VoiceStreamClient): void {
    this.clients.set(ws, client);
    log.info('Voice WS client connected', {
      sessionId: client.params.sessionId,
      format: client.params.format,
      filterUser: client.params.filterUserId ?? 'all',
    });
  }

  /** Remove a WS client. */
  remove(ws: unknown): void {
    this.clients.delete(ws);
  }

  /** Get client info for a WS. */
  get(ws: unknown): VoiceStreamClient | undefined {
    return this.clients.get(ws);
  }

  /** Push a tagged audio frame to all matching clients for a session. */
  pushAudio(sessionId: string, userId: string, audioData: Uint8Array, format: AudioFormat): void {
    const userIdBuf = Buffer.from(userId, 'utf8');
    // Build tagged frame: [userIdLen: u8][userId: N][audio: rest]
    const frame = Buffer.alloc(1 + userIdBuf.length + audioData.length);
    frame[0] = userIdBuf.length;
    userIdBuf.copy(frame, 1);
    Buffer.from(audioData).copy(frame, 1 + userIdBuf.length);

    for (const [, client] of this.clients) {
      if (client.params.sessionId !== sessionId) continue;
      if (client.params.format !== format) continue;
      if (client.params.filterUserId && client.params.filterUserId !== userId) continue;
      try {
        client.send(frame);
      } catch {
        // Client disconnected or slow — drop frame
      }
    }
  }

  /** Send a JSON control message to all clients of a session. */
  broadcast(sessionId: string, message: Record<string, unknown>): void {
    const json = JSON.stringify(message);
    for (const [, client] of this.clients) {
      if (client.params.sessionId !== sessionId) continue;
      try {
        client.send(json);
      } catch {
        // Drop
      }
    }
  }

  /** Number of connected clients. */
  get size(): number {
    return this.clients.size;
  }

  /** Get all clients for a session. */
  getClientsForSession(sessionId: string): VoiceStreamClient[] {
    const result: VoiceStreamClient[] = [];
    for (const [, client] of this.clients) {
      if (client.params.sessionId === sessionId) result.push(client);
    }
    return result;
  }
}

/** Parse voice stream params from a URL. */
export function parseVoiceStreamParams(url: URL): VoiceStreamParams | null {
  // Expected path: /api/v2/voice/stream/{sessionId}
  const match = url.pathname.match(/\/api\/v2\/voice\/stream\/([^/]+)/);
  if (!match?.[1]) return null;

  const sessionId = match[1];
  const apiKey = url.searchParams.get('api_key') ?? '';
  const format = (url.searchParams.get('format') ?? 'opus') as AudioFormat;
  const filterUserId = url.searchParams.get('user') ?? undefined;

  if (!apiKey) return null;

  return { sessionId, apiKey, format: format === 'pcm' ? 'pcm' : 'opus', filterUserId };
}
