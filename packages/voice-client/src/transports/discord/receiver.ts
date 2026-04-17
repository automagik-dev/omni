import type { AudioCodec } from '../../interfaces/codec';
/**
 * Packet receiver + SSRC demuxer.
 *
 * Responsibilities:
 * - Map SSRC → userId (from Speaking events)
 * - Create/manage AudioStream per participant
 * - Route decrypted Opus frames to correct stream
 * - Handle SSRC changes (user reconnect → new SSRC, same userId)
 * - Silence detection (no packets for N ms → participant marked silent)
 * - Emit participant join/leave events
 */
import { AudioStream } from '../../stream/audio-stream';

const DEFAULT_SILENCE_TIMEOUT_MS = 300;

export interface ReceiverEvents {
  participantJoin: (userId: string, stream: AudioStream) => void;
  participantLeave: (userId: string) => void;
  participantSpeaking: (userId: string, speaking: boolean) => void;
}

type ReceiverEventKey = keyof ReceiverEvents;

export class PacketReceiver {
  /** SSRC → userId mapping from Speaking events. */
  private ssrcToUser = new Map<number, string>();
  /** userId → SSRC (reverse mapping for SSRC change detection). */
  private userToSsrc = new Map<string, number>();
  /** userId → AudioStream. */
  private streams = new Map<string, AudioStream>();
  /** userId → silence timer. */
  private silenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** userId → last packet timestamp. */
  private lastPacketTime = new Map<string, number>();
  /** Event listeners. */
  private listeners = new Map<ReceiverEventKey, Set<ReceiverEvents[ReceiverEventKey]>>();
  /** Optional codec for PCM decoding. */
  private codec: AudioCodec | null;
  /** Silence timeout in ms. */
  private silenceTimeoutMs: number;

  constructor(opts?: { codec?: AudioCodec; silenceTimeoutMs?: number }) {
    this.codec = opts?.codec ?? null;
    this.silenceTimeoutMs = opts?.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
  }

  on<K extends ReceiverEventKey>(event: K, listener: ReceiverEvents[K]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off<K extends ReceiverEventKey>(event: K, listener: ReceiverEvents[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit<K extends ReceiverEventKey>(event: K, ...args: Parameters<ReceiverEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as (...a: Parameters<ReceiverEvents[K]>) => void)(...args);
    }
  }

  /**
   * Handle a Speaking event from the gateway.
   * Maps SSRC → userId. Handles SSRC changes (user reconnects with new SSRC).
   */
  handleSpeaking(userId: string, ssrc: number, speaking: number): void {
    const previousSsrc = this.userToSsrc.get(userId);

    // SSRC changed — user reconnected with a different SSRC
    if (previousSsrc !== undefined && previousSsrc !== ssrc) {
      this.ssrcToUser.delete(previousSsrc);
    }

    this.ssrcToUser.set(ssrc, userId);
    this.userToSsrc.set(userId, ssrc);

    // Create stream if this is a new participant
    if (!this.streams.has(userId)) {
      const stream = new AudioStream(userId, ssrc, this.codec ?? undefined);
      this.streams.set(userId, stream);
      this.emit('participantJoin', userId, stream);
    }

    // Emit speaking state change
    this.emit('participantSpeaking', userId, speaking !== 0);
  }

  /**
   * Route a decrypted Opus frame to the correct participant stream.
   * Called by the session after SRTP decryption.
   */
  receivePacket(ssrc: number, opusFrame: Uint8Array): void {
    const userId = this.ssrcToUser.get(ssrc);
    if (!userId) return;

    const stream = this.streams.get(userId);
    if (!stream) return;

    // Push to the audio stream
    stream.push(opusFrame, 'opus');

    // Update last packet time and reset silence timer
    this.lastPacketTime.set(userId, Date.now());
    this.resetSilenceTimer(userId);
  }

  /**
   * Handle a client disconnect event from the gateway.
   * Removes the participant and cleans up their stream.
   */
  handleDisconnect(userId: string): void {
    this.removeParticipant(userId);
  }

  /** Get a participant's AudioStream. */
  getStream(userId: string): AudioStream | undefined {
    return this.streams.get(userId);
  }

  /** List all connected participant userIds. */
  listParticipants(): string[] {
    return [...this.streams.keys()];
  }

  /** Get the userId mapped to a given SSRC. */
  getUserForSsrc(ssrc: number): string | undefined {
    return this.ssrcToUser.get(ssrc);
  }

  /** Clean up all participants and timers. */
  destroy(): void {
    for (const userId of [...this.streams.keys()]) {
      this.removeParticipant(userId);
    }
  }

  // ─── internal ───────────────────────────────────────────────

  private resetSilenceTimer(userId: string): void {
    const existing = this.silenceTimers.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.silenceTimers.delete(userId);
      this.emit('participantSpeaking', userId, false);
    }, this.silenceTimeoutMs);

    this.silenceTimers.set(userId, timer);
  }

  private removeParticipant(userId: string): void {
    const ssrc = this.userToSsrc.get(userId);
    if (ssrc !== undefined) {
      this.ssrcToUser.delete(ssrc);
    }
    this.userToSsrc.delete(userId);

    const stream = this.streams.get(userId);
    if (stream) {
      stream.unsubscribe();
      this.streams.delete(userId);
    }

    const timer = this.silenceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.silenceTimers.delete(userId);
    }

    this.lastPacketTime.delete(userId);
    this.emit('participantLeave', userId);
  }
}
