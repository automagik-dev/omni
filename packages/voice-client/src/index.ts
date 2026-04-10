// Interfaces
export type { VoiceTransport, TransportState, TransportOptions } from './interfaces/transport';
export type { AudioCodec } from './interfaces/codec';
export type { EncryptionLayer } from './interfaces/encryption';

// Classes
export { AudioStream } from './stream/audio-stream';
export { OpusCodec } from './codecs/opus';

// Discord transport
export { DiscordVoiceSession } from './transports/discord/session';
export { VoiceGateway, VoiceOpcode } from './transports/discord/gateway';
export type {
  GatewayState,
  GatewayReadyPayload,
  SessionDescriptionPayload,
  SpeakingPayload,
} from './transports/discord/gateway';
export { VoiceUdp, parseRtpHeader, parseRtpPacket, rtpHeaderLength } from './transports/discord/udp';
export type { RtpHeader, RtpPacket } from './transports/discord/udp';

// Crypto
export { SrtpDecryptor, ENCRYPTION_MODES, selectEncryptionMode, preferredModes } from './crypto/srtp';
export type { EncryptionMode } from './crypto/srtp';
