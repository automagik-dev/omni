/**
 * Webchat Channel Plugin — PROTOTYPE (front 3 of the channels study)
 *
 * A chat bubble on a web page talking to Omni. No third-party platform: Omni
 * serves the widget and both ends of the transport.
 *
 *   Browser ──POST  /api/v2/channels/webchat/:instanceId/messages──▶ Omni   (visitor → agent)
 *   Browser ◀──GET  /api/v2/channels/webchat/:instanceId/events──── Omni   (Server-Sent Events: agent → visitor)
 *   Browser ──GET   /api/v2/channels/webchat/:instanceId/widget───▶ Omni   (demo page with the bubble)
 *
 * Transport choice: SSE + POST instead of WebSocket. Everything rides on the
 * generic `handleWebhook(Request): Response` hook, so the server core
 * (Bun.serve upgrade in packages/api/src/index.ts) is untouched. The browser's
 * EventSource reconnects by itself.
 *
 * Voice (echo prototype, ./voice.ts): the browser opens a WebSocket on
 *   /api/v2/channels/webchat/:instanceId/voice?visitorId=…
 * (upgraded in packages/api/src/index.ts, since handleWebhook cannot upgrade).
 * Each socket is a VoiceSession, so the generic voice bridge and voice apps
 * (examples/echo-bot.ts) reach the visitor like any Discord voice channel.
 *
 * Prototype limits (see docs/research/webchat/): in-memory streams and backlog
 * (single process, lost on restart), the visitor id is a bearer secret with no
 * server-side signature, no origin allowlist, no rate limit.
 */

import { BaseChannelPlugin, DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  InstanceConfig,
  OutgoingMessage,
  SendResult,
  VoiceCapable,
  VoiceSession,
} from '@omni/channel-sdk';
import { generateId } from '@omni/core';
import { VisitorIdSchema, type WebchatOutboundEvent, WebchatSendRequestSchema } from './types';
import { type AudioStreamSink, type VoiceSocket, WebchatVoiceSession } from './voice';
import { renderWidgetPage } from './widget';

const WEBCHAT_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendTyping: true,
  events: {
    emits: ['message.received', 'message.sent', 'voice.session_ended', 'voice.session_started'],
    edits: false,
    deletes: false,
    idempotency: false,
  },
};

const ROUTE = /^\/api\/v2\/channels\/webchat\/([0-9a-f-]{36})\/(widget|events|messages)$/;
const HEARTBEAT_MS = 20_000; // Bun.serve idleTimeout is 60s (packages/api/src/index.ts)
const BACKLOG_LIMIT = 50;

type Stream = ReadableStreamDefaultController<Uint8Array>;

const encoder = new TextEncoder();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sseFrame(event: string, data: unknown, id?: string): Uint8Array {
  const idLine = id ? `id: ${id}\n` : '';
  return encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class WebchatChannelPlugin extends BaseChannelPlugin implements VoiceCapable {
  readonly id = 'webchat' as const;
  readonly name = 'Webchat (prototype)';
  readonly version = '0.0.1';
  readonly capabilities = WEBCHAT_CAPABILITIES;

  /** `${instanceId}:${visitorId}` → open SSE streams (one per browser tab). */
  private readonly streams = new Map<string, Set<Stream>>();
  /** Outbound kept per visitor so a reload or a reconnect still shows the replies. */
  private readonly backlog = new Map<string, WebchatOutboundEvent[]>();
  /** Voice sessions by session id (one per open browser voice socket). */
  private readonly voice = new Map<string, WebchatVoiceSession>();
  /** Set by @omni/api at startup (packages/api/src/index.ts wires every voice-capable plugin). */
  public voiceStreamSink: AudioStreamSink | null = null;

  // ─── Lifecycle ────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Webchat ready',
    });
  }

  async disconnect(instanceId: string): Promise<void> {
    for (const [key, set] of this.streams) {
      if (!key.startsWith(`${instanceId}:`)) continue;
      for (const stream of set) this.close(stream);
      this.streams.delete(key);
    }
    for (const session of this.voice.values()) {
      if (session.instanceId === instanceId) await this.endVoice(session, 'manual');
    }
    const entry = this.instances.get(instanceId);
    if (entry) {
      await this.updateInstanceStatus(instanceId, entry.config, { state: 'disconnected', since: new Date() });
    }
  }

  // ─── HTTP entry point (mounted by @omni/api, auth-exempt) ─────

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = ROUTE.exec(url.pathname);
    if (!match) return json({ error: 'Not found' }, 404);
    const [, instanceId = '', action] = match;

    if (this.instances.getStatus(instanceId)?.state !== 'connected') {
      return json({ error: 'Webchat instance not connected' }, 404);
    }

    if (action === 'widget' && request.method === 'GET') {
      return new Response(renderWidgetPage(instanceId), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    if (action === 'events' && request.method === 'GET') {
      return this.openStream(instanceId, url.searchParams.get('visitorId'));
    }
    if (action === 'messages' && request.method === 'POST') {
      return this.receive(instanceId, request);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  // ─── Inbound (visitor → Omni) ─────────────────────────────────

  private async receive(instanceId: string, request: Request): Promise<Response> {
    const body = await request.json().catch(() => undefined);
    const parsed = WebchatSendRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid message', issues: parsed.error.issues.map((i) => i.message) }, 400);
    }
    const { visitorId, name, text } = parsed.data;
    const externalId = `webchat-${generateId()}`;
    await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId: visitorId,
      from: visitorId,
      senderName: name,
      chatName: name,
      content: { type: 'text', text },
      rawPayload: { webchat: true, userAgent: request.headers.get('user-agent') },
    });
    return json({ id: externalId, at: Date.now() }, 202);
  }

  // ─── Outbound (Omni → visitor) ────────────────────────────────

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const chatId = message.to;
    const text = message.content.text ?? message.content.caption ?? '';
    const event: WebchatOutboundEvent = { id: `webchat-${generateId()}`, text, at: Date.now() };

    const key = `${instanceId}:${chatId}`;
    const kept = [...(this.backlog.get(key) ?? []), event].slice(-BACKLOG_LIMIT);
    this.backlog.set(key, kept);
    const delivered = this.push(key, sseFrame('message', event, event.id));

    await this.emitMessageSent({
      instanceId,
      externalId: event.id,
      chatId,
      to: chatId,
      content: { type: 'text', text },
      replyToId: message.replyTo,
      rawPayload: { webchat: true, openStreams: delivered },
    });
    // Offline visitors still get it from the backlog when they reconnect.
    return { success: true, messageId: event.id, timestamp: event.at };
  }

  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    this.push(`${instanceId}:${chatId}`, sseFrame('typing', { on: duration !== 0 }));
  }

  // ─── Voice (VoiceCapable + browser socket) ────────────────────

  /**
   * Called by the API's WebSocket `open` handler. Returns the new session, or
   * null when the instance or visitor is invalid (the socket is closed here).
   */
  async voiceSocketOpen(socket: VoiceSocket, instanceId: string, rawVisitorId: string | null): Promise<string | null> {
    const visitor = VisitorIdSchema.safeParse(rawVisitorId);
    if (this.instances.getStatus(instanceId)?.state !== 'connected' || !visitor.success) {
      socket.close(4004, 'Unknown webchat instance or visitor');
      return null;
    }
    const session = new WebchatVoiceSession(
      `webchat-voice-${generateId()}`,
      instanceId,
      visitor.data,
      socket,
      () => this.voiceStreamSink,
    );
    this.voice.set(session.id, session);
    session.notify({ type: 'session_ready', sessionId: session.id });
    this.logger.info('Webchat voice session started', { sessionId: session.id, instanceId, visitorId: visitor.data });
    await this.eventBus
      .publish('voice.session_started', { sessionId: session.id, channelId: visitor.data, instanceId })
      .catch(() => {});
    return session.id;
  }

  voiceSocketMessage(sessionId: string, data: string | Uint8Array): void {
    if (typeof data === 'string') return; // no browser control messages yet
    this.voice.get(sessionId)?.receiveFromBrowser(data);
  }

  async voiceSocketClose(sessionId: string): Promise<void> {
    const session = this.voice.get(sessionId);
    if (session) await this.endVoice(session, 'disconnected');
  }

  /** Voice sessions start from the browser; join only finds the visitor's open one. */
  async voiceJoin(channelId: string, opts?: Record<string, unknown>): Promise<VoiceSession> {
    for (const session of this.voice.values()) {
      if (session.channelId === channelId && (!opts?.instanceId || session.instanceId === opts.instanceId)) {
        return session;
      }
    }
    throw new Error('No open webchat voice session for this visitor; the visitor starts it from the widget');
  }

  async voiceLeave(sessionId: string): Promise<void> {
    const session = this.voice.get(sessionId);
    if (session) await this.endVoice(session, 'manual');
  }

  voiceSessions(): VoiceSession[] {
    return [...this.voice.values()];
  }

  voiceSession(sessionId: string): VoiceSession | undefined {
    return this.voice.get(sessionId);
  }

  private async endVoice(session: WebchatVoiceSession, reason: 'disconnected' | 'manual'): Promise<void> {
    this.voice.delete(session.id);
    session.end(reason);
    this.voiceStreamSink?.broadcast(session.id, { type: 'participant_left', userId: session.channelId });
    this.logger.info('Webchat voice session ended', { sessionId: session.id, reason });
    await this.eventBus.publish('voice.session_ended', { sessionId: session.id, reason }).catch(() => {});
  }

  // ─── SSE plumbing ─────────────────────────────────────────────

  private openStream(instanceId: string, rawVisitorId: string | null): Response {
    const visitor = VisitorIdSchema.safeParse(rawVisitorId);
    if (!visitor.success) return json({ error: 'visitorId required' }, 400);
    const key = `${instanceId}:${visitor.data}`;
    let controller: Stream | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const body = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        const set = this.streams.get(key) ?? new Set<Stream>();
        set.add(c);
        this.streams.set(key, set);
        c.enqueue(sseFrame('ready', { visitorId: visitor.data }));
        for (const past of this.backlog.get(key) ?? []) c.enqueue(sseFrame('message', past, past.id));
        heartbeat = setInterval(() => {
          try {
            c.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            clearInterval(heartbeat);
          }
        }, HEARTBEAT_MS);
      },
      cancel: () => {
        clearInterval(heartbeat);
        if (controller) this.streams.get(key)?.delete(controller);
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  /** Write a frame to every open stream of one visitor. Returns how many got it. */
  private push(key: string, frame: Uint8Array): number {
    const set = this.streams.get(key);
    if (!set) return 0;
    let delivered = 0;
    for (const stream of set) {
      try {
        stream.enqueue(frame);
        delivered++;
      } catch {
        set.delete(stream);
      }
    }
    return delivered;
  }

  private close(stream: Stream): void {
    try {
      stream.close();
    } catch {
      // already closed
    }
  }
}
