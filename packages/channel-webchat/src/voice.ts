/**
 * Webchat voice — PROTOTYPE (echo test only).
 *
 * The browser streams its microphone to Omni over a WebSocket and gets audio
 * back on the same socket. Each socket is one `VoiceSession`, so the existing
 * voice bridge (`/api/v2/voice/stream/:sessionId`, packages/api/src/ws/voice.ts)
 * and voice apps such as `examples/echo-bot.ts` work unchanged.
 *
 *   Browser ──PCM──▶ webchat socket ──Opus──▶ voice bridge ──▶ voice app
 *   Browser ◀──PCM── webchat socket ◀──Opus── voice bridge ◀── voice app
 *
 * Wire format on the browser socket: binary frames of PCM s16le, 48 kHz,
 * stereo interleaved, 20 ms (960 samples per channel = 3840 bytes), the same
 * frame the Discord transport uses. Text frames are JSON control messages.
 */

import type { VoiceSession } from '@omni/channel-sdk';
import { OpusCodec } from '@omni/voice-client';

/** 20 ms of 48 kHz stereo s16le. */
const PCM_FRAME_BYTES = 960 * 2 * 2;

/** The bit of Bun's ServerWebSocket the session needs. */
export interface VoiceSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

/** Same shape as the sink the API wires into voice-capable plugins (`voiceStreamSink`). */
export interface AudioStreamSink {
  pushAudio(sessionId: string, userId: string, audioData: Uint8Array, format: 'opus' | 'pcm'): void;
  broadcast(sessionId: string, message: Record<string, unknown>): void;
}

type AudioCallback = (userId: string, ssrc: number, opusFrame: Uint8Array) => void;

export class WebchatVoiceSession implements VoiceSession {
  state: VoiceSession['state'] = 'ready';
  readonly participants: string[];
  readonly createdAt = Date.now();

  private readonly codec = new OpusCodec();
  private readonly listeners = new Set<AudioCallback>();

  constructor(
    readonly id: string,
    readonly instanceId: string,
    /** The visitor id: one visitor is the whole "channel". */
    readonly channelId: string,
    private readonly socket: VoiceSocket,
    private readonly sink: () => AudioStreamSink | null,
  ) {
    this.participants = [channelId];
  }

  onAudio(cb: AudioCallback): void {
    this.listeners.add(cb);
  }

  offAudio(cb: AudioCallback): void {
    this.listeners.delete(cb);
  }

  /** Visitor's microphone frame → Opus → voice bridge and in-process listeners. */
  receiveFromBrowser(pcm: Uint8Array): void {
    if (this.state !== 'ready' || pcm.byteLength !== PCM_FRAME_BYTES) return; // drop malformed frames
    const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    const opus = this.codec.encode(samples);
    this.sink()?.pushAudio(this.id, this.channelId, opus, 'opus');
    for (const cb of this.listeners) cb(this.channelId, 0, opus);
  }

  /** Voice app's Opus frame → PCM → browser speaker. */
  sendAudio(opusFrame: Buffer): void {
    if (this.state !== 'ready') return;
    try {
      const pcm = this.codec.decode(opusFrame);
      this.socket.send(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    } catch {
      // Corrupt frame or socket gone — audio is lossy, drop it.
    }
  }

  /** JSON control message to the browser. */
  notify(message: Record<string, unknown>): void {
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // socket gone
    }
  }

  end(reason?: string): void {
    if (this.state === 'disconnected') return;
    this.state = 'disconnected';
    this.listeners.clear();
    try {
      this.socket.close(1000, reason);
    } catch {
      // already closed
    }
  }
}
