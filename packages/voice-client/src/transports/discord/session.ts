import { DaveManager } from '../../crypto/dave';
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
import { VoiceUdp } from './udp';

/** Close codes that allow resuming the session. */
const RESUMABLE_CLOSE_CODES = new Set([4015, 4009]);

export class DiscordVoiceSession implements VoiceTransport {
  private gateway = new VoiceGateway();
  private udp = new VoiceUdp();
  private receiver = new PacketReceiver();
  private decryptor: SrtpDecryptor | null = null;
  private dave = new DaveManager();
  private channelId = '';

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
  async connect(
    options: TransportOptions & { userId?: string; sessionId?: string; recognizedUserIds?: string[] },
  ): Promise<void> {
    this.options = options;
    this.userId = options.userId ?? '';
    this.sessionId = options.sessionId ?? '';
    this.channelId = options.channelId;
    this.setState('connecting');

    // Seed DAVE with users already in the voice channel.
    if (options.recognizedUserIds) {
      for (const id of options.recognizedUserIds) {
        this.dave.addRecognizedUser(id);
      }
    }

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
        this.dave.addRecognizedUser(s.user_id);
      });

      this.gateway.on('clientDisconnect', (d) => {
        this.dave.removeRecognizedUser(d.user_id);
      });

      // ─── DAVE protocol handlers ───────────────────────────────
      this.gateway.on('daveExternalSender', (payload) => {
        try {
          this.dave.setExternalSender(payload);
        } catch (_err) {}
      });

      this.gateway.on('daveProposals', (payload) => {
        try {
          const commitWelcome = this.dave.processProposals(payload);
          if (commitWelcome) {
            this.gateway.sendCommitWelcome(commitWelcome);
          }
        } catch (_err) {
          this.gateway.sendInvalidCommitWelcome(0);
        }
      });

      this.gateway.on('daveCommitTransition', (payload) => {
        try {
          const transitionId = this.dave.processCommit(payload);
          if (transitionId > 0) {
            this.gateway.sendTransitionReady(transitionId);
          }
        } catch (_err) {
          this.gateway.sendInvalidCommitWelcome(0);
        }
      });

      this.gateway.on('daveWelcome', (payload) => {
        try {
          const transitionId = this.dave.processWelcome(payload);
          if (transitionId > 0) {
            this.gateway.sendTransitionReady(transitionId);
          }
        } catch (_err) {
          this.gateway.sendInvalidCommitWelcome(0);
        }
      });

      this.gateway.on('davePrepareTransition', (d) => {
        if (d.protocol_version === 0) {
          // Downgrade to non-DAVE — enable passthrough
          this.dave.setPassthroughMode(true, 24);
        }
        if (d.transition_id > 0) {
          this.gateway.sendTransitionReady(d.transition_id);
        }
      });

      this.gateway.on('daveExecuteTransition', (_d) => {});

      this.gateway.on('davePrepareEpoch', (d) => {
        // New epoch may require reinit with new protocol version
        if (d.epoch === 1) {
          try {
            const keyPackage = this.dave.reinit(d.protocol_version, this.userId, this.channelId);
            this.gateway.sendKeyPackage(keyPackage);
          } catch (_err) {}
        }
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
    this.dave.destroy();
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

  /** After Session Description: create SRTP decryptor, init DAVE if required, start receive loop. */
  private handleSessionDescription(desc: SessionDescriptionPayload): void {
    const secretKey = new Uint8Array(desc.secret_key);
    this.decryptor = new SrtpDecryptor(secretKey, desc.mode as ReturnType<typeof selectEncryptionMode>);

    // Initialize DAVE if the server says this session uses E2EE
    if (desc.dave_protocol_version && desc.dave_protocol_version >= 1) {
      try {
        const keyPackage = this.dave.init(desc.dave_protocol_version, this.userId, this.channelId);
        this.gateway.sendKeyPackage(keyPackage);
      } catch (_err) {}
    }

    // Route decrypted packets through the receiver.
    // SRTP decrypt operates on the FULL raw UDP buffer (not the split header/payload)
    // per @discordjs/voice's approach.
    this.udp.onRawPacket((msg: Buffer) => this.handleUdpPacket(msg));

    // Announce we're "speaking" so Discord sends us other users' audio.
    this.gateway.setSpeaking(true);

    // Send 5 silence frames via UDP to prove we're alive on the audio channel.
    // Discord won't forward other users' audio until we demonstrate UDP connectivity.
    // Opus silence frame: [0xF8, 0xFF, 0xFE]
    const SILENCE_FRAME = new Uint8Array([0xf8, 0xff, 0xfe]);
    const RTP_HEADER_SIZE = 12;
    let seq = 0;
    let timestamp = 0;
    for (let i = 0; i < 5; i++) {
      const rtpPacket = Buffer.alloc(RTP_HEADER_SIZE + SILENCE_FRAME.length);
      rtpPacket[0] = 0x80; // version 2
      rtpPacket[1] = 0x78; // payload type 120 (Opus)
      rtpPacket.writeUInt16BE(seq++, 2);
      rtpPacket.writeUInt32BE(timestamp, 4);
      timestamp += 960; // 20ms at 48kHz
      rtpPacket.writeUInt32BE(this.ssrc, 8);
      SILENCE_FRAME.forEach((b, idx) => {
        rtpPacket[RTP_HEADER_SIZE + idx] = b;
      });
      this.udp.send(rtpPacket);
    }

    this.setState('ready');
  }

  /** Decrypt and route a raw UDP packet through SRTP → DAVE → receiver. */
  private handleUdpPacket(msg: Buffer): void {
    if (msg.length <= 8 || !this.decryptor) return;
    const NONCE_LEN = 4;
    const TAG_LEN = 16;

    try {
      const ssrc = msg.readUInt32BE(8);
      const nonce = Buffer.alloc(24);
      msg.copy(nonce, 0, msg.length - NONCE_LEN);

      const firstByte = msg.readUInt8(0);
      let headerSize = 12;
      if ((firstByte >> 4) & 1) headerSize += 4;
      const header = msg.subarray(0, headerSize);

      const encrypted = msg.subarray(headerSize, msg.length - TAG_LEN - NONCE_LEN);
      const authTag = msg.subarray(msg.length - TAG_LEN - NONCE_LEN, msg.length - NONCE_LEN);
      const cipherWithTag = Buffer.concat([encrypted, authTag]);
      let decrypted = Buffer.from(this.decryptor.decryptRaw(cipherWithTag, header, nonce));

      if ((firstByte >> 4) & 1) {
        const extLen = msg.readUInt16BE(14);
        decrypted = decrypted.subarray(4 * extLen);
      }

      if (this.dave.ready) {
        const userId = this.receiver.getUserForSsrc(ssrc);
        if (userId) {
          const daveResult = this.dave.decryptAudio(userId, decrypted);
          if (daveResult) {
            decrypted = daveResult;
          } else if (!this.dave.canPassthrough(userId)) {
            return;
          }
        }
      }

      this.receiver.receivePacket(ssrc, new Uint8Array(decrypted));
    } catch {
      // Keepalive/RTCP packets fail decrypt — expected
    }
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
