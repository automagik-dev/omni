/**
 * Voice capability interface for channel plugins.
 *
 * Any channel plugin that supports voice implements VoiceCapable.
 * The Omni API uses this interface generically — it doesn't know
 * whether the underlying transport is Discord, WebRTC, SIP, or anything else.
 *
 * Each transport delivers: Opus audio frames per participant.
 * Each transport accepts: Opus audio frames for the bot to speak.
 * Each transport manages: join/leave/lifecycle differently (internal detail).
 */

/** A voice session with per-user audio streaming. */
export interface VoiceSession {
  readonly id: string;
  readonly state: 'connecting' | 'ready' | 'reconnecting' | 'disconnected';
  readonly channelId: string;
  readonly instanceId: string;
  readonly participants: string[];
  readonly createdAt: number;

  /** Register a callback for decoded audio (called per-packet, per-user). */
  onAudio(cb: (userId: string, ssrc: number, opusFrame: Uint8Array) => void): void;
  offAudio(cb: (userId: string, ssrc: number, opusFrame: Uint8Array) => void): void;

  /** Send an Opus frame for the bot to speak. */
  sendAudio(opusFrame: Buffer): void;
}

/** Voice capability that a channel plugin can implement. */
export interface VoiceCapable {
  /** Join a voice channel. Options are platform-specific. */
  voiceJoin(channelId: string, opts?: Record<string, unknown>): Promise<VoiceSession>;

  /** Leave a voice session. */
  voiceLeave(sessionId: string): Promise<void>;

  /** List active voice sessions for this plugin. */
  voiceSessions(): VoiceSession[];

  /** Get a specific voice session. */
  voiceSession(sessionId: string): VoiceSession | undefined;
}

/** Type guard to check if a plugin supports voice. */
export function isVoiceCapable(plugin: unknown): plugin is VoiceCapable {
  return (
    plugin !== null &&
    typeof plugin === 'object' &&
    'voiceJoin' in plugin &&
    'voiceLeave' in plugin &&
    'voiceSessions' in plugin
  );
}
