/**
 * @omni/sdk - TypeScript SDK for Omni v2 API
 *
 * Auto-generated types from OpenAPI spec with type-safe wrapper.
 *
 * @example
 * ```typescript
 * import { createOmniClient } from '@omni/sdk';
 *
 * const omni = createOmniClient({
 *   baseUrl: 'http://localhost:8881',
 *   apiKey: 'your-api-key',
 * });
 *
 * // List instances with full autocomplete
 * const instances = await omni.instances.list();
 *
 * // Send a message
 * await omni.messages.send({
 *   instanceId: 'uuid',
 *   to: '1234567890',
 *   text: 'Hello!',
 * });
 * ```
 */

export const VERSION = '0.0.1';

// Client
export {
  createOmniClient,
  type OmniClient,
  type OmniClientConfig,
} from './client';

// Types
export type {
  Instance,
  Person,
  Event,
  AccessRule,
  Setting,
  Provider,
  HealthResponse,
  PaginationMeta,
  Channel,
  PaginatedResponse,
  ListInstancesParams,
  CreateInstanceBody,
  SendMessageBody,
  ListEventsParams,
  SearchPersonsParams,
  ListAccessRulesParams,
  CreateAccessRuleBody,
  ListSettingsParams,
  ListProvidersParams,
  // Sync types
  StartSyncBody,
  ListSyncsParams,
  SyncProfileResult,
  SyncJobCreated,
  SyncJobSummary,
  SyncJobStatus,
  // Auth types
  AuthValidateResponse,
  // Chat types
  Chat,
  Message,
  ChatParticipant,
  ListChatsParams,
  CreateChatBody,
  UpdateChatBody,
  AddParticipantBody,
  ListChatMessagesParams,
  // Automation types
  Automation,
  ListAutomationsParams,
  CreateAutomationBody,
  TestAutomationBody,
  ListAutomationLogsParams,
  // Dead letter types
  DeadLetter,
  ListDeadLettersParams,
  ResolveDeadLetterBody,
  // Webhook types
  WebhookSource,
  ListWebhookSourcesParams,
  CreateWebhookSourceBody,
  TriggerEventBody,
  // Payload types
  PayloadConfig,
  UpdatePayloadConfigBody,
  DeletePayloadsBody,
  // Event ops types
  ReplaySession,
  StartReplayBody,
  // Log types
  LogEntry,
  ListLogsParams,
  // Message types
  SendMediaBody,
  SendReactionBody,
  SendStickerBody,
  SendContactBody,
  SendLocationBody,
  SendPollBody,
  SendEmbedBody,
  // Instance types
  ConnectInstanceBody,
  RequestPairingCodeBody,
} from './client';

// Errors
export { OmniApiError, OmniConfigError, type ApiErrorDetails } from './errors';

// Generated types (for advanced usage)
export type { paths, components, operations } from './types.generated';
