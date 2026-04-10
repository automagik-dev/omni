/**
 * Discord Voice Gateway v4 WebSocket client.
 *
 * Handles the voice WebSocket connection lifecycle:
 * Identify → Ready → Heartbeat loop → Session Description → Speaking events
 *
 * Reference: https://discord.com/developers/docs/topics/voice-connections
 */

/** Voice Gateway v4 opcodes (client ↔ server) */
export const VoiceOpcode = {
  /** Client → Server: Begin a voice websocket connection */
  Identify: 0,
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
  /** Client → Server: Select the voice protocol and mode */
  SelectProtocol: 1,
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
}

export interface SpeakingPayload {
  user_id: string;
  ssrc: number;
  speaking: number;
}

export interface GatewayEvents {
  ready: (payload: GatewayReadyPayload) => void;
  sessionDescription: (payload: SessionDescriptionPayload) => void;
  speaking: (payload: SpeakingPayload) => void;
  resumed: () => void;
  close: (code: number, reason: string) => void;
  stateChange: (state: GatewayState) => void;
}

type EventKey = keyof GatewayEvents;

export class VoiceGateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private heartbeatNonce = 0;
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

    const url = `wss://${opts.endpoint.replace(/:\d+$/, '')}/?v=4`;
    this.setState('connecting');

    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => this.onOpen());
    this.ws.addEventListener('message', (ev) => this.onMessage(ev));
    this.ws.addEventListener('close', (ev) => this.onClose(ev.code, ev.reason));
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
      ssrc: 0, // filled by server from Identify
    });
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
    });
  }

  private onMessage(ev: MessageEvent): void {
    const data = JSON.parse(String(ev.data)) as { op: number; d: unknown };
    switch (data.op) {
      case VoiceOpcode.Hello:
        this.startHeartbeat(data.d as { heartbeat_interval: number });
        break;
      case VoiceOpcode.Ready:
        this.setState('ready');
        this.emit('ready', data.d as GatewayReadyPayload);
        break;
      case VoiceOpcode.SessionDescription:
        this.emit('sessionDescription', data.d as SessionDescriptionPayload);
        break;
      case VoiceOpcode.Speaking:
        this.emit('speaking', data.d as SpeakingPayload);
        break;
      case VoiceOpcode.HeartbeatAck:
        this.heartbeatAcked = true;
        break;
      case VoiceOpcode.Resumed:
        this.setState('ready');
        this.emit('resumed');
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

  private startHeartbeat(hello: { heartbeat_interval: number }): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcked) {
        // Missed ACK — connection is likely dead, reconnect
        this.close(4009);
        return;
      }
      this.heartbeatAcked = false;
      this.heartbeatNonce = Date.now();
      this.send(VoiceOpcode.Heartbeat, this.heartbeatNonce);
    }, hello.heartbeat_interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
