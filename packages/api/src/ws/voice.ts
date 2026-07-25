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
import { OpusCodec } from '@omni/voice-client';

const log = createLogger('ws:voice');

export type AudioFormat = 'opus' | 'pcm';

let opusCodec: OpusCodec | null = null;

function getOpusCodec(): OpusCodec {
  opusCodec ??= new OpusCodec();
  return opusCodec;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function toPcmSamples(audioData: Uint8Array): Int16Array {
  if (audioData.byteLength % 2 !== 0) {
    throw new Error('PCM audio frames must have an even number of bytes');
  }

  const buffer = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
  return new Int16Array(buffer);
}

function toPcmBytes(samples: Int16Array): Uint8Array {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

export function transcodeAudioFrame(
  audioData: ArrayBuffer | Uint8Array,
  sourceFormat: AudioFormat,
  targetFormat: AudioFormat,
): Uint8Array {
  const bytes = toUint8Array(audioData);
  if (sourceFormat === targetFormat) {
    return bytes;
  }

  const codec = getOpusCodec();
  if (sourceFormat === 'opus' && targetFormat === 'pcm') {
    return toPcmBytes(codec.decode(bytes));
  }

  if (sourceFormat === 'pcm' && targetFormat === 'opus') {
    return codec.encode(toPcmSamples(bytes));
  }

  throw new Error(`Unsupported voice frame transcode: ${sourceFormat} -> ${targetFormat}`);
}

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
    for (const [, client] of this.clients) {
      if (client.params.sessionId !== sessionId) continue;
      if (client.params.filterUserId && client.params.filterUserId !== userId) continue;

      try {
        const transcoded = transcodeAudioFrame(audioData, format, client.params.format);
        const userIdBuf = Buffer.from(userId.slice(0, 255), 'utf8');
        if (userIdBuf.length > 255) continue;
        const frame = Buffer.alloc(1 + userIdBuf.length + transcoded.length);
        frame[0] = userIdBuf.length;
        userIdBuf.copy(frame, 1);
        Buffer.from(transcoded).copy(frame, 1 + userIdBuf.length);
        client.send(frame);
      } catch {
        // Client disconnected, slow, or requested an invalid transcode — drop frame
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

/**
 * Authorize an API key for a voice WebSocket upgrade.
 *
 * `ApiKeyService.validate` resolves to `ValidatedApiKey | null`: it returns
 * **null** — it does not throw — for an unknown, malformed, expired, or revoked
 * key, and only throws when the lookup itself fails. Awaiting it without
 * inspecting the result therefore admits every key that fails politely and
 * refuses only the ones that fail loudly, which is the opposite of the intent.
 *
 * Every unresolvable outcome refuses:
 * - `validate` absent (no database to consult) — we cannot authenticate, so we
 *   do not admit. This is a partially-initialized process, not a deployment shape.
 * - `validate` resolves null — the key is not a live credential.
 * - `validate` throws — an auth store we cannot consult is not evidence of authority.
 */
export async function authorizeVoiceApiKey(
  validate: ((apiKey: string) => Promise<unknown>) | null,
  apiKey: string,
): Promise<boolean> {
  if (!validate) return false;
  try {
    return (await validate(apiKey)) != null;
  } catch {
    return false;
  }
}
