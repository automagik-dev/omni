/**
 * Internal Channel Plugin
 *
 * Provides agent-to-agent routing within Omni.
 * When the dispatcher's T10 chain logic calls sendMessage(), this plugin
 * re-emits the content as a new message.received event on the target instance,
 * causing the target instance's agent to process it.
 *
 * No external transport — purely in-process event re-emission.
 */

import { BaseChannelPlugin, DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';
import type { InstanceConfig } from '@omni/channel-sdk';
import type { OutgoingMessage, SendResult } from '@omni/channel-sdk';
import { createLogger, generateId } from '@omni/core';

const MAX_HOP_LIMIT = 5;
const log = createLogger('channel:internal');

const INTERNAL_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
};

export class InternalChannelPlugin extends BaseChannelPlugin {
  readonly id = 'internal' as const;
  readonly name = 'Internal Agent Routing';
  readonly version = '0.1.0';
  readonly capabilities = INTERNAL_CAPABILITIES;

  // ─── Lifecycle ────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Internal channel ready',
    });
  }

  async disconnect(instanceId: string): Promise<void> {
    const entry = this.instances.get(instanceId);
    if (entry) {
      await this.updateInstanceStatus(instanceId, entry.config, {
        state: 'disconnected',
        since: new Date(),
      });
    }
  }

  // ─── Messaging ────────────────────────────────────────────────

  /**
   * Re-emit the message as a new message.received event on the target instance.
   *
   * Called by the dispatcher's T10 chain logic:
   *   internalPlugin.sendMessage(targetInstanceId, {
   *     to: targetInstanceId,
   *     content: { type: 'text', text: agentResponsePart },
   *     metadata: { sourceInstanceId, chainMode },
   *   })
   *
   * The target instance's dispatcher then picks up the event and runs its agent.
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const sourceInstanceId = (message.metadata?.sourceInstanceId as string | undefined) ?? instanceId;
    const hopCount = (message.metadata?.hopCount as number | undefined) ?? 0;
    const text = message.content.text ?? '';

    if (!text) {
      return { success: true, timestamp: Date.now() };
    }

    if (hopCount >= MAX_HOP_LIMIT) {
      log.warn('Internal channel hop limit reached — dropping message to prevent infinite loop', {
        instanceId,
        sourceInstanceId,
        hopCount,
        limit: MAX_HOP_LIMIT,
      });
      return { success: false, timestamp: Date.now() };
    }

    // instanceId = target instance; sourceInstanceId = origin instance
    // chatId = sourceInstanceId so the target's agent sees it as a conversation
    // from the source instance.
    await this.emitMessageReceived({
      instanceId,
      externalId: `internal-${generateId()}`,
      chatId: sourceInstanceId,
      from: sourceInstanceId,
      content: { type: 'text', text },
      rawPayload: {
        sourceInstanceId,
        chainMode: message.metadata?.chainMode,
        hopCount: hopCount + 1,
      },
    });

    return { success: true, timestamp: Date.now() };
  }
}
