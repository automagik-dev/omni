/**
 * OpenClaw Gateway WebSocket Client (Server-Side)
 *
 * Adapted from genie-os reference for server-side Omni dispatch.
 * Changes from reference (DEC-7):
 * - Uses crypto.randomUUID() instead of browser fallback
 * - Sets platform: 'omni', mode: 'backend', client.id: 'gateway-client'
 * - Minimum scopes: ['chat.send'] only (DEC-8)
 * - Health ping every 30s (DEC-11)
 * - Reconnect log escalation (WARN→INFO→DEBUG→periodic WARN)
 * - ws:// warning for non-localhost (RISK-5)
 * - Log redaction: gateway token never appears in logs (DEC-15)
 */

import { createLogger } from '../../logger';
import type {
  ChatEvent,
  ChatSendParams,
  ChatSendResult,
  ConnectParams,
  ConnectionState,
  EventFrame,
  EventListener,
  HelloPayload,
  OpenClawClientConfig,
  ReqFrame,
  ResFrame,
} from './types';

const log = createLogger('openclaw:client');

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  method: string;
}

/** Callback for runId-based accumulation (DEC-5: O(1) lookup) */
export type AccumulationCallback = (event: ChatEvent) => void;

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventListeners = new Set<EventListener>();
  /** DEC-5: O(1) runId-based event routing for accumulation */
  private accumulationCallbacks = new Map<string, AccumulationCallback>();
  private closed = false;
  private backoffMs = 800;
  private connectSent = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthPingTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: ConnectionState = 'disconnected';
  private reconnectAttempt = 0;
  private readonly config: OpenClawClientConfig;

  constructor(config: OpenClawClientConfig) {
    this.config = config;

    // DEC-15 / RISK-5: Warn on unencrypted WS for non-localhost
    if (config.url.startsWith('ws://')) {
      const urlObj = new URL(config.url);
      const host = urlObj.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
        log.warn('Connecting over unencrypted WebSocket to non-localhost', {
          providerId: config.providerId,
          host,
        });
      }
    }
  }

  get state(): ConnectionState {
    return this._state;
  }

  get connected(): boolean {
    return this._state === 'connected';
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  get activeAccumulations(): number {
    return this.accumulationCallbacks.size;
  }

  /** Start the WebSocket connection (DEC-14: lazy, non-blocking) */
  start(): void {
    this.closed = false;
    this.doConnect();
  }

  /** Stop the client and close connection */
  stop(): void {
    this.closed = true;
    this.stopHealthPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000, 'client stopped');
    this.ws = null;
    this.flushPending(new Error('Client stopped'));
    this.flushAccumulations(new Error('Client stopped'));
    this.setState('disconnected');
    log.info('Client stopped', {
      providerId: this.config.providerId,
      pendingRequests: this.pending.size,
    });
  }

  /** Register a runId-based accumulation callback (DEC-5: O(1) lookup) */
  registerAccumulation(runId: string, callback: AccumulationCallback): void {
    if (this.accumulationCallbacks.size >= 50) {
      throw new Error('Max concurrent accumulations (50) reached — backpressure');
    }
    this.accumulationCallbacks.set(runId, callback);
  }

  /** Unregister a runId-based accumulation callback */
  unregisterAccumulation(runId: string): void {
    this.accumulationCallbacks.delete(runId);
  }

  /** Add a raw event listener */
  addEventListener(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Send a request and await response */
  async request<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = crypto.randomUUID();
    const frame: ReqFrame = { type: 'req', id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        timeout,
        method,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  /** Send a chat.send request */
  async chatSend(params: ChatSendParams, timeoutMs?: number): Promise<ChatSendResult> {
    return this.request<ChatSendResult>('chat.send', params as unknown as Record<string, unknown>, timeoutMs);
  }

  /** Delete/reset an OpenClaw session */
  async deleteSession(sessionKey: string): Promise<void> {
    await this.request('sessions.delete', { sessionKey });
  }

  /** Wait for connection to be ready (for lazy connect) */
  async waitForReady(timeoutMs = 10_000): Promise<void> {
    if (this.connected) return;
    if (this.closed) throw new Error('Client is stopped');

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Connection not ready within ${timeoutMs}ms`));
      }, timeoutMs);

      const check = () => {
        if (this.connected) {
          cleanup();
          resolve();
        } else if (this.closed) {
          cleanup();
          reject(new Error('Client stopped while waiting for connection'));
        }
      };

      const interval = setInterval(check, 100);
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(interval);
      };

      // Check immediately
      check();
    });
  }

  // === Private ===

  private doConnect(): void {
    if (this.closed) return;

    this.setState(this._state === 'disconnected' ? 'connecting' : 'reconnecting');

    try {
      // TODO: config.origin is accepted but not transmitted — standard WebSocket API
      // doesn't support custom headers. Bun's WebSocket follows the spec.
      // For Origin enforcement, the gateway should validate the connect challenge token instead.
      this.ws = new WebSocket(this.config.url);
    } catch (err) {
      log.error('WebSocket construction failed', {
        providerId: this.config.providerId,
        error: String(err),
      });
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      this.connectSent = false;
    });

    this.ws.addEventListener('message', (ev) => {
      this.handleMessage(String(ev.data ?? ''));
    });

    this.ws.addEventListener('close', (ev) => {
      this.ws = null;
      this.stopHealthPing();
      this.flushPending(new Error(`Connection closed (${ev.code}): ${ev.reason || 'no reason'}`));
      if (!this.closed) {
        this.logReconnect(ev.code, ev.reason);
        this.scheduleReconnect();
      } else {
        this.setState('disconnected');
      }
    });

    this.ws.addEventListener('error', () => {
      // Error is followed by close event, which handles reconnection
    });
  }

  private handleMessage(data: string): void {
    let frame: ReqFrame | ResFrame | EventFrame;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }

    if (!frame || typeof frame !== 'object') return;

    // Handle events
    if ('type' in frame && frame.type === 'event') {
      const event = frame as EventFrame;

      // Handle connect challenge
      if (event.event === 'connect.challenge') {
        this.sendConnect();
        return;
      }

      // DEC-5: Route chat events by runId (O(1) lookup)
      if (event.event === 'chat' && event.payload) {
        const chatEvent = event.payload as ChatEvent;
        if (chatEvent.runId) {
          const callback = this.accumulationCallbacks.get(chatEvent.runId);
          if (callback) {
            try {
              callback(chatEvent);
            } catch (err) {
              log.error('Accumulation callback error', {
                providerId: this.config.providerId,
                runId: chatEvent.runId,
                error: String(err),
              });
            }
          }
        }
      }

      // Emit to generic listeners
      for (const listener of this.eventListeners) {
        try {
          listener(event);
        } catch (err) {
          log.error('Event listener error', {
            providerId: this.config.providerId,
            event: event.event,
            error: String(err),
          });
        }
      }
      return;
    }

    // Handle responses
    if ('type' in frame && frame.type === 'res') {
      const res = frame as ResFrame;
      const pending = this.pending.get(res.id);
      if (!pending) return;

      this.pending.delete(res.id);
      clearTimeout(pending.timeout);

      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(new Error(res.error?.message ?? `Request ${pending.method} failed`));
      }
    }
  }

  private async sendConnect(): Promise<void> {
    if (this.connectSent || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.connectSent = true;

    // DEC-7: Server-side params, DEC-8: minimum scopes
    const params: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client',
        version: '1.0.0',
        platform: 'omni',
        mode: 'backend',
      },
      role: 'client',
      scopes: ['chat.send'],
      caps: [],
      auth: this.config.token ? { token: this.config.token } : undefined,
      locale: 'en-US',
      userAgent: 'omni-v2/1.0.0',
    };

    // DEC-15: Log connect frame with redacted auth
    log.debug('Sending connect handshake', {
      providerId: this.config.providerId,
      auth: params.auth ? { token: '[REDACTED]' } : undefined,
      scopes: params.scopes,
      mode: params.client.mode,
    });

    try {
      const payload = await this.request<HelloPayload>('connect', params as unknown as Record<string, unknown>);
      this.backoffMs = 800;
      this.reconnectAttempt = 0;
      this.setState('connected');
      this.startHealthPing();
      log.info('Connected to OpenClaw gateway', {
        providerId: this.config.providerId,
        protocol: payload.protocol,
        defaultAgentId: payload.snapshot?.sessionDefaults?.defaultAgentId,
      });
    } catch (err) {
      log.error('Connect handshake failed', {
        providerId: this.config.providerId,
        error: String(err),
      });
      this.ws?.close(4008, 'connect failed');
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.setState('reconnecting');

    const delay = this.backoffMs + Math.random() * 200; // jitter
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  /** Reconnect log escalation: WARN first 3, INFO next 7, DEBUG after, periodic WARN every 10th */
  private logReconnect(code: number, reason: string): void {
    const ctx = {
      providerId: this.config.providerId,
      reconnectAttempt: this.reconnectAttempt,
      code,
      reason: reason || 'no reason',
      backoffMs: Math.round(this.backoffMs),
    };

    if (this.reconnectAttempt < 3) {
      log.warn('Connection lost, reconnecting', ctx);
    } else if (this.reconnectAttempt % 10 === 0) {
      log.warn('Still reconnecting (periodic)', ctx);
    } else if (this.reconnectAttempt < 10) {
      log.info('Reconnecting', ctx);
    } else {
      log.debug('Reconnecting', ctx);
    }
  }

  private startHealthPing(): void {
    this.stopHealthPing();
    this.healthPingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.request('health')
          .then(() => {
            /* healthy */
          })
          .catch(() => {
            log.warn('Health ping failed, connection may be stale', {
              providerId: this.config.providerId,
            });
            // Note: health ping failures NOT counted by circuit breaker (DEC-11)
          });
      }
    }, 30_000);
  }

  private stopHealthPing(): void {
    if (this.healthPingTimer) {
      clearInterval(this.healthPingTimer);
      this.healthPingTimer = null;
    }
  }

  private flushPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private flushAccumulations(error: Error): void {
    for (const [runId, callback] of this.accumulationCallbacks) {
      try {
        callback({
          state: 'error',
          sessionKey: '',
          runId,
          errorMessage: error.message,
        });
      } catch {
        // ignore
      }
    }
    this.accumulationCallbacks.clear();
  }

  private setState(newState: ConnectionState): void {
    if (this._state !== newState) {
      this._state = newState;
    }
  }
}
