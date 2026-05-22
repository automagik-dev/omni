/**
 * A2A Channel Plugin
 *
 * Exposes Omni instances as A2A-compatible agents:
 * - GET  /.well-known/agent-card.json?instanceId={id} → Agent Card
 * - POST /a2a/{instanceId}                           → JSON-RPC A2A v1
 *
 * sendMessage() is called by the dispatcher's sendResponseParts() when
 * channel === 'a2a'. It writes the response part to the pending SSE stream
 * so the A2A client receives streaming artifact events.
 */

import { BaseChannelPlugin, DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';
import type { InstanceConfig, PluginContext } from '@omni/channel-sdk';
import type { OutgoingMessage, SendResult } from '@omni/channel-sdk';

import { handleA2ARequest } from './a2a-handler';
import { buildAgentCard } from './agent-card';
import { A2AStreamStore } from './stream-store';
import { A2ATaskStore } from './task-store';

const A2A_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
};

export class A2AChannelPlugin extends BaseChannelPlugin {
  readonly id = 'a2a' as const;
  readonly name = 'A2A Protocol Server';
  readonly version = '0.1.0';
  readonly capabilities = A2A_CAPABILITIES;

  private readonly taskStore = new A2ATaskStore();
  private readonly streamStore = new A2AStreamStore((instanceId, taskId, state) => {
    void this.taskStore.updateStatus(instanceId, taskId, state).catch(() => {});
  });

  // ─── Lifecycle ────────────────────────────────────────────────

  protected override async onInitialize(context: PluginContext): Promise<void> {
    this.taskStore.setStorage(context.storage);
  }

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

    if (text) {
      await this.taskStore.appendArtifact(instanceId, taskId, text);
      if (this.streamStore.hasStream(instanceId, taskId)) {
        this.streamStore.writePart(instanceId, taskId, text);
      }
    }

    return { success: true, timestamp: Date.now() };
  }

  /**
   * Called by dispatcher after sendResponseParts completes (duration=0 → 'paused').
   * Closes the A2A stream with TASK_STATE_COMPLETED so the client gets a terminal event
   * instead of waiting for the 30s idle timeout.
   */
  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    if (duration === 0) {
      await this.taskStore.updateStatus(instanceId, chatId, 'TASK_STATE_COMPLETED');
      if (this.streamStore.hasStream(instanceId, chatId)) {
        this.streamStore.closeStream(instanceId, chatId, 'TASK_STATE_COMPLETED');
      }
    }
  }

  // ─── Journey Timing (public wrappers for a2a-handler) ────────

  /** Public wrapper for journey timing — used by a2a-handler */
  inboundTimings(platformTimestamp: number) {
    return this.captureInboundTimings(platformTimestamp);
  }

  /** Public wrapper for journey timing — used by a2a-handler */
  recordT2(correlationId: string, timings: Record<string, number>) {
    this.captureT2(correlationId, timings);
  }

  // ─── Webhook ──────────────────────────────────────────────────

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Agent Card: GET /.well-known/agent-card.json?instanceId={id}
    if (
      pathname.endsWith('/.well-known/agent-card.json') ||
      pathname === '/.well-known/agent-card.json' ||
      pathname.endsWith('/.well-known/agent.json') ||
      pathname === '/.well-known/agent.json'
    ) {
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
        taskStore: this.taskStore,
        channelType: 'a2a',
        plugin: this,
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
      extended: false,
    });

    return new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
