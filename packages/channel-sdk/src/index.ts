/**
 * @omni/channel-sdk - Plugin SDK for building channel integrations
 *
 * This package provides everything needed to build a channel plugin:
 * - Type definitions for plugins, capabilities, and messaging
 * - BaseChannelPlugin base class with event publishing helpers
 * - ChannelRegistry for plugin management
 * - Auto-discovery for loading channel-* packages
 *
 * @example
 * ```typescript
 * import {
 *   BaseChannelPlugin,
 *   DEFAULT_CAPABILITIES,
 *   buildSubject,
 *   channelRegistry,
 * } from '@omni/channel-sdk';
 *
 * export class MyChannelPlugin extends BaseChannelPlugin {
 *   readonly id = 'discord' as const;
 *   readonly name = 'Discord Bot';
 *   readonly version = '1.0.0';
 *   readonly capabilities = { ...DEFAULT_CAPABILITIES, canSendMedia: true };
 *
 *   async connect(instanceId: string, config: InstanceConfig) {
 *     // Connect to Discord
 *     await this.emitInstanceConnected(instanceId, { profileName: 'My Bot' });
 *   }
 *
 *   async disconnect(instanceId: string) {
 *     await this.emitInstanceDisconnected(instanceId, 'User requested');
 *   }
 *
 *   async sendMessage(instanceId: string, message: OutgoingMessage) {
 *     // Send via Discord API
 *     await this.emitMessageSent({ instanceId, ... });
 *     return { success: true, messageId: 'msg_123', timestamp: Date.now() };
 *   }
 * }
 *
 * // Register the plugin
 * channelRegistry.register(new MyChannelPlugin());
 * ```
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export * from './types';

// ─────────────────────────────────────────────────────────────
// History Sync
// ─────────────────────────────────────────────────────────────

export * from './history';

// ─────────────────────────────────────────────────────────────
// Base implementations
// ─────────────────────────────────────────────────────────────

export * from './base';

// ─────────────────────────────────────────────────────────────
// Helpers (internal — not re-exported; consumed by BaseChannelPlugin only)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Reaction Acknowledgment
// ─────────────────────────────────────────────────────────────

export * from './reaction-ack';

// ─────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────

export * from './discovery';

// ─────────────────────────────────────────────────────────────
// Reliability utilities
// ─────────────────────────────────────────────────────────────

export { createInboundDedupeCache, validateCacheKey } from './dedupe';
export type { DedupeCache, DedupeConfig, DedupeStats } from './dedupe';

export { createThreadStarterCache } from './thread-cache';
export type { ThreadStarterCache, ThreadStarterCacheConfig } from './thread-cache';

export { sanitizeMessage, sanitizeOutboundText, isValidInstanceId } from './sanitize';
export type { SanitizeOptions, SanitizeResult } from './sanitize';

export { createDownloadGuard, DownloadTooLargeError } from './download-guard';
export type { DownloadGuard, DownloadGuardConfig, DownloadGuardContext } from './download-guard';

// ─────────────────────────────────────────────────────────────
// Media storage backends (shared by @omni/api and channel plugins)
// ─────────────────────────────────────────────────────────────

export {
  createMediaBackend,
  isMediaNotFoundError,
  LocalMediaBackend,
  resolveMediaBackendConfig,
  S3MediaBackend,
} from './media-backends';
export type {
  MediaBackendConfig,
  MediaObjectStat,
  MediaStorageBackend,
  MediaStorageMode,
  S3BackendConfig,
  StoreMediaInput,
  StoreMediaResult,
  StoreStreamInput,
} from './media-backends';

// Explicit streaming type export for package root access
export type { StreamSender } from './types/streaming';

// ─────────────────────────────────────────────────────────────
// Re-exports from @omni/core for convenience
// ─────────────────────────────────────────────────────────────

// Subject builders - so channels don't need to import @omni/core directly
export {
  buildSubject,
  buildSubscribePattern,
  parseSubject,
  eventTypeToPattern,
  matchesPattern,
} from '@omni/core/events/nats';

export type { ParsedSubject } from '@omni/core/events/nats';

// Event types - for reference in channel implementations
export type {
  EventBus,
  EventHandler,
  GenericEventHandler,
  PublishResult,
  SubscribeOptions,
  Subscription,
} from '@omni/core/events';

// Event payload types - for type-safe event handling
export type {
  CoreEventType,
  EventType,
  OmniEvent,
  EventMetadata,
  EventPayloadMap,
  TypedOmniEvent,
  MessageReceivedPayload,
  MessageSentPayload,
  MessageDeliveredPayload,
  MessageReadPayload,
  MessageFailedPayload,
  MediaReceivedPayload,
  MediaProcessedPayload,
  InstanceConnectedPayload,
  InstanceDisconnectedPayload,
  InstanceQrCodePayload,
} from '@omni/core/events';

// Channel types from core
export { CHANNEL_TYPES, CONTENT_TYPES } from '@omni/core/types';
export type { ChannelType, ContentType } from '@omni/core/types';
