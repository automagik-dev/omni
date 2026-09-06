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
 *   baseUrl: 'http://localhost:8882',
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
  SentBy,
  ListEventsParams,
  SearchPersonsParams,
  ListAccessRulesParams,
  CreateAccessRuleBody,
  ListSettingsParams,
  ListProvidersParams,
  NewAgentProvider,
  ProviderSchema,
  ProviderHealthResult,
  AgnoAgent,
  AgnoTeam,
  AgnoWorkflow,
  // Sync types
  StartSyncBody,
  ListSyncsParams,
  SyncProfileResult,
  SyncJobCreated,
  SyncJobSummary,
  SyncJobStatus,
  // Auth types
  AuthCredentialContext,
  AuthValidateResponse,
  // A2A types
  A2ADiscoverableAgent,
  A2AJsonRpcResponse,
  // Chat types
  Chat,
  ChatSettings,
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
  WebhookSignatureConfigBody,
  CreateWebhookSourceBody,
  TriggerEventBody,
  WebhookHeartbeatResponse,
  // Payload types
  PayloadConfig,
  UpdatePayloadConfigBody,
  DeletePayloadsBody,
  // Event ops types
  ReplaySession,
  StartReplayBody,
  EventMetrics,
  EventAnalytics,
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
  WhatsAppPasskeyCredential,
  WhatsAppPasskeyState,
  ListContactsParams,
  ListGroupsParams,
  Contact,
  Group,
  UserProfile,
  // Presence & Read types
  SendPresenceBody,
  SendPresenceResult,
  MarkMessageReadBody,
  BatchMarkReadBody,
  MarkChatReadBody,
  MarkReadResult,
  // Batch job types
  BatchJobType,
  BatchJob,
  BatchJobStatus,
  BatchJobStatusResponse,
  ProcessableContentType,
  CreateBatchJobBody,
  ListBatchJobsParams,
  CostEstimate,
  // API Key types
  ApiKeyRecord,
  ApiKeyStatus,
  CreateApiKeyBody,
  CreateApiKeyResult,
  UpdateApiKeyBody,
  RevokeApiKeyBody,
  ListApiKeysParams,
} from './client';

// Errors
export { OmniApiError, OmniConfigError, type ApiErrorDetails } from './errors';

// WhatsApp Flow JSON builder (hand-authored — not OpenAPI-generated)
export {
  flow,
  FlowBuilder,
  ScreenBuilder,
  FormBuilder,
  FlowBuilderError,
} from './flow-builder';
export type { FlowOptions, ScreenOptions, DataSourceItem, FlowComponent } from './flow-builder';

// Generated types (for advanced usage)
export type { paths, components, operations } from './types.generated';
