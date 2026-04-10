import { SrtpDecryptor, selectEncryptionMode } from '../../crypto/srtp';
/**
 * DiscordVoiceSession — orchestrates Gateway + UDP + SRTP into the VoiceTransport interface.
 *
 * Connection flow:
 * 1. Open Voice Gateway WebSocket, send Identify
 * 2. Receive Ready → get SSRC, UDP IP/port, encryption modes
 * 3. Create UDP socket, perform IP Discovery
 * 4. Send Select Protocol with discovered IP/port and preferred encryption mode
 * 5. Receive Session Description → get secret key
 * 6. Start receiving encrypted RTP packets, decrypt, demux by SSRC
 *
 * Reconnection:
 * - On gateway close with resumable code (4015, etc.), attempt Resume
 * - On non-resumable close, full reconnect
 */
import type { TransportOptions, TransportState, VoiceTransport } from '../../interfaces/transport';
import { AudioStream } from '../../stream/audio-stream';
import {
  type GatewayReadyPayload,
  type SessionDescriptionPayload,
  type SpeakingPayload,
  VoiceGateway,
} from './gateway';
import { VoiceUdp, rtpHeaderLength } from './udp';

/** Close codes that allow resuming the session. */
const RESUMABLE_CLOSE_CODES = new Set([4015, 4009]);

export class DiscordVoiceSession implements VoiceTransport {
  private gateway = new VoiceGateway();
  private udp = new VoiceUdp();
  private decryptor: SrtpDecryptor | null = null;

  private ssrc = 0;
  private options: TransportOptions | null = null;
  private userId = '';
  private sessionId = '';

  /** SSRC → userId mapping from Speaking events. */
  private ssrcMap = new Map<number, string>();
  /** userId → AudioStream for per-participant streams. */
  private streams = new Map<string, AudioStream>();
  /** State change callbacks. */
  private stateCallbacks = new Set<(state: TransportState) => void>();

  private _state: TransportState = 'disconnected';

  get state(): TransportState {
    return this._state;
  }

  /**
   * Connect to Discord voice.
   * The caller must provide channelId, guildId, token, and endpoint
   * (obtained from Discord Gateway's VOICE_SERVER_UPDATE + VOICE_STATE_UPDATE).
   */
  async connect(options: TransportOptions & { userId?: string; sessionId?: string }): Promise<void> {
    this.options = options;
    this.userId = options.userId ?? '';
    this.sessionId = options.sessionId ?? '';
    this.setState('connecting');

    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      // Step 1: Gateway events
      this.gateway.on('ready', (ready: GatewayReadyPayload) => {
        this.ssrc = ready.ssrc;
        this.handleGatewayReady(ready)
          .then(() => {
            // Wait for session description before resolving
          })
          .catch((err) => {
            if (!resolved) {
              resolved = true;
              reject(err);
            }
          });
      });

      this.gateway.on('sessionDescription', (desc: SessionDescriptionPayload) => {
        this.handleSessionDescription(desc);
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      this.gateway.on('speaking', (s: SpeakingPayload) => {
        this.handleSpeaking(s);
      });

      this.gateway.on('close', (code: number, reason: string) => {
        this.handleGatewayClose(code, reason);
        if (!resolved) {
          resolved = true;
          reject(new Error(`Gateway closed during connect: ${code} ${reason}`));
        }
      });

      // Step 2: Open gateway
      this.gateway.connect({
        endpoint: options.endpoint,
        serverId: options.guildId,
        userId: this.userId,
        sessionId: this.sessionId,
        token: options.token,
      });
    });
  }

  async disconnect(): Promise<void> {
    this.udp.close();
    this.gateway.close(4000);
    for (const stream of this.streams.values()) {
      stream.unsubscribe();
    }
    this.streams.clear();
    this.ssrcMap.clear();
    this.decryptor = null;
    this.setState('disconnected');
  }

  onStateChange(cb: (state: TransportState) => void): void {
    this.stateCallbacks.add(cb);
  }

  getParticipantStream(userId: string): AudioStream | undefined {
    return this.streams.get(userId);
  }

  listParticipants(): string[] {
    return [...this.streams.keys()];
  }

  // ─── internal ───────────────────────────────────────────────

  private setState(state: TransportState): void {
    this._state = state;
    for (const cb of this.stateCallbacks) {
      cb(state);
    }
  }

  /** After Gateway Ready: set up UDP, do IP Discovery, send Select Protocol. */
  private async handleGatewayReady(ready: GatewayReadyPayload): Promise<void> {
    // Create UDP socket
    this.udp.createSocket(ready.ip, ready.port);

    // IP Discovery
    const discovered = await this.udp.performIpDiscovery(ready.ssrc);

    // Pick best encryption mode
    const mode = selectEncryptionMode(ready.modes);

    // Send Select Protocol
    this.gateway.selectProtocol(discovered.ip, discovered.port, mode);
  }

  /** After Session Description: create decryptor, start receive loop. */
  private handleSessionDescription(desc: SessionDescriptionPayload): void {
    const secretKey = new Uint8Array(desc.secret_key);
    const mode = desc.mode as Parameters<typeof selectEncryptionMode>[0] extends string[]
      ? ReturnType<typeof selectEncryptionMode>
      : never;
    this.decryptor = new SrtpDecryptor(secretKey, mode as ReturnType<typeof selectEncryptionMode>);

    // Start listening for UDP packets
    this.udp.on('packet', (pkt) => {
      if (!this.decryptor) return;

      try {
        const headerLen = rtpHeaderLength(
          new Uint8Array([...pkt.headerBytes, ...pkt.payload]).slice(0, pkt.headerBytes.length),
        );
        const rtpHeader = pkt.headerBytes.slice(0, headerLen);
        const decrypted = this.decryptor.decrypt(pkt.payload, rtpHeader);

        // Demux by SSRC → userId
        const mappedUserId = this.ssrcMap.get(pkt.header.ssrc);
        if (!mappedUserId) return;

        const stream = this.streams.get(mappedUserId);
        if (stream) {
          stream.push(decrypted, 'opus');
        }
      } catch {
        // Decryption failures are expected for non-audio packets (e.g., RTCP)
      }
    });

    this.setState('ready');
  }

  /** Map SSRC → userId from Speaking events. Create AudioStream if new. */
  private handleSpeaking(payload: SpeakingPayload): void {
    this.ssrcMap.set(payload.ssrc, payload.user_id);

    if (!this.streams.has(payload.user_id)) {
      const stream = new AudioStream(payload.user_id, payload.ssrc);
      this.streams.set(payload.user_id, stream);
    }
  }

  /** Handle gateway close — attempt resume or full reconnect. */
  private handleGatewayClose(code: number, _reason: string): void {
    if (this._state === 'disconnected') return;

    if (RESUMABLE_CLOSE_CODES.has(code) && this.options) {
      this.setState('reconnecting');
      // Re-open and resume
      this.gateway.connect({
        endpoint: this.options.endpoint,
        serverId: this.options.guildId,
        userId: this.userId,
        sessionId: this.sessionId,
        token: this.options.token,
      });
      this.gateway.on('resumed', () => {
        this.setState('ready');
      });
    } else {
      this.setState('disconnected');
    }
  }
}
