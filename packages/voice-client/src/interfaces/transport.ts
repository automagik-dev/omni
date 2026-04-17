import type { AudioStream } from '../stream/audio-stream';

export type TransportState = 'connecting' | 'ready' | 'reconnecting' | 'disconnected';

export interface TransportOptions {
  channelId: string;
  guildId: string;
  token: string;
  endpoint: string;
}

export interface VoiceTransport {
  connect(options: TransportOptions): Promise<void>;
  disconnect(): Promise<void>;
  onStateChange(cb: (state: TransportState) => void): void;
  getParticipantStream(userId: string): AudioStream | undefined;
  listParticipants(): string[];
  readonly state: TransportState;
}
