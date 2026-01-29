/**
 * Event type definitions for the Omni event system
 */

import type { ChannelType, ContentType } from '../types/channel';

/**
 * All event types in the system
 */
export const EVENT_TYPES = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'media.received',
  'media.processed',
  'identity.created',
  'identity.linked',
  'identity.unlinked',
  'instance.connected',
  'instance.disconnected',
  'access.allowed',
  'access.denied',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Base event structure
 */
export interface OmniEvent<T extends EventType = EventType, P = unknown> {
  id: string;
  type: T;
  payload: P;
  metadata: EventMetadata;
  timestamp: number;
}

export interface EventMetadata {
  correlationId: string;
  instanceId?: string;
  channelType?: ChannelType;
  personId?: string;
  platformIdentityId?: string;
  traceId?: string;
  source?: string;
}

/**
 * Message event payloads
 */
export interface MessageReceivedPayload {
  externalId: string;
  chatId: string;
  from: string;
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
  };
  replyToId?: string;
  rawPayload?: Record<string, unknown>;
}

export interface MessageSentPayload {
  externalId: string;
  chatId: string;
  to: string;
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
  };
  replyToId?: string;
}

export interface MessageDeliveredPayload {
  externalId: string;
  chatId: string;
  deliveredAt: number;
}

export interface MessageReadPayload {
  externalId: string;
  chatId: string;
  readAt: number;
}

export interface MessageFailedPayload {
  externalId?: string;
  chatId: string;
  error: string;
  errorCode?: string;
  retryable: boolean;
}

/**
 * Media event payloads
 */
export interface MediaReceivedPayload {
  eventId: string;
  mediaId: string;
  mimeType: string;
  size: number;
  duration?: number;
  url: string;
}

export interface MediaProcessedPayload {
  eventId: string;
  mediaId: string;
  processingType: 'transcription' | 'description' | 'extraction';
  content: string;
  model?: string;
  provider?: string;
  tokensUsed?: number;
}

/**
 * Identity event payloads
 */
export interface IdentityCreatedPayload {
  personId: string;
  displayName?: string;
  primaryPhone?: string;
  primaryEmail?: string;
}

export interface IdentityLinkedPayload {
  personId: string;
  platformIdentityId: string;
  channelType: ChannelType;
  platformUserId: string;
  linkedBy: 'auto' | 'manual' | 'phone_match' | 'initial';
  confidence: number;
}

export interface IdentityUnlinkedPayload {
  personId: string;
  platformIdentityId: string;
  reason?: string;
}

/**
 * Instance event payloads
 */
export interface InstanceConnectedPayload {
  instanceId: string;
  channelType: ChannelType;
  profileName?: string;
  profilePicUrl?: string;
  ownerIdentifier?: string;
}

export interface InstanceDisconnectedPayload {
  instanceId: string;
  channelType: ChannelType;
  reason?: string;
  willReconnect: boolean;
}

/**
 * Access event payloads
 */
export interface AccessAllowedPayload {
  instanceId: string;
  platformUserId: string;
  personId?: string;
  ruleId?: string;
}

export interface AccessDeniedPayload {
  instanceId: string;
  platformUserId: string;
  personId?: string;
  ruleId?: string;
  reason: string;
  action: 'block' | 'silent_block';
}

/**
 * Event type map for type-safe event handling
 */
export interface EventPayloadMap {
  'message.received': MessageReceivedPayload;
  'message.sent': MessageSentPayload;
  'message.delivered': MessageDeliveredPayload;
  'message.read': MessageReadPayload;
  'message.failed': MessageFailedPayload;
  'media.received': MediaReceivedPayload;
  'media.processed': MediaProcessedPayload;
  'identity.created': IdentityCreatedPayload;
  'identity.linked': IdentityLinkedPayload;
  'identity.unlinked': IdentityUnlinkedPayload;
  'instance.connected': InstanceConnectedPayload;
  'instance.disconnected': InstanceDisconnectedPayload;
  'access.allowed': AccessAllowedPayload;
  'access.denied': AccessDeniedPayload;
}

/**
 * Typed event helper
 */
export type TypedOmniEvent<T extends EventType> = OmniEvent<T, EventPayloadMap[T]>;
