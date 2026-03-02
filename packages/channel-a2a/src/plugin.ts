/**
 * A2A Channel Plugin
 *
 * Exposes Omni instances as A2A-compatible agents:
 * - GET  /.well-known/agent.json?instanceId={id}  → Agent Card
 * - POST /a2a/{instanceId}                        → JSON-RPC (message/send, message/stream)
 *
 * sendMessage() is called by the dispatcher's sendResponseParts() when
 * channel === 'a2a'. It writes the response part to the pending SSE stream
 * so the A2A client receives streaming artifact events.
 */

import { BaseChannelPlugin, DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';
import type { InstanceConfig } from '@omni/channel-sdk';
import type { OutgoingMessage, SendResult } from '@omni/channel-sdk';

import { handleA2ARequest } from './a2a-handler';
import { buildAgentCard } from './agent-card';
import { A2AStreamStore } from './stream-store';

const A2A_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
};

export class A2AChannelPlugin extends BaseChannelPlugin {
  readonly id = 'a2a' as const;
  readonly name = 'A2A Protocol Server';
  readonly version = '0.1.0';
  readonly capabilities = A2A_CAPABILITIES;

  private readonly streamStore = new A2AStreamStore();

  // ─── Lifecycle ────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'A2A channel ready',
    });
    await this.emitInstanceConnected(instanceId, {});
  }

  async disconnect(instanceId: string): Promise<void> {
    const entry = this.instances.get(instanceId);
    if (entry) {
      await this.updateInstanceStatus(instanceId, entry.config, {
        state: 'disconnected',
        since: new Date(),
      });
    }
    await this.emitInstanceDisconnected(instanceId, 'disconnect requested');
  }

  // ─── Messaging ────────────────────────────────────────────────

  /**
   * Called by dispatcher's sendResponseParts() when the response channel is 'a2a'.
   * Writes the text part to the pending SSE stream keyed by (instanceId, message.to).
   * message.to = chatId = taskId (set in the message.received event by a2a-handler).
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const taskId = message.to;
    const text = message.content.text ?? '';

    if (text && this.streamStore.hasStream(instanceId, taskId)) {
      this.streamStore.writePart(instanceId, taskId, text);
    }

    return { success: true, timestamp: Date.now() };
  }

  /**
   * Called by dispatcher after sendResponseParts completes (duration=0 → 'paused').
   * Closes the A2A stream with 'completed' so the client gets a terminal event
   * instead of waiting for the 30s idle timeout.
   */
  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    if (duration === 0 && this.streamStore.hasStream(instanceId, chatId)) {
      this.streamStore.closeStream(instanceId, chatId, 'completed');
    }
  }

  // ─── Webhook ──────────────────────────────────────────────────

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Agent Card: GET /.well-known/agent.json?instanceId={id}
    if (pathname.endsWith('/.well-known/agent.json') || pathname === '/.well-known/agent.json') {
      return this.handleAgentCardRequest(url);
    }

    // A2A JSON-RPC: POST /a2a/{instanceId}
    const a2aMatch = /\/a2a\/([^/]+)\/?$/.exec(pathname);
    if (a2aMatch?.[1] && request.method === 'POST') {
      const instanceId = a2aMatch[1];
      return handleA2ARequest(request, {
        instanceId,
        eventBus: this.eventBus,
        streamStore: this.streamStore,
        channelType: 'a2a',
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ─── Private ──────────────────────────────────────────────────

  private handleAgentCardRequest(url: URL): Response {
    const instanceId = url.searchParams.get('instanceId');
    if (!instanceId) {
      return new Response(JSON.stringify({ error: 'instanceId query parameter required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = `${url.protocol}//${url.host}`;
    const card = buildAgentCard({
      instanceId,
      instanceName: instanceId,
      agentName: 'Omni Agent',
      capabilities: [],
      agentCardOverride: null,
      baseUrl,
    });

    return new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
