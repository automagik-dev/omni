import { SrtpDecryptor, selectEncryptionMode } from '../../crypto/srtp';
/**
 * DiscordVoiceSession — orchestrates Gateway + UDP + SRTP + Receiver.
 *
 * Connection flow:
 * 1. Open Voice Gateway WebSocket, send Identify
 * 2. Receive Ready → get SSRC, UDP IP/port, encryption modes
 * 3. Create UDP socket, perform IP Discovery
 * 4. Send Select Protocol with discovered IP/port and preferred encryption mode
 * 5. Receive Session Description → get secret key
 * 6. Start receiving encrypted RTP packets, decrypt, demux by SSRC via PacketReceiver
 *
 * Reconnection:
 * - On gateway close with resumable code (4015, etc.), attempt Resume
 * - On non-resumable close, full reconnect
 */
import type { TransportOptions, TransportState, VoiceTransport } from '../../interfaces/transport';
import type { AudioStream } from '../../stream/audio-stream';
import {
  type GatewayReadyPayload,
  type SessionDescriptionPayload,
  type SpeakingPayload,
  VoiceGateway,
} from './gateway';
import { PacketReceiver, type ReceiverEvents } from './receiver';
import { VoiceUdp, rtpHeaderLength } from './udp';

/** Close codes that allow resuming the session. */
const RESUMABLE_CLOSE_CODES = new Set([4015, 4009]);

export class DiscordVoiceSession implements VoiceTransport {
  private gateway = new VoiceGateway();
  private udp = new VoiceUdp();
  private receiver = new PacketReceiver();
  private decryptor: SrtpDecryptor | null = null;

  private ssrc = 0;
  private options: TransportOptions | null = null;
  private userId = '';
  private sessionId = '';

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
        this.receiver.handleSpeaking(s.user_id, s.ssrc, s.speaking);
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
    this.receiver.destroy();
    this.decryptor = null;
    this.setState('disconnected');
  }

  onStateChange(cb: (state: TransportState) => void): void {
    this.stateCallbacks.add(cb);
  }

  getParticipantStream(userId: string): AudioStream | undefined {
    return this.receiver.getStream(userId);
  }

  listParticipants(): string[] {
    return this.receiver.listParticipants();
  }

  /** Subscribe to participant join/leave/speaking events from the receiver. */
  onParticipantEvent<K extends keyof ReceiverEvents>(event: K, listener: ReceiverEvents[K]): void {
    this.receiver.on(event, listener);
  }

  /** Unsubscribe from participant events. */
  offParticipantEvent<K extends keyof ReceiverEvents>(event: K, listener: ReceiverEvents[K]): void {
    this.receiver.off(event, listener);
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
    this.udp.createSocket(ready.ip, ready.port);
    const discovered = await this.udp.performIpDiscovery(ready.ssrc);
    const mode = selectEncryptionMode(ready.modes);
    this.gateway.selectProtocol(discovered.ip, discovered.port, mode);
  }

  /** After Session Description: create decryptor, start receive loop. */
  private handleSessionDescription(desc: SessionDescriptionPayload): void {
    const secretKey = new Uint8Array(desc.secret_key);
    this.decryptor = new SrtpDecryptor(secretKey, desc.mode as ReturnType<typeof selectEncryptionMode>);

    // Route decrypted packets through the receiver
    this.udp.on('packet', (pkt) => {
      if (!this.decryptor) return;

      try {
        const headerLen = rtpHeaderLength(pkt.headerBytes);
        const rtpHeader = pkt.headerBytes.slice(0, headerLen);
        const decrypted = this.decryptor.decrypt(pkt.payload, rtpHeader);
        this.receiver.receivePacket(pkt.header.ssrc, decrypted);
      } catch {
        // Decryption failures expected for non-audio packets (RTCP, etc.)
      }
    });

    this.setState('ready');
  }

  /** Handle gateway close — attempt resume or full reconnect. */
  private handleGatewayClose(code: number, _reason: string): void {
    if (this._state === 'disconnected') return;

    if (RESUMABLE_CLOSE_CODES.has(code) && this.options) {
      this.setState('reconnecting');
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
