/**
 * Base channel plugin implementation
 *
 * Provides common functionality for channel plugins including:
 * - Event publishing helpers with hierarchical subjects
 * - Instance state tracking
 * - Health check aggregation
 * - Logging with plugin context
 */

import { generateCorrelationId } from '@omni/core';
import type { EventBus } from '@omni/core/events';
import { buildSubject } from '@omni/core/events/nats';
import type { ChannelType } from '@omni/core/types';
import type {
  EmitMediaReceivedParams,
  EmitMessageDeliveredParams,
  EmitMessageFailedParams,
  EmitMessageReadParams,
  EmitMessageReceivedParams,
  EmitMessageSentParams,
  EmitReactionReceivedParams,
  EmitReactionRemovedParams,
  InstanceConnectedMetadata,
} from '../helpers/events';
import type { ChannelCapabilities } from '../types/capabilities';
import type { GlobalConfig, Logger, PluginContext, PluginDatabase, PluginStorage } from '../types/context';
import type { ConnectionStatus, InstanceConfig } from '../types/instance';
import type { OutgoingMessage, SendResult } from '../types/messaging';
import type { ChannelPlugin, HealthCheck, HealthStatus } from '../types/plugin';
import { aggregateHealthChecks } from './HealthChecker';
import { InstanceManager } from './InstanceManager';

/**
 * Abstract base class for channel plugins
 *
 * Extend this class to implement a channel plugin. It provides:
 * - Automatic instance state tracking
 * - Event publishing helpers with correct subjects
 * - Health check aggregation
 * - Logging with plugin context
 *
 * @example
 * ```typescript
 * export class WhatsAppPlugin extends BaseChannelPlugin {
 *   readonly id = 'whatsapp-baileys' as const;
 *   readonly name = 'WhatsApp (Baileys)';
 *   readonly version = '1.0.0';
 *   readonly capabilities = { ...DEFAULT_CAPABILITIES, canSendMedia: true };
 *
 *   protected async onInitialize(context: PluginContext): Promise<void> {
 *     // Set up WhatsApp client
 *   }
 *
 *   async connect(instanceId: string, config: InstanceConfig): Promise<void> {
 *     // Connect to WhatsApp
 *     await this.emitInstanceConnected(instanceId, { profileName: 'My Bot' });
 *   }
 *
 *   // ... other methods
 * }
 * ```
 */
export abstract class BaseChannelPlugin implements ChannelPlugin {
  // ─────────────────────────────────────────────────────────────
  // Abstract properties - must be implemented by subclasses
  // ─────────────────────────────────────────────────────────────

  abstract readonly id: ChannelType;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly capabilities: ChannelCapabilities;

  // ─────────────────────────────────────────────────────────────
  // Protected dependencies - available to subclasses
  // ─────────────────────────────────────────────────────────────

  protected eventBus!: EventBus;
  protected logger!: Logger;
  protected storage!: PluginStorage;
  protected config!: GlobalConfig;
  protected db!: PluginDatabase;

  // ─────────────────────────────────────────────────────────────
  // Instance management
  // ─────────────────────────────────────────────────────────────

  protected instances = new InstanceManager();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  /**
   * Initialize the plugin with dependencies
   * Override onInitialize() for custom initialization logic
   */
  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.logger = context.logger.child({ plugin: this.id });
    this.storage = context.storage;
    this.config = context.config;
    this.db = context.db;

    await this.onInitialize(context);
  }

  /**
   * Override this method for custom initialization logic
   */
  protected async onInitialize(_context: PluginContext): Promise<void> {
    // Subclasses can override
  }

  /**
   * Destroy the plugin and release resources
   * Override onDestroy() for custom cleanup logic
   */
  async destroy(): Promise<void> {
    this.logger.info('Destroying plugin');

    // Disconnect all instances
    const instanceIds = this.instances.getAllIds();
    await Promise.all(instanceIds.map((id) => this.disconnect(id).catch(() => {})));

    await this.onDestroy();

    this.instances.clear();
    this.logger.info('Plugin destroyed');
  }

  /**
   * Override this method for custom cleanup logic
   */
  protected async onDestroy(): Promise<void> {
    // Subclasses can override
  }

  // ─────────────────────────────────────────────────────────────
  // Instance Management - must be implemented by subclasses
  // ─────────────────────────────────────────────────────────────

  abstract connect(instanceId: string, config: InstanceConfig): Promise<void>;
  abstract disconnect(instanceId: string): Promise<void>;
  abstract sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult>;

  /**
   * Get connection status for an instance
   */
  async getStatus(instanceId: string): Promise<ConnectionStatus> {
    const status = this.instances.getStatus(instanceId);
    if (!status) {
      return {
        state: 'disconnected',
        since: new Date(),
        message: 'Instance not found',
      };
    }
    return status;
  }

  /**
   * Get all connected instance IDs
   */
  getConnectedInstances(): string[] {
    return this.instances.getConnectedIds();
  }

  // ─────────────────────────────────────────────────────────────
  // Health - can be overridden for custom checks
  // ─────────────────────────────────────────────────────────────

  /**
   * Get plugin health status
   * Override getHealthChecks() to add custom checks
   */
  async getHealth(): Promise<HealthStatus> {
    const checks = await this.getHealthChecks();
    const status = aggregateHealthChecks(checks);

    return {
      status,
      checks,
      checkedAt: new Date(),
    };
  }

  /**
   * Override this method to add custom health checks
   */
  protected async getHealthChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];

    // Default check: instance connectivity
    const connectedCount = this.instances.connectedCount();
    const totalCount = this.instances.count();

    if (totalCount === 0) {
      checks.push({
        name: 'instances',
        status: 'pass',
        message: 'No instances configured',
      });
    } else if (connectedCount === totalCount) {
      checks.push({
        name: 'instances',
        status: 'pass',
        message: `All ${totalCount} instance(s) connected`,
        data: { connected: connectedCount, total: totalCount },
      });
    } else if (connectedCount > 0) {
      checks.push({
        name: 'instances',
        status: 'warn',
        message: `${connectedCount}/${totalCount} instance(s) connected`,
        data: { connected: connectedCount, total: totalCount },
      });
    } else {
      checks.push({
        name: 'instances',
        status: 'fail',
        message: `No instances connected (${totalCount} configured)`,
        data: { connected: 0, total: totalCount },
      });
    }

    return checks;
  }

  // ─────────────────────────────────────────────────────────────
  // Event Emission Helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Emit message.received event with hierarchical subject
   *
   * @example
   * await this.emitMessageReceived({
   *   instanceId: 'wa-001',
   *   externalId: 'msg_123',
   *   chatId: 'chat_456',
   *   from: '+1234567890',
   *   content: { type: 'text', text: 'Hello!' },
   * });
   */
  protected async emitMessageReceived(params: EmitMessageReceivedParams): Promise<void> {
    const _subject = buildSubject('message.received', this.id, params.instanceId);

    await this.eventBus.publish(
      'message.received',
      {
        externalId: params.externalId,
        chatId: params.chatId,
        from: params.from,
        content: params.content,
        replyToId: params.replyToId,
        rawPayload: params.rawPayload,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted message.received', { instanceId: params.instanceId, externalId: params.externalId });
  }

  /**
   * Emit message.sent event with hierarchical subject
   */
  protected async emitMessageSent(params: EmitMessageSentParams): Promise<void> {
    const _subject = buildSubject('message.sent', this.id, params.instanceId);

    await this.eventBus.publish(
      'message.sent',
      {
        externalId: params.externalId,
        chatId: params.chatId,
        to: params.to,
        content: params.content,
        replyToId: params.replyToId,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted message.sent', { instanceId: params.instanceId, externalId: params.externalId });
  }

  /**
   * Emit message.failed event
   */
  protected async emitMessageFailed(params: EmitMessageFailedParams): Promise<void> {
    const _subject = buildSubject('message.failed', this.id, params.instanceId);

    await this.eventBus.publish(
      'message.failed',
      {
        externalId: params.externalId,
        chatId: params.chatId,
        error: params.error,
        errorCode: params.errorCode,
        retryable: params.retryable,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.logger.warn('Emitted message.failed', {
      instanceId: params.instanceId,
      error: params.error,
      retryable: params.retryable,
    });
  }

  /**
   * Emit message.delivered event
   */
  protected async emitMessageDelivered(params: EmitMessageDeliveredParams): Promise<void> {
    await this.eventBus.publish(
      'message.delivered',
      {
        externalId: params.externalId,
        chatId: params.chatId,
        deliveredAt: params.deliveredAt,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
  }

  /**
   * Emit message.read event
   */
  protected async emitMessageRead(params: EmitMessageReadParams): Promise<void> {
    await this.eventBus.publish(
      'message.read',
      {
        externalId: params.externalId,
        chatId: params.chatId,
        readAt: params.readAt,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
  }

  /**
   * Emit reaction.received event
   *
   * @example
   * await this.emitReactionReceived({
   *   instanceId: 'discord-001',
   *   messageId: 'msg_123',
   *   chatId: 'channel_456',
   *   from: 'user_789',
   *   emoji: '🐙',
   * });
   */
  protected async emitReactionReceived(params: EmitReactionReceivedParams): Promise<void> {
    await this.eventBus.publish(
      'reaction.received',
      {
        messageId: params.messageId,
        chatId: params.chatId,
        from: params.from,
        emoji: params.emoji,
        emojiName: params.emojiName,
        isCustomEmoji: params.isCustomEmoji,
        rawPayload: params.rawPayload,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted reaction.received', {
      instanceId: params.instanceId,
      messageId: params.messageId,
      emoji: params.emoji,
    });
  }

  /**
   * Emit reaction.removed event
   */
  protected async emitReactionRemoved(params: EmitReactionRemovedParams): Promise<void> {
    await this.eventBus.publish(
      'reaction.removed',
      {
        messageId: params.messageId,
        chatId: params.chatId,
        from: params.from,
        emoji: params.emoji,
        emojiName: params.emojiName,
        isCustomEmoji: params.isCustomEmoji,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted reaction.removed', {
      instanceId: params.instanceId,
      messageId: params.messageId,
      emoji: params.emoji,
    });
  }

  /**
   * Emit instance.connected event
   */
  protected async emitInstanceConnected(instanceId: string, metadata?: InstanceConnectedMetadata): Promise<void> {
    await this.eventBus.publish(
      'instance.connected',
      {
        instanceId,
        channelType: this.id,
        profileName: metadata?.profileName,
        profilePicUrl: metadata?.profilePicUrl,
        ownerIdentifier: metadata?.ownerIdentifier,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.logger.info('Instance connected', { instanceId, ...metadata });
  }

  /**
   * Emit instance.disconnected event
   */
  protected async emitInstanceDisconnected(instanceId: string, reason?: string, willReconnect = false): Promise<void> {
    await this.eventBus.publish(
      'instance.disconnected',
      {
        instanceId,
        channelType: this.id,
        reason,
        willReconnect,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.logger.info('Instance disconnected', { instanceId, reason, willReconnect });
  }

  /**
   * Emit instance.qr_code event
   */
  protected async emitQrCode(instanceId: string, qrCode: string, expiresAt: Date): Promise<void> {
    await this.eventBus.publish(
      'instance.qr_code',
      {
        instanceId,
        channelType: this.id,
        qrCode,
        expiresAt: expiresAt.getTime(),
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.logger.debug('QR code generated', { instanceId, expiresAt: expiresAt.toISOString() });
  }

  /**
   * Emit media.received event
   */
  protected async emitMediaReceived(params: EmitMediaReceivedParams): Promise<void> {
    await this.eventBus.publish(
      'media.received',
      {
        eventId: params.eventId,
        mediaId: params.mediaId,
        mimeType: params.mimeType,
        size: params.size,
        url: params.url,
        duration: params.duration,
      },
      {
        correlationId: generateCorrelationId('evt'),
        instanceId: params.instanceId,
        channelType: this.id,
        source: `channel:${this.id}`,
      },
    );

    this.instances.recordActivity(params.instanceId);
    this.logger.debug('Emitted media.received', {
      instanceId: params.instanceId,
      mediaId: params.mediaId,
      mimeType: params.mimeType,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Utility methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Update and emit connection status for an instance
   */
  protected async updateInstanceStatus(
    instanceId: string,
    config: InstanceConfig,
    status: ConnectionStatus,
  ): Promise<void> {
    this.instances.setInstance(instanceId, config, status);
  }
}
