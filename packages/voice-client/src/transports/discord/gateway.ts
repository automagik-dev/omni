/**
 * Discord Voice Gateway v8 WebSocket client with DAVE (E2EE) support.
 *
 * As of March 2026 Discord requires DAVE for all voice connections.
 * v4 is deprecated; v8 is current. DAVE is negotiated via Identify and
 * driven by binary opcodes 25-31.
 *
 * @see https://discord.com/developers/docs/topics/voice-connections
 * @see https://daveprotocol.com/
 */
import { DAVE_PROTOCOL_VERSION } from '../../crypto/dave';

/** Voice Gateway v8 opcodes (client ↔ server). */
export const VoiceOpcode = {
  /** Client → Server: Begin a voice websocket connection */
  Identify: 0,
  /** Client → Server: Select the voice protocol and mode */
  SelectProtocol: 1,
  /** Server → Client: Complete the websocket handshake */
  Ready: 2,
  /** Client → Server: Keep the connection alive */
  Heartbeat: 3,
  /** Server → Client: Describe the session */
  SessionDescription: 4,
  /** Client ↔ Server: Indicate speaking status */
  Speaking: 5,
  /** Server → Client: Heartbeat acknowledged */
  HeartbeatAck: 6,
  /** Client → Server: Resume a connection */
  Resume: 7,
  /** Server → Client: Hello — sent immediately after connecting */
  Hello: 8,
  /** Server → Client: Resume acknowledged */
  Resumed: 9,
  /** Server → Client: A client has disconnected from the voice channel */
  ClientDisconnect: 13,

  // ─── DAVE protocol opcodes (v8) ───────────────────────────────
  /** Server → Client (JSON): DAVE downgrade upcoming, prepare */
  DavePrepareTransition: 21,
  /** Server → Client (JSON): Execute previously prepared transition */
  DaveExecuteTransition: 22,
  /** Client → Server (JSON): ACK: client is ready for transition */
  DaveTransitionReady: 23,
  /** Server → Client (JSON): New epoch/protocol-version change upcoming */
  DavePrepareEpoch: 24,
  /** Server → Client (BINARY): MLS external sender package from server */
  DaveMlsExternalSender: 25,
  /** Client → Server (BINARY): Client's MLS key package */
  DaveMlsKeyPackage: 26,
  /** Server → Client (BINARY): MLS proposals (append/revoke) */
  DaveMlsProposals: 27,
  /** Client → Server (BINARY): Commit+welcome response */
  DaveMlsCommitWelcome: 28,
  /** Server → Client (BINARY): Commit with 2-byte BE transition_id prefix */
  DaveMlsAnnounceCommitTransition: 29,
  /** Server → Client (BINARY): Welcome with 2-byte BE transition_id prefix */
  DaveMlsWelcome: 30,
  /** Client → Server (JSON): Report invalid commit/welcome — triggers reinit */
  DaveMlsInvalidCommitWelcome: 31,
} as const;

export type VoiceOpcodeValue = (typeof VoiceOpcode)[keyof typeof VoiceOpcode];

export type GatewayState = 'idle' | 'connecting' | 'identifying' | 'ready' | 'resuming' | 'disconnected';

export interface GatewayReadyPayload {
  ssrc: number;
  ip: string;
  port: number;
  modes: string[];
}

export interface SessionDescriptionPayload {
  mode: string;
  secret_key: number[];
  dave_protocol_version?: number;
}

export interface SpeakingPayload {
  user_id: string;
  ssrc: number;
  speaking: number;
}

export interface ClientDisconnectPayload {
  user_id: string;
}

export interface GatewayEvents {
  ready: (payload: GatewayReadyPayload) => void;
  sessionDescription: (payload: SessionDescriptionPayload) => void;
  speaking: (payload: SpeakingPayload) => void;
  clientDisconnect: (payload: ClientDisconnectPayload) => void;
  resumed: () => void;
  close: (code: number, reason: string) => void;
  stateChange: (state: GatewayState) => void;
  // DAVE events — payload is the binary blob minus the opcode byte
  daveExternalSender: (payload: Buffer) => void;
  daveProposals: (payload: Buffer) => void;
  daveCommitTransition: (payload: Buffer) => void;
  daveWelcome: (payload: Buffer) => void;
  davePrepareTransition: (d: { transition_id: number; protocol_version: number }) => void;
  daveExecuteTransition: (d: { transition_id: number }) => void;
  davePrepareEpoch: (d: { protocol_version: number; epoch: number }) => void;
}

type EventKey = keyof GatewayEvents;

export class VoiceGateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private heartbeatNonce = 0;
  /** Tracks the last received binary frame sequence number (for seq_ack in heartbeats). */
  private sequence = 0;
  private listeners = new Map<EventKey, Set<GatewayEvents[EventKey]>>();

  private _state: GatewayState = 'idle';
  private serverId = '';
  private userId = '';
  private sessionId = '';
  private token = '';

  get state(): GatewayState {
    return this._state;
  }

  on<K extends EventKey>(event: K, listener: GatewayEvents[K]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off<K extends EventKey>(event: K, listener: GatewayEvents[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit<K extends EventKey>(event: K, ...args: Parameters<GatewayEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as (...a: Parameters<GatewayEvents[K]>) => void)(...args);
    }
  }

  private setState(s: GatewayState): void {
    this._state = s;
    this.emit('stateChange', s);
  }

  /** Open the voice gateway WebSocket and send Identify. */
  connect(opts: { endpoint: string; serverId: string; userId: string; sessionId: string; token: string }): void {
    this.serverId = opts.serverId;
    this.userId = opts.userId;
    this.sessionId = opts.sessionId;
    this.token = opts.token;

    // Voice Gateway v8 — current version, DAVE mandatory as of March 2026.
    const url = `wss://${opts.endpoint}?v=8`;
    this.setState('connecting');

    this.ws = new WebSocket(url);
    // Binary frames arrive as ArrayBuffer in browser/Bun; Node uses Buffer.
    // Set binaryType to 'arraybuffer' so we can parse uniformly.
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('open', () => this.onOpen());
    this.ws.addEventListener('message', (ev) => this.onMessage(ev));
    this.ws.addEventListener('close', (ev) => {
      this.onClose(ev.code, ev.reason);
    });
    this.ws.addEventListener('error', () => {
      /* close event follows */
    });
  }

  /** Send Select Protocol after IP Discovery completes. */
  selectProtocol(ip: string, port: number, mode: string): void {
    this.send(VoiceOpcode.SelectProtocol, {
      protocol: 'udp',
      data: { address: ip, port, mode },
    });
  }

  /** Announce speaking status. */
  setSpeaking(speaking: boolean): void {
    this.send(VoiceOpcode.Speaking, {
      speaking: speaking ? 1 : 0,
      delay: 0,
      ssrc: 0,
    });
  }

  /** Send a DAVE MLS key package (Op 26, binary). */
  sendKeyPackage(keyPackage: Buffer): void {
    this.sendBinary(VoiceOpcode.DaveMlsKeyPackage, keyPackage);
  }

  /** Send a DAVE MLS commit+welcome (Op 28, binary). */
  sendCommitWelcome(payload: Buffer): void {
    this.sendBinary(VoiceOpcode.DaveMlsCommitWelcome, payload);
  }

  /** Send DAVE Transition Ready (Op 23, JSON). */
  sendTransitionReady(transitionId: number): void {
    this.send(VoiceOpcode.DaveTransitionReady, { transition_id: transitionId });
  }

  /** Report an invalid commit/welcome (Op 31, JSON). */
  sendInvalidCommitWelcome(transitionId: number): void {
    this.send(VoiceOpcode.DaveMlsInvalidCommitWelcome, { transition_id: transitionId });
  }

  /** Gracefully close the WebSocket. */
  close(code = 4000): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(code);
      this.ws = null;
    }
    this.setState('disconnected');
  }

  /** Attempt to resume a previous voice session. */
  resume(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.setState('resuming');
    this.send(VoiceOpcode.Resume, {
      server_id: this.serverId,
      session_id: this.sessionId,
      token: this.token,
    });
  }

  // ─── internal ───────────────────────────────────────────────

  private onOpen(): void {
    this.setState('identifying');
    this.send(VoiceOpcode.Identify, {
      server_id: this.serverId,
      user_id: this.userId,
      session_id: this.sessionId,
      token: this.token,
      max_dave_protocol_version: DAVE_PROTOCOL_VERSION,
    });
  }

  private onMessage(ev: MessageEvent): void {
    // v8 binary frames: [seq: u16 BE][op: u8][payload: rest]
    // Per @discordjs/voice VoiceWebSocket.onMessage:
    //   seq = buffer.readUInt16BE(0)
    //   op  = buffer.readUInt8(2)
    //   payload = buffer.subarray(3)
    if (ev.data instanceof ArrayBuffer) {
      const buf = Buffer.from(ev.data);
      if (buf.length < 3) return;
      const seq = buf.readUInt16BE(0);
      const op = buf.readUInt8(2);
      const payload = buf.subarray(3);
      this.sequence = seq;
      this.handleBinaryOp(op, payload);
      return;
    }

    const data = JSON.parse(String(ev.data)) as { op: number; d: unknown };
    this.handleJsonOp(data.op, data.d);
  }

  private handleJsonOp(op: number, d: unknown): void {
    switch (op) {
      case VoiceOpcode.Hello:
        this.startHeartbeat(d as { heartbeat_interval: number });
        break;
      case VoiceOpcode.Ready:
        this.setState('ready');
        this.emit('ready', d as GatewayReadyPayload);
        break;
      case VoiceOpcode.SessionDescription:
        this.emit('sessionDescription', d as SessionDescriptionPayload);
        break;
      case VoiceOpcode.Speaking:
        this.emit('speaking', d as SpeakingPayload);
        break;
      case VoiceOpcode.ClientDisconnect:
        this.emit('clientDisconnect', d as ClientDisconnectPayload);
        break;
      case VoiceOpcode.HeartbeatAck:
        this.heartbeatAcked = true;
        break;
      case VoiceOpcode.Resumed:
        this.setState('ready');
        this.emit('resumed');
        break;
      case VoiceOpcode.DavePrepareTransition:
        this.emit('davePrepareTransition', d as { transition_id: number; protocol_version: number });
        break;
      case VoiceOpcode.DaveExecuteTransition:
        this.emit('daveExecuteTransition', d as { transition_id: number });
        break;
      case VoiceOpcode.DavePrepareEpoch:
        this.emit('davePrepareEpoch', d as { protocol_version: number; epoch: number });
        break;
      default:
        break;
    }
  }

  private handleBinaryOp(op: number, payload: Buffer): void {
    switch (op) {
      case VoiceOpcode.DaveMlsExternalSender:
        this.emit('daveExternalSender', payload);
        break;
      case VoiceOpcode.DaveMlsProposals:
        this.emit('daveProposals', payload);
        break;
      case VoiceOpcode.DaveMlsAnnounceCommitTransition:
        this.emit('daveCommitTransition', payload);
        break;
      case VoiceOpcode.DaveMlsWelcome:
        this.emit('daveWelcome', payload);
        break;
      default:
        break;
    }
  }

  private onClose(code: number, reason: string): void {
    this.stopHeartbeat();
    this.ws = null;
    this.setState('disconnected');
    this.emit('close', code, reason);
  }

  private send(op: VoiceOpcodeValue, d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }

  /**
   * Send a binary frame for a DAVE opcode.
   * Format per @discordjs/voice: [op: u8][payload] — no seq header.
   */
  private sendBinary(op: VoiceOpcodeValue, payload: Buffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const frame = Buffer.concat([new Uint8Array([op]), payload]);
    this.ws.send(frame);
  }

  private startHeartbeat(hello: { heartbeat_interval: number }): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcked) {
        this.close(4009);
        return;
      }
      this.heartbeatAcked = false;
      this.heartbeatNonce = Date.now();
      // v8 heartbeat must include seq_ack (last received binary frame seq)
      this.send(VoiceOpcode.Heartbeat, {
        t: this.heartbeatNonce,
        seq_ack: this.sequence,
      });
    }, hello.heartbeat_interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
