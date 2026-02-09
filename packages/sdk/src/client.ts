/**
 * Omni SDK Client
 *
 * Type-safe wrapper around the OpenAPI-generated types.
 */

import createClient, { type Middleware } from 'openapi-fetch';
import { OmniApiError, OmniConfigError } from './errors';
import type { components, paths } from './types.generated';

// Re-export schema types for convenience
export type Instance = components['schemas']['Instance'];
export type Person = components['schemas']['Person'];
export type Event = components['schemas']['Event'];
export type AccessRule = components['schemas']['AccessRule'];
export type Setting = components['schemas']['Setting'];
export type Provider = components['schemas']['Provider'];
export type HealthResponse = components['schemas']['HealthResponse'];
export type PaginationMeta = components['schemas']['PaginationMeta'];
export type Automation = components['schemas']['Automation'];
export type DeadLetter = components['schemas']['DeadLetter'];
export type WebhookSource = components['schemas']['WebhookSource'];
export type PayloadConfig = components['schemas']['PayloadConfig'];
export type ReplaySession = components['schemas']['ReplaySession'];
export type LogEntry = components['schemas']['LogEntry'];
export type EventMetrics = components['schemas']['EventMetrics'];
export type EventAnalytics = components['schemas']['EventAnalytics'];

// Types that will be added after SDK regeneration
// For now, use generic interfaces
export interface ChatSettings {
  muted?: boolean;
  muteUntil?: string;
  pinned?: boolean;
  archived?: boolean;
  readOnly?: boolean;
  slowMode?: number;
  agentPaused?: boolean;
  [key: string]: unknown;
}

export interface Chat {
  id: string;
  instanceId: string;
  externalId: string;
  chatType: string;
  channel: string;
  name?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  isArchived: boolean;
  settings?: ChatSettings | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  externalId: string;
  source: string;
  messageType: string;
  textContent?: string | null;
  platformTimestamp: string;
  isFromMe?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatParticipant {
  id: string;
  chatId: string;
  platformUserId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Channel type enum
export type Channel = 'whatsapp-baileys' | 'whatsapp-cloud' | 'discord' | 'slack' | 'telegram';

// Paginated response helper
export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

// ============================================================================
// BATCH JOB TYPES
// ============================================================================

/** Batch job type */
export type BatchJobType = 'targeted_chat_sync' | 'time_based_batch';

/** Job status */
export type BatchJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Content types processable by batch jobs */
export type ProcessableContentType = 'audio' | 'image' | 'video' | 'document';

/** Batch job record */
export interface BatchJob {
  id: string;
  jobType: string;
  instanceId: string;
  status: string;
  requestParams: Record<string, unknown>;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  currentItem?: string | null;
  progressPercent: number;
  totalCostUsd?: number | null;
  totalTokens?: number | null;
  errorMessage?: string | null;
  errors?: Array<{ itemId: string; error: string }>;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Batch job status (lightweight for polling) */
export interface BatchJobStatusResponse {
  id: string;
  status: string;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  progressPercent: number;
  currentItem?: string | null;
  totalCostUsd?: number | null;
  totalTokens?: number | null;
  estimatedCompletion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Body for creating a batch job */
export interface CreateBatchJobBody {
  jobType: BatchJobType;
  instanceId: string;
  chatId?: string;
  daysBack?: number;
  limit?: number;
  contentTypes?: ProcessableContentType[];
  force?: boolean;
}

/** Query parameters for listing batch jobs */
export interface ListBatchJobsParams {
  instanceId?: string;
  status?: BatchJobStatus[];
  jobType?: BatchJobType[];
  limit?: number;
  cursor?: string;
}

/** Cost estimation result */
export interface CostEstimate {
  totalItems: number;
  audioCount: number;
  imageCount: number;
  videoCount: number;
  documentCount: number;
  estimatedCostCents: number;
  estimatedCostUsd: number;
  estimatedDurationMinutes: number;
}

/**
 * Client configuration
 */
export interface OmniClientConfig {
  /** Base URL of the API (e.g., 'http://localhost:8881') */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
}

/**
 * Query parameters for listing instances
 */
export interface ListInstancesParams {
  channel?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Body for creating an instance
 */
export interface CreateInstanceBody {
  name: string;
  channel: Channel;
  agentProviderId?: string;
  agentId?: string;
}

/**
 * Body for sending a message
 */
export interface SendMessageBody {
  instanceId: string;
  to: string;
  text: string;
  replyTo?: string;
}

/**
 * Query parameters for listing events
 */
export interface ListEventsParams {
  channel?: string;
  instanceId?: string;
  eventType?: string;
  since?: string;
  until?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Query parameters for searching persons
 */
export interface SearchPersonsParams {
  search: string;
  limit?: number;
}

/**
 * Query parameters for listing access rules
 */
export interface ListAccessRulesParams {
  instanceId?: string;
  type?: 'allow' | 'deny';
}

/**
 * Body for creating an access rule
 */
export interface CreateAccessRuleBody {
  ruleType: 'allow' | 'deny';
  instanceId?: string;
  phonePattern?: string;
  platformUserId?: string;
  priority?: number;
  action?: 'block' | 'silent_block' | 'allow';
  reason?: string;
  blockMessage?: string;
  enabled?: boolean;
}

/**
 * Parameters for checking access
 */
export interface CheckAccessParams {
  instanceId: string;
  platformUserId: string;
  channel: string;
}

/**
 * Result of access check
 */
export interface CheckAccessResult {
  allowed: boolean;
  reason: string | null;
  rule?: AccessRule | null;
}

/**
 * Query parameters for listing settings
 */
export interface ListSettingsParams {
  category?: string;
}

/**
 * Query parameters for listing providers
 */
export interface ListProvidersParams {
  active?: boolean;
}

/**
 * Provider schema type
 * - agnoos: AgnoOS AI orchestration platform
 * - a2a: Agent-to-Agent protocol (Google A2A)
 * - openai: OpenAI-compatible API
 * - anthropic: Anthropic Claude API
 * - custom: Custom provider implementation
 */
export type ProviderSchema = 'agnoos' | 'a2a' | 'openai' | 'anthropic' | 'custom';

/**
 * Body for creating a provider
 */
export interface NewAgentProvider {
  name: string;
  schema: ProviderSchema;
  baseUrl: string;
  apiKey?: string;
  schemaConfig?: Record<string, unknown>;
  defaultStream?: boolean;
  defaultTimeout?: number;
  supportsStreaming?: boolean;
  supportsImages?: boolean;
  supportsAudio?: boolean;
  supportsDocuments?: boolean;
  description?: string;
  tags?: string[];
}

/**
 * Provider health check result
 */
export interface ProviderHealthResult {
  healthy: boolean;
  latency: number;
  error?: string;
}

/**
 * Agno agent entity
 */
export interface AgnoAgent {
  agent_id: string;
  name: string;
  model?: { provider?: string; name?: string };
  description?: string;
  instructions?: string[];
}

/**
 * Agno team entity
 */
export interface AgnoTeam {
  team_id: string;
  name: string;
  description?: string;
  mode?: string;
  members?: Array<{ agent_id: string; role?: string }>;
}

/**
 * Agno workflow entity
 */
export interface AgnoWorkflow {
  workflow_id: string;
  name: string;
  description?: string;
}

// ============================================================================
// New parameter/body types for expanded SDK
// ============================================================================

/**
 * Query parameters for listing chats
 */
export interface ListChatsParams {
  instanceId?: string;
  channel?: string;
  chatType?: string;
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}

/**
 * Body for creating a chat
 */
export interface CreateChatBody {
  instanceId: string;
  externalId: string;
  chatType: string;
  channel: Channel;
  name?: string;
  description?: string;
  avatarUrl?: string;
  canonicalId?: string;
  parentChatId?: string;
  settings?: Record<string, unknown>;
  platformMetadata?: Record<string, unknown>;
}

/**
 * Body for updating a chat
 */
export interface UpdateChatBody {
  name?: string;
  description?: string;
  avatarUrl?: string | null;
  canonicalId?: string | null;
  settings?: Record<string, unknown> | null;
  platformMetadata?: Record<string, unknown> | null;
}

/**
 * Body for adding a chat participant
 */
export interface AddParticipantBody {
  platformUserId: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  personId?: string;
  platformIdentityId?: string;
  platformMetadata?: Record<string, unknown>;
}

/**
 * Query parameters for listing chat messages
 */
export interface ListChatMessagesParams {
  limit?: number;
  before?: string;
  after?: string;
}

/**
 * Query parameters for listing logs
 */
export interface ListLogsParams {
  modules?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  limit?: number;
}

/**
 * Query parameters for listing automations
 */
export interface ListAutomationsParams {
  enabled?: boolean;
}

/**
 * Body for creating an automation
 */
export interface CreateAutomationBody {
  name: string;
  description?: string;
  triggerEventType: string;
  triggerConditions?: Array<{
    field: string;
    operator:
      | 'eq'
      | 'neq'
      | 'gt'
      | 'lt'
      | 'gte'
      | 'lte'
      | 'contains'
      | 'not_contains'
      | 'exists'
      | 'not_exists'
      | 'regex';
    value?: unknown;
  }>;
  /** Condition logic: 'and' (all must match) or 'or' (any must match). Defaults to 'and'. */
  conditionLogic?: 'and' | 'or';
  actions: Array<{
    type: 'webhook' | 'send_message' | 'emit_event' | 'log' | 'call_agent';
    config: Record<string, unknown>;
  }>;
  debounce?: Record<string, unknown>;
  enabled?: boolean;
  priority?: number;
}

/**
 * Body for testing an automation
 */
export interface TestAutomationBody {
  event: {
    type: string;
    payload: Record<string, unknown>;
  };
}

/**
 * Query parameters for listing automation logs
 */
export interface ListAutomationLogsParams {
  limit?: number;
  cursor?: string;
  status?: 'success' | 'failed' | 'skipped';
  eventType?: string;
  automationId?: string;
}

/**
 * Query parameters for listing dead letters
 */
export interface ListDeadLettersParams {
  status?: string;
  eventType?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Body for resolving a dead letter
 */
export interface ResolveDeadLetterBody {
  note: string;
}

/**
 * Query parameters for listing webhook sources
 */
export interface ListWebhookSourcesParams {
  enabled?: boolean;
}

/**
 * Body for creating a webhook source
 */
export interface CreateWebhookSourceBody {
  name: string;
  description?: string;
  expectedHeaders?: Record<string, boolean>;
  enabled?: boolean;
}

/**
 * Body for triggering a custom event
 */
export interface TriggerEventBody {
  eventType: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  instanceId?: string;
}

/**
 * Body for starting a replay
 */
export interface StartReplayBody {
  since: string;
  until?: string;
  eventTypes?: string[];
  instanceId?: string;
  limit?: number;
  speedMultiplier?: number;
  skipProcessed?: boolean;
  dryRun?: boolean;
}

/**
 * Body for updating payload config
 */
export interface UpdatePayloadConfigBody {
  storeWebhookRaw?: boolean;
  storeAgentRequest?: boolean;
  storeAgentResponse?: boolean;
  storeChannelSend?: boolean;
  storeError?: boolean;
  retentionDays?: number;
}

/**
 * Body for deleting payloads
 */
export interface DeletePayloadsBody {
  reason: string;
}

/**
 * Body for sending media
 */
export interface SendMediaBody {
  instanceId: string;
  to: string;
  type: 'image' | 'audio' | 'video' | 'document';
  url?: string;
  base64?: string;
  filename?: string;
  caption?: string;
  voiceNote?: boolean;
}

/**
 * Body for sending a reaction
 */
export interface SendReactionBody {
  instanceId: string;
  to: string;
  messageId: string;
  emoji: string;
}

/**
 * Body for sending a sticker
 */
export interface SendStickerBody {
  instanceId: string;
  to: string;
  url?: string;
  base64?: string;
}

/**
 * Body for sending a contact
 */
export interface SendContactBody {
  instanceId: string;
  to: string;
  contact: {
    name: string;
    phone?: string;
    email?: string;
    organization?: string;
  };
}

/**
 * Body for sending a location
 */
export interface SendLocationBody {
  instanceId: string;
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * Body for sending a poll (Discord)
 */
export interface SendPollBody {
  instanceId: string;
  to: string;
  question: string;
  answers: string[];
  durationHours?: number;
  multiSelect?: boolean;
  replyTo?: string;
}

/**
 * Body for sending an embed (Discord)
 */
export interface SendEmbedBody {
  instanceId: string;
  to: string;
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  timestamp?: string;
  footer?: { text: string; iconUrl?: string };
  author?: { name: string; url?: string; iconUrl?: string };
  thumbnail?: string;
  image?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  replyTo?: string;
}

/**
 * Body for connecting an instance
 */
export interface ConnectInstanceBody {
  token?: string;
  forceNewQr?: boolean;
}

/**
 * Body for starting a sync
 */
export interface StartSyncBody {
  type: 'profile' | 'messages' | 'contacts' | 'groups' | 'all';
  depth?: '7d' | '30d' | '90d' | '1y' | 'all';
  channelId?: string;
  downloadMedia?: boolean;
}

/**
 * Query parameters for listing syncs
 */
export interface ListSyncsParams {
  status?: string;
  limit?: number;
}

/**
 * Body for requesting a pairing code
 */
export interface RequestPairingCodeBody {
  phoneNumber: string;
}

/**
 * Result of profile sync
 */
export interface SyncProfileResult {
  type: 'profile';
  status: string;
  profile: {
    name?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    platformMetadata?: Record<string, unknown> | null;
    syncedAt?: string | null;
  } | null;
}

/**
 * Sync job created response
 */
export interface SyncJobCreated {
  jobId: string;
  instanceId: string;
  type: string;
  status: string;
  config: Record<string, unknown>;
  message: string;
}

/**
 * Sync job summary (for list)
 */
export interface SyncJobSummary {
  jobId: string;
  type: string;
  status: string;
  progressPercent?: number | null;
  createdAt: string;
  completedAt?: string | null;
}

/**
 * Sync job status (detailed)
 */
export interface SyncJobStatus {
  jobId: string;
  instanceId: string;
  type: string;
  status: string;
  config: Record<string, unknown>;
  progress?: Record<string, unknown> | null;
  progressPercent?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

/**
 * Auth validation response
 */
export interface AuthValidateResponse {
  valid: boolean;
  keyPrefix: string;
  keyName: string;
  scopes: string[];
}

// ============================================================================
// API KEY TYPES
// ============================================================================

/** API key status */
export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

/** API key record */
export interface ApiKeyRecord {
  id: string;
  name: string;
  description?: string | null;
  keyPrefix: string;
  scopes: string[];
  instanceIds?: string[] | null;
  status: ApiKeyStatus;
  rateLimit?: number | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  usageCount: number;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
  createdAt: string;
  createdBy?: string | null;
  updatedAt: string;
}

/** Body for creating an API key */
export interface CreateApiKeyBody {
  name: string;
  description?: string;
  scopes: string[];
  instanceIds?: string[];
  rateLimit?: number;
  expiresAt?: string;
}

/** Body for updating an API key */
export interface UpdateApiKeyBody {
  name?: string;
  description?: string | null;
  scopes?: string[];
  instanceIds?: string[] | null;
  rateLimit?: number | null;
  expiresAt?: string | null;
}

/** Body for revoking an API key */
export interface RevokeApiKeyBody {
  reason?: string;
  revokedBy?: string;
}

/** Query parameters for listing API keys */
export interface ListApiKeysParams {
  status?: ApiKeyStatus;
  limit?: number;
}

/** Result of creating an API key (includes the plaintext key) */
export interface CreateApiKeyResult extends ApiKeyRecord {
  plainTextKey: string;
}

// ============================================================================
// Presence & Read Receipt Types (api-completeness)
// ============================================================================

/**
 * Body for sending presence indicator
 */
export interface SendPresenceBody {
  instanceId: string;
  to: string;
  type: 'typing' | 'recording' | 'paused';
  duration?: number;
}

/**
 * Response from sending presence
 */
export interface SendPresenceResult {
  instanceId: string;
  chatId: string;
  type: string;
  duration: number;
}

/**
 * Body for marking a single message as read
 */
export interface MarkMessageReadBody {
  instanceId: string;
}

/**
 * Body for marking multiple messages as read
 */
export interface BatchMarkReadBody {
  instanceId: string;
  chatId: string;
  messageIds: string[];
}

/**
 * Body for marking entire chat as read
 */
export interface MarkChatReadBody {
  instanceId: string;
}

/**
 * Response from marking messages as read
 */
export interface MarkReadResult {
  messageId?: string;
  externalMessageId?: string;
  chatId?: string;
  instanceId?: string;
  messageCount?: number;
}

/**
 * Query parameters for listing contacts
 */
export interface ListContactsParams {
  limit?: number;
  cursor?: string;
  guildId?: string; // Required for Discord
}

/**
 * Query parameters for listing groups
 */
export interface ListGroupsParams {
  limit?: number;
  cursor?: string;
}

/**
 * User profile from channel
 */
export interface UserProfile {
  platformUserId: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  phone?: string;
  platformMetadata?: Record<string, unknown>;
}

/**
 * Contact from channel
 */
export interface Contact {
  platformUserId: string;
  displayName?: string;
  phone?: string;
  avatarUrl?: string;
  isGroup: boolean;
  isBusiness?: boolean;
  platformMetadata?: Record<string, unknown>;
}

/**
 * Group from channel
 */
export interface Group {
  externalId: string;
  name?: string;
  description?: string;
  memberCount?: number;
  createdAt?: string;
  avatarUrl?: string;
  platformMetadata?: Record<string, unknown>;
}

/**
 * Helper to throw API error from response
 */
function throwIfError(response: Response, error: unknown): asserts error is undefined {
  if (!response.ok) {
    throw OmniApiError.from(error, response.status);
  }
}

/**
 * Create an Omni API client
 */
export function createOmniClient(config: OmniClientConfig) {
  if (!config.baseUrl) {
    throw new OmniConfigError('baseUrl is required');
  }
  if (!config.apiKey) {
    throw new OmniConfigError('apiKey is required');
  }

  // Normalize base URL
  const baseUrl = config.baseUrl.replace(/\/$/, '');

  // Auth middleware
  // Note: Accept-Encoding: identity disables compression to avoid Bun/Hono gzip compatibility issues
  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      request.headers.set('x-api-key', config.apiKey);
      request.headers.set('Accept-Encoding', 'identity');
      return request;
    },
  };

  // Helper for direct fetch calls with consistent headers
  const apiFetch = (url: string, init?: RequestInit) =>
    fetch(url, {
      ...init,
      headers: {
        'x-api-key': config.apiKey,
        'Accept-Encoding': 'identity',
        ...init?.headers,
      },
    });

  // Create openapi-fetch client
  const client = createClient<paths>({ baseUrl: `${baseUrl}/api/v2` });
  client.use(authMiddleware);

  return {
    // ========================================================================
    // AUTH
    // ========================================================================

    /**
     * Authentication
     */
    auth: {
      /**
       * Validate the current API key
       * Note: Uses type assertion until SDK types are regenerated
       */
      async validate(): Promise<AuthValidateResponse> {
        const resp = await apiFetch(`${baseUrl}/api/v2/auth/validate`, {
          method: 'POST',
        });
        const json = (await resp.json()) as { data?: AuthValidateResponse };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { valid: false, keyPrefix: '', keyName: '', scopes: [] };
      },
    },

    // ========================================================================
    // INSTANCES
    // ========================================================================

    /**
     * Instance management
     */
    instances: {
      /**
       * List all instances
       */
      async list(params?: ListInstancesParams): Promise<PaginatedResponse<Instance>> {
        const { data, error, response } = await client.GET('/instances', {
          params: { query: params },
        });
        throwIfError(response, error);
        return {
          items: data?.items ?? [],
          meta: data?.meta ?? { hasMore: false },
        };
      },

      /**
       * Get a single instance by ID
       */
      async get(id: string): Promise<Instance> {
        const { data, error, response } = await client.GET('/instances/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Instance not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Create a new instance
       */
      async create(body: CreateInstanceBody): Promise<Instance> {
        const { data, error, response } = await client.POST('/instances', { body });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to create instance', 'CREATE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Update an instance
       */
      async update(id: string, body: Partial<Instance>): Promise<void> {
        const { error, response } = await client.PATCH('/instances/{id}', {
          params: { path: { id } },
          body: body as Record<string, never>,
        });
        throwIfError(response, error);
      },

      /**
       * Delete an instance
       */
      async delete(id: string): Promise<void> {
        const { error, response } = await client.DELETE('/instances/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },

      /**
       * Get instance status
       */
      async status(id: string): Promise<{ state: string; isConnected: boolean; profileName?: string | null }> {
        const { data, error, response } = await client.GET('/instances/{id}/status', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        return data?.data ?? { state: 'unknown', isConnected: false };
      },

      /**
       * Get QR code for WhatsApp instances
       */
      async qr(id: string): Promise<{ qr: string | null; expiresAt: string | null; message: string }> {
        const { data, error, response } = await client.GET('/instances/{id}/qr', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        return data?.data ?? { qr: null, expiresAt: null, message: 'No QR code available' };
      },

      /**
       * Connect an instance
       */
      async connect(id: string, body?: ConnectInstanceBody): Promise<{ status: string; message: string }> {
        const { data, error, response } = await client.POST('/instances/{id}/connect', {
          params: { path: { id } },
          body: body ?? {},
        });
        throwIfError(response, error);
        return data?.data ?? { status: 'connecting', message: 'Connection initiated' };
      },

      /**
       * Disconnect an instance
       */
      async disconnect(id: string): Promise<void> {
        const { error, response } = await client.POST('/instances/{id}/disconnect', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },

      /**
       * Restart an instance
       */
      async restart(id: string, forceNewQr?: boolean): Promise<{ status: string; message: string }> {
        const { data, error, response } = await client.POST('/instances/{id}/restart', {
          params: { path: { id }, query: forceNewQr ? { forceNewQr: 'true' } : undefined },
        });
        throwIfError(response, error);
        return data?.data ?? { status: 'restarting', message: 'Restart initiated' };
      },

      /**
       * Logout an instance (clear session)
       */
      async logout(id: string): Promise<void> {
        const { error, response } = await client.POST('/instances/{id}/logout', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },

      /**
       * Request pairing code for WhatsApp
       */
      async pair(
        id: string,
        body: RequestPairingCodeBody,
      ): Promise<{ code: string; phoneNumber: string; message: string; expiresIn: number }> {
        const { data, error, response } = await client.POST('/instances/{id}/pair', {
          params: { path: { id } },
          body,
        });
        throwIfError(response, error);
        return data?.data ?? { code: '', phoneNumber: '', message: '', expiresIn: 0 };
      },

      /**
       * Sync instance profile immediately
       */
      async syncProfile(id: string): Promise<SyncProfileResult> {
        const resp = await apiFetch(`${baseUrl}/api/v2/instances/${id}/sync/profile`, {
          method: 'POST',
        });
        const json = (await resp.json()) as { data?: SyncProfileResult };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { type: 'profile', status: 'unknown', profile: null };
      },

      /**
       * Start a sync job (messages, contacts, groups, or all)
       */
      async startSync(id: string, body: StartSyncBody): Promise<SyncJobCreated> {
        const resp = await apiFetch(`${baseUrl}/api/v2/instances/${id}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: SyncJobCreated };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { jobId: '', instanceId: id, type: body.type, status: 'pending', config: {}, message: '' };
      },

      /**
       * List sync jobs for an instance
       */
      async listSyncs(id: string, params?: ListSyncsParams): Promise<PaginatedResponse<SyncJobSummary>> {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.limit) query.set('limit', String(params.limit));
        const resp = await apiFetch(`${baseUrl}/api/v2/instances/${id}/sync?${query}`, {});
        const json = (await resp.json()) as { items?: SyncJobSummary[]; meta?: PaginationMeta };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return { items: json?.items ?? [], meta: json?.meta ?? { hasMore: false, cursor: null } };
      },

      /**
       * Get sync job status
       */
      async getSyncStatus(id: string, jobId: string): Promise<SyncJobStatus> {
        const resp = await apiFetch(`${baseUrl}/api/v2/instances/${id}/sync/${jobId}`, {});
        const json = (await resp.json()) as { data?: SyncJobStatus };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Sync job not found', 'NOT_FOUND', undefined, 404);
        return json.data;
      },

      /**
       * List contacts for an instance
       */
      async listContacts(
        id: string,
        params?: ListContactsParams,
      ): Promise<{ items: Contact[]; meta: { totalFetched: number; hasMore: boolean; cursor?: string } }> {
        const query = new URLSearchParams();
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.cursor) query.set('cursor', params.cursor);
        if (params?.guildId) query.set('guildId', params.guildId);
        const resp = await apiFetch(`${baseUrl}/api/v2/instances/${id}/contacts?${query}`, {});
        const json = (await resp.json()) as {
          items?: Contact[];
          meta?: { totalFetched: number; hasMore: boolean; cursor?: string };
        };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return { items: json?.items ?? [], meta: json?.meta ?? { totalFetched: 0, hasMore: false } };
      },

      /**
       * List groups for an instance
       */
      async listGroups(
        id: string,
        params?: ListGroupsParams,
      ): Promise<{ items: Group[]; meta: { totalFetched: number; hasMore: boolean; cursor?: string } }> {
        const query = new URLSearchParams();
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.cursor) query.set('cursor', params.cursor);
        const resp = await apiFetch(`${baseUrl}/api/v2/instances/${id}/groups?${query}`, {});
        const json = (await resp.json()) as {
          items?: Group[];
          meta?: { totalFetched: number; hasMore: boolean; cursor?: string };
        };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return { items: json?.items ?? [], meta: json?.meta ?? { totalFetched: 0, hasMore: false } };
      },

      /**
       * Get user profile from channel
       */
      async getUserProfile(id: string, userId: string): Promise<UserProfile> {
        const resp = await apiFetch(`${baseUrl}/api/v2/instances/${id}/users/${userId}/profile`, {});
        const json = (await resp.json()) as { data?: UserProfile };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('User profile not found', 'NOT_FOUND', undefined, 404);
        return json.data;
      },
    },

    // ========================================================================
    // CHATS
    // ========================================================================

    /**
     * Chat management
     * Note: Uses fetch directly until SDK types are regenerated
     */
    chats: {
      /**
       * List chats
       */
      async list(params?: ListChatsParams): Promise<PaginatedResponse<Chat>> {
        const query = new URLSearchParams();
        const setIfDefined = (key: string, value: string | number | boolean | undefined) => {
          if (value !== undefined) query.set(key, String(value));
        };
        setIfDefined('instanceId', params?.instanceId);
        setIfDefined('channel', params?.channel);
        setIfDefined('chatType', params?.chatType);
        setIfDefined('search', params?.search);
        setIfDefined('includeArchived', params?.includeArchived);
        setIfDefined('limit', params?.limit);
        setIfDefined('cursor', params?.cursor);
        const resp = await apiFetch(`${baseUrl}/api/v2/chats?${query}`, {});
        const json = (await resp.json()) as { items?: Chat[]; meta?: PaginationMeta };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return { items: json?.items ?? [], meta: json?.meta ?? { hasMore: false, cursor: null } };
      },

      /**
       * Get a chat by ID
       */
      async get(id: string): Promise<Chat> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}`, {});
        const json = (await resp.json()) as { data?: Chat };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Chat not found', 'NOT_FOUND', undefined, 404);
        return json.data;
      },

      /**
       * Create a chat
       */
      async create(body: CreateChatBody): Promise<Chat> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: Chat };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to create chat', 'CREATE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Update a chat
       */
      async update(id: string, body: UpdateChatBody): Promise<Chat> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: Chat };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to update chat', 'UPDATE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Delete a chat
       */
      async delete(id: string): Promise<void> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}`, {
          method: 'DELETE',
        });
        if (!resp.ok) throw OmniApiError.from(await resp.json(), resp.status);
      },

      /**
       * Archive a chat
       */
      async archive(id: string): Promise<Chat> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}/archive`, {
          method: 'POST',
        });
        const json = (await resp.json()) as { data?: Chat };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to archive chat', 'ARCHIVE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Unarchive a chat
       */
      async unarchive(id: string): Promise<Chat> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}/unarchive`, {
          method: 'POST',
        });
        const json = (await resp.json()) as { data?: Chat };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to unarchive chat', 'UNARCHIVE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Get messages for a chat
       */
      async getMessages(id: string, params?: ListChatMessagesParams): Promise<Message[]> {
        const query = new URLSearchParams();
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.before) query.set('before', params.before);
        if (params?.after) query.set('after', params.after);
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}/messages?${query}`, {});
        const json = (await resp.json()) as { items?: Message[] };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.items ?? [];
      },

      /**
       * List participants of a chat
       */
      async listParticipants(id: string): Promise<ChatParticipant[]> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}/participants`, {});
        const json = (await resp.json()) as { items?: ChatParticipant[] };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.items ?? [];
      },

      /**
       * Add a participant to a chat
       */
      async addParticipant(id: string, body: AddParticipantBody): Promise<ChatParticipant> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: ChatParticipant };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to add participant', 'ADD_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Remove a participant from a chat
       */
      async removeParticipant(id: string, platformUserId: string): Promise<void> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}/participants/${platformUserId}`, {
          method: 'DELETE',
        });
        if (!resp.ok) throw OmniApiError.from(await resp.json(), resp.status);
      },

      /**
       * Mark entire chat as read
       */
      async markRead(id: string, body: MarkChatReadBody): Promise<MarkReadResult> {
        const resp = await apiFetch(`${baseUrl}/api/v2/chats/${id}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: MarkReadResult };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { chatId: id, instanceId: body.instanceId };
      },
    },

    // ========================================================================
    // MESSAGES
    // ========================================================================

    /**
     * Message sending
     */
    messages: {
      /**
       * Send a text message
       */
      async send(body: SendMessageBody): Promise<{ messageId: string; status: string }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: { messageId: string; status: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId: '', status: 'sent' };
      },

      /**
       * Send a media message
       */
      async sendMedia(body: SendMediaBody): Promise<{ messageId: string; status: string }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: { messageId: string; status: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId: '', status: 'sent' };
      },

      /**
       * Send a reaction
       */
      async sendReaction(body: SendReactionBody): Promise<{ messageId?: string; success: boolean }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/reaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { success?: boolean; data?: { messageId?: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return { success: json?.success ?? true, messageId: json?.data?.messageId };
      },

      /**
       * Send a sticker
       */
      async sendSticker(body: SendStickerBody): Promise<{ messageId: string; status: string }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/sticker`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: { messageId: string; status: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId: '', status: 'sent' };
      },

      /**
       * Send a contact card
       */
      async sendContact(body: SendContactBody): Promise<{ messageId: string; status: string }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: { messageId: string; status: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId: '', status: 'sent' };
      },

      /**
       * Send a location
       */
      async sendLocation(body: SendLocationBody): Promise<{ messageId: string; status: string }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: { messageId: string; status: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId: '', status: 'sent' };
      },

      /**
       * Send a poll (Discord only)
       */
      async sendPoll(body: SendPollBody): Promise<{ messageId: string; status: string }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: { messageId: string; status: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId: '', status: 'sent' };
      },

      /**
       * Send an embed (Discord only)
       */
      async sendEmbed(body: SendEmbedBody): Promise<{ messageId: string; status: string }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: { messageId: string; status: string } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId: '', status: 'sent' };
      },

      /**
       * Send presence indicator (typing, recording, etc.)
       */
      async sendPresence(body: SendPresenceBody): Promise<SendPresenceResult> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/send/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: SendPresenceResult };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return (
          json?.data ?? {
            instanceId: body.instanceId,
            chatId: body.to,
            type: body.type,
            duration: body.duration ?? 5000,
          }
        );
      },

      /**
       * Mark a single message as read
       */
      async markRead(messageId: string, body: MarkMessageReadBody): Promise<MarkReadResult> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/${messageId}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: MarkReadResult };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { messageId };
      },

      /**
       * Mark multiple messages as read in batch
       */
      async batchMarkRead(body: BatchMarkReadBody): Promise<MarkReadResult> {
        const resp = await apiFetch(`${baseUrl}/api/v2/messages/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: MarkReadResult };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return json?.data ?? { chatId: body.chatId, instanceId: body.instanceId, messageCount: body.messageIds.length };
      },
    },

    // ========================================================================
    // EVENTS
    // ========================================================================

    /**
     * Event querying
     */
    events: {
      /**
       * List events with optional filters
       */
      async list(params?: ListEventsParams): Promise<PaginatedResponse<Event>> {
        const { data, error, response } = await client.GET('/events', {
          params: { query: params },
        });
        throwIfError(response, error);
        return {
          items: data?.items ?? [],
          meta: data?.meta ?? { hasMore: false },
        };
      },

      /**
       * Get event analytics
       */
      async analytics(params?: { granularity?: 'hourly' | 'daily' }): Promise<EventAnalytics> {
        const { data, error, response } = await client.GET('/events/analytics', {
          params: { query: params },
        });
        throwIfError(response, error);
        if (!data) throw new OmniApiError('Analytics data not found', 'NOT_FOUND', undefined, 404);
        return data as EventAnalytics;
      },
    },

    // ========================================================================
    // PERSONS
    // ========================================================================

    /**
     * Person/identity search
     */
    persons: {
      /**
       * Search for persons
       */
      async search(params: SearchPersonsParams): Promise<Person[]> {
        const { data, error, response } = await client.GET('/persons', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Get a person by ID
       */
      async get(id: string): Promise<Person> {
        const { data, error, response } = await client.GET('/persons/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Person not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Get person presence (all identities and activity summary)
       */
      async presence(id: string): Promise<{
        person: Person;
        identities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
        byChannel: Record<string, unknown>;
      }> {
        const resp = await apiFetch(`${baseUrl}/api/v2/persons/${id}/presence`, {});
        const json = (await resp.json()) as {
          data?: {
            person: Person;
            identities: Array<Record<string, unknown>>;
            summary: Record<string, unknown>;
            byChannel: Record<string, unknown>;
          };
        };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Person not found', 'NOT_FOUND', undefined, 404);
        return json.data;
      },
    },

    // ========================================================================
    // ACCESS
    // ========================================================================

    /**
     * Access control rules
     */
    access: {
      /**
       * List access rules
       */
      async listRules(params?: ListAccessRulesParams): Promise<AccessRule[]> {
        const { data, error, response } = await client.GET('/access/rules', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Create an access rule
       */
      async createRule(body: CreateAccessRuleBody): Promise<void> {
        const { error, response } = await client.POST('/access/rules', { body });
        throwIfError(response, error);
      },

      /**
       * Delete an access rule
       */
      async deleteRule(id: string): Promise<void> {
        const { error, response } = await client.DELETE('/access/rules/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },

      /**
       * Check if a user has access
       */
      async checkAccess(params: CheckAccessParams): Promise<CheckAccessResult> {
        const { data, error, response } = await client.POST('/access/check', {
          body: params,
        });
        throwIfError(response, error);
        return data?.data ?? { allowed: true, reason: 'Default allow' };
      },
    },

    // ========================================================================
    // SETTINGS
    // ========================================================================

    /**
     * Settings management
     */
    settings: {
      /**
       * List settings
       */
      async list(params?: ListSettingsParams): Promise<Setting[]> {
        const { data, error, response } = await client.GET('/settings', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },
    },

    // ========================================================================
    // PROVIDERS
    // ========================================================================

    /**
     * Provider management
     */
    providers: {
      /**
       * List providers
       */
      async list(params?: ListProvidersParams): Promise<Provider[]> {
        const { data, error, response } = await client.GET('/providers', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Get provider by ID
       */
      async get(id: string): Promise<Provider> {
        const { data, error, response } = await client.GET('/providers/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Provider not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Create a provider
       */
      async create(body: NewAgentProvider): Promise<Provider> {
        const resp = await apiFetch(`${baseUrl}/api/v2/providers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const errorData = await resp.json().catch(() => ({}));
          throw new OmniApiError(
            (errorData as { error?: string }).error ?? resp.statusText,
            'CREATE_FAILED',
            undefined,
            resp.status,
          );
        }
        const data = (await resp.json()) as { data: Provider };
        return data.data;
      },

      /**
       * Delete a provider
       */
      async delete(id: string): Promise<void> {
        const { error, response } = await client.DELETE('/providers/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },

      /**
       * Check provider health
       */
      async checkHealth(id: string): Promise<ProviderHealthResult> {
        const { data, error, response } = await client.POST('/providers/{id}/health', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        return {
          healthy: data?.healthy ?? false,
          latency: data?.latency ?? 0,
          error: data?.error ?? undefined,
        };
      },

      /**
       * List agents from Agno provider
       */
      async listAgents(id: string): Promise<AgnoAgent[]> {
        const resp = await apiFetch(`${baseUrl}/api/v2/providers/${id}/agents`, {
          method: 'GET',
        });
        if (!resp.ok) {
          throw new OmniApiError(`Failed to list agents: ${resp.statusText}`, 'FETCH_ERROR', undefined, resp.status);
        }
        const data = (await resp.json()) as { items: AgnoAgent[] };
        return data.items ?? [];
      },

      /**
       * List teams from Agno provider
       */
      async listTeams(id: string): Promise<AgnoTeam[]> {
        const resp = await apiFetch(`${baseUrl}/api/v2/providers/${id}/teams`, {
          method: 'GET',
        });
        if (!resp.ok) {
          throw new OmniApiError(`Failed to list teams: ${resp.statusText}`, 'FETCH_ERROR', undefined, resp.status);
        }
        const data = (await resp.json()) as { items: AgnoTeam[] };
        return data.items ?? [];
      },

      /**
       * List workflows from Agno provider
       */
      async listWorkflows(id: string): Promise<AgnoWorkflow[]> {
        const resp = await apiFetch(`${baseUrl}/api/v2/providers/${id}/workflows`, {
          method: 'GET',
        });
        if (!resp.ok) {
          throw new OmniApiError(`Failed to list workflows: ${resp.statusText}`, 'FETCH_ERROR', undefined, resp.status);
        }
        const data = (await resp.json()) as { items: AgnoWorkflow[] };
        return data.items ?? [];
      },
    },

    // ========================================================================
    // LOGS
    // ========================================================================

    /**
     * Log querying
     */
    logs: {
      /**
       * Get recent logs
       */
      async recent(
        params?: ListLogsParams,
      ): Promise<{ items: LogEntry[]; meta: { total: number; bufferSize: number; limit: number } }> {
        const { data, error, response } = await client.GET('/logs/recent', {
          params: { query: params },
        });
        throwIfError(response, error);
        return { items: data?.items ?? [], meta: data?.meta ?? { total: 0, bufferSize: 0, limit: 100 } };
      },

      // Note: logs.stream() is SSE and needs EventSource, not included here
    },

    // ========================================================================
    // AUTOMATIONS
    // ========================================================================

    /**
     * Automation management
     */
    automations: {
      /**
       * List automations
       */
      async list(params?: ListAutomationsParams): Promise<Automation[]> {
        const { data, error, response } = await client.GET('/automations', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Get an automation by ID
       */
      async get(id: string): Promise<Automation> {
        const { data, error, response } = await client.GET('/automations/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Automation not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Create an automation
       */
      async create(body: CreateAutomationBody): Promise<Automation> {
        // Use fetch to avoid complex type assertions with discriminated unions
        const resp = await apiFetch(`${baseUrl}/api/v2/automations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: Automation };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to create automation', 'CREATE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Update an automation
       */
      async update(id: string, body: Partial<CreateAutomationBody>): Promise<Automation> {
        // Use fetch to avoid complex type assertions with discriminated unions
        const resp = await apiFetch(`${baseUrl}/api/v2/automations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: Automation };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to update automation', 'UPDATE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Delete an automation
       */
      async delete(id: string): Promise<void> {
        const { error, response } = await client.DELETE('/automations/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },

      /**
       * Enable an automation
       */
      async enable(id: string): Promise<Automation> {
        const { data, error, response } = await client.POST('/automations/{id}/enable', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to enable automation', 'ENABLE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Disable an automation
       */
      async disable(id: string): Promise<Automation> {
        const { data, error, response } = await client.POST('/automations/{id}/disable', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to disable automation', 'DISABLE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Test an automation (dry run)
       */
      async test(id: string, body: TestAutomationBody): Promise<{ matched: boolean; wouldExecute?: unknown[] }> {
        const { data, error, response } = await client.POST('/automations/{id}/test', {
          params: { path: { id } },
          body,
        });
        throwIfError(response, error);
        return data ?? { matched: false };
      },

      /**
       * Execute an automation (actually runs actions)
       */
      async execute(
        id: string,
        body: TestAutomationBody,
      ): Promise<{
        automationId: string;
        triggered: boolean;
        results: Array<{ action: string; status: string; result?: unknown; error?: string; durationMs: number }>;
      }> {
        const { data, error, response } = await client.POST('/automations/{id}/execute', {
          params: { path: { id } },
          body,
        });
        throwIfError(response, error);
        return data ?? { automationId: id, triggered: false, results: [] };
      },

      /**
       * Get logs for an automation
       */
      async getLogs(
        id: string,
        params?: { limit?: number; cursor?: string },
      ): Promise<PaginatedResponse<Record<string, unknown>>> {
        const { data, error, response } = await client.GET('/automations/{id}/logs', {
          params: { path: { id }, query: params },
        });
        throwIfError(response, error);
        return { items: data?.items ?? [], meta: data?.meta ?? { hasMore: false } };
      },
    },

    // ========================================================================
    // DEAD LETTERS
    // ========================================================================

    /**
     * Dead letter management
     */
    deadLetters: {
      /**
       * List dead letters
       */
      async list(params?: ListDeadLettersParams): Promise<PaginatedResponse<DeadLetter>> {
        const { data, error, response } = await client.GET('/dead-letters', {
          params: { query: params },
        });
        throwIfError(response, error);
        return { items: data?.items ?? [], meta: data?.meta ?? { hasMore: false } };
      },

      /**
       * Get a dead letter by ID
       */
      async get(id: string): Promise<DeadLetter> {
        const { data, error, response } = await client.GET('/dead-letters/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Dead letter not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Get dead letter statistics
       */
      async stats(): Promise<{
        pending: number;
        retrying: number;
        resolved: number;
        abandoned: number;
        total: number;
      }> {
        const { data, error, response } = await client.GET('/dead-letters/stats');
        throwIfError(response, error);
        return data?.data ?? { pending: 0, retrying: 0, resolved: 0, abandoned: 0, total: 0 };
      },

      /**
       * Retry a dead letter
       */
      async retry(id: string): Promise<{ success: boolean; error?: string }> {
        const { data, error, response } = await client.POST('/dead-letters/{id}/retry', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        return data ?? { success: true };
      },

      /**
       * Resolve a dead letter
       */
      async resolve(id: string, body: ResolveDeadLetterBody): Promise<DeadLetter> {
        const { data, error, response } = await client.POST('/dead-letters/{id}/resolve', {
          params: { path: { id } },
          body,
        });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to resolve dead letter', 'RESOLVE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Abandon a dead letter
       */
      async abandon(id: string): Promise<DeadLetter> {
        const { data, error, response } = await client.POST('/dead-letters/{id}/abandon', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to abandon dead letter', 'ABANDON_FAILED', undefined, response.status);
        return data.data;
      },
    },

    // ========================================================================
    // EVENT OPS
    // ========================================================================

    /**
     * Event operations
     */
    eventOps: {
      /**
       * Get event metrics
       */
      async metrics(): Promise<Record<string, unknown>> {
        const { data, error, response } = await client.GET('/event-ops/metrics');
        throwIfError(response, error);
        return data?.data ?? {};
      },

      /**
       * Start a replay session
       */
      async startReplay(body: StartReplayBody): Promise<ReplaySession> {
        const { data, error, response } = await client.POST('/event-ops/replay', { body });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Failed to start replay', 'REPLAY_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * List replay sessions
       */
      async listReplays(): Promise<ReplaySession[]> {
        const { data, error, response } = await client.GET('/event-ops/replay');
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Get a replay session by ID
       */
      async getReplay(id: string): Promise<ReplaySession> {
        const { data, error, response } = await client.GET('/event-ops/replay/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Replay session not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Cancel a replay session
       */
      async cancelReplay(id: string): Promise<void> {
        const { error, response } = await client.DELETE('/event-ops/replay/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },
    },

    // ========================================================================
    // WEBHOOKS
    // ========================================================================

    /**
     * Webhook source management
     */
    webhooks: {
      /**
       * List webhook sources
       */
      async listSources(params?: ListWebhookSourcesParams): Promise<WebhookSource[]> {
        const { data, error, response } = await client.GET('/webhook-sources', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Get a webhook source by ID
       */
      async getSource(id: string): Promise<WebhookSource> {
        const { data, error, response } = await client.GET('/webhook-sources/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Webhook source not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Create a webhook source
       */
      async createSource(body: CreateWebhookSourceBody): Promise<WebhookSource> {
        const { data, error, response } = await client.POST('/webhook-sources', { body });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to create webhook source', 'CREATE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Update a webhook source
       */
      async updateSource(id: string, body: Partial<CreateWebhookSourceBody>): Promise<WebhookSource> {
        const { data, error, response } = await client.PATCH('/webhook-sources/{id}', {
          params: { path: { id } },
          body,
        });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to update webhook source', 'UPDATE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Delete a webhook source
       */
      async deleteSource(id: string): Promise<void> {
        const { error, response } = await client.DELETE('/webhook-sources/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },

      /**
       * Trigger a custom event
       */
      async trigger(body: TriggerEventBody): Promise<{ eventId: string; eventType: string }> {
        const { data, error, response } = await client.POST('/events/trigger', { body });
        throwIfError(response, error);
        return data ?? { eventId: '', eventType: body.eventType };
      },
    },

    // ========================================================================
    // PAYLOADS
    // ========================================================================

    /**
     * Payload management
     */
    payloads: {
      /**
       * List payloads for an event
       */
      async listForEvent(eventId: string): Promise<Array<{ stage: string; hasData: boolean; createdAt: string }>> {
        const { data, error, response } = await client.GET('/events/{eventId}/payloads', {
          params: { path: { eventId } },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Get a specific stage payload
       */
      async getStage(
        eventId: string,
        stage: 'webhook_raw' | 'agent_request' | 'agent_response' | 'channel_send' | 'error',
      ): Promise<{ payload?: unknown }> {
        const { data, error, response } = await client.GET('/events/{eventId}/payloads/{stage}', {
          params: { path: { eventId, stage } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Payload not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Delete payloads for an event
       */
      async delete(eventId: string, body: DeletePayloadsBody): Promise<{ deleted: number }> {
        const { data, error, response } = await client.DELETE('/events/{eventId}/payloads', {
          params: { path: { eventId } },
          body,
        });
        throwIfError(response, error);
        return data ?? { deleted: 0 };
      },

      /**
       * List payload configs
       */
      async listConfigs(): Promise<PayloadConfig[]> {
        const { data, error, response } = await client.GET('/payload-config');
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Update payload config for an event type
       */
      async updateConfig(eventType: string, body: UpdatePayloadConfigBody): Promise<PayloadConfig> {
        const { data, error, response } = await client.PUT('/payload-config/{eventType}', {
          params: { path: { eventType } },
          body,
        });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to update payload config', 'UPDATE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Get payload statistics
       */
      async stats(): Promise<{
        totalPayloads: number;
        totalSizeBytes: number;
        byStage: Record<string, number | undefined>;
      }> {
        const { data, error, response } = await client.GET('/payload-stats');
        throwIfError(response, error);
        return data?.data ?? { totalPayloads: 0, totalSizeBytes: 0, byStage: {} };
      },
    },

    // ========================================================================
    // BATCH JOBS
    // ========================================================================

    /**
     * Batch job management for media processing
     */
    batchJobs: {
      /**
       * Create a batch processing job
       */
      async create(body: CreateBatchJobBody): Promise<BatchJob> {
        const resp = await apiFetch(`${baseUrl}/api/v2/batch-jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: BatchJob };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to create batch job', 'CREATE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Get a batch job by ID
       */
      async get(id: string): Promise<BatchJob> {
        const resp = await apiFetch(`${baseUrl}/api/v2/batch-jobs/${id}`, {});
        const json = (await resp.json()) as { data?: BatchJob };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Batch job not found', 'NOT_FOUND', undefined, 404);
        return json.data;
      },

      /**
       * Get batch job status (lightweight, for polling)
       */
      async getStatus(id: string): Promise<BatchJobStatusResponse> {
        const resp = await apiFetch(`${baseUrl}/api/v2/batch-jobs/${id}/status`, {});
        const json = (await resp.json()) as { data?: BatchJobStatusResponse };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Batch job not found', 'NOT_FOUND', undefined, 404);
        return json.data;
      },

      /**
       * List batch jobs
       */
      async list(params?: ListBatchJobsParams): Promise<PaginatedResponse<BatchJob>> {
        const query = new URLSearchParams();
        if (params?.instanceId) query.set('instanceId', params.instanceId);
        if (params?.status) query.set('status', params.status.join(','));
        if (params?.jobType) query.set('jobType', params.jobType.join(','));
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.cursor) query.set('cursor', params.cursor);
        const resp = await apiFetch(`${baseUrl}/api/v2/batch-jobs?${query}`, {});
        const json = (await resp.json()) as { items?: BatchJob[]; meta?: PaginationMeta };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return { items: json?.items ?? [], meta: json?.meta ?? { hasMore: false, cursor: null } };
      },

      /**
       * Cancel a running batch job
       */
      async cancel(id: string): Promise<BatchJob> {
        const resp = await apiFetch(`${baseUrl}/api/v2/batch-jobs/${id}/cancel`, {
          method: 'POST',
        });
        const json = (await resp.json()) as { data?: BatchJob };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to cancel batch job', 'CANCEL_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Estimate cost before creating a job
       */
      async estimate(body: Omit<CreateBatchJobBody, 'force'>): Promise<CostEstimate> {
        const resp = await apiFetch(`${baseUrl}/api/v2/batch-jobs/estimate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: CostEstimate };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to estimate', 'ESTIMATE_FAILED', undefined, resp.status);
        return json.data;
      },
    },

    // ========================================================================
    // KEYS
    // ========================================================================

    /**
     * API key management
     */
    keys: {
      /**
       * Create a new API key
       * The plainTextKey is only returned in this response.
       */
      async create(body: CreateApiKeyBody): Promise<CreateApiKeyResult> {
        const resp = await apiFetch(`${baseUrl}/api/v2/keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: CreateApiKeyResult };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to create API key', 'CREATE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * List API keys
       */
      async list(params?: ListApiKeysParams): Promise<{ items: ApiKeyRecord[]; meta: { total: number } }> {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.limit) query.set('limit', String(params.limit));
        const resp = await apiFetch(`${baseUrl}/api/v2/keys?${query}`, {});
        const json = (await resp.json()) as { items?: ApiKeyRecord[]; meta?: { total: number } };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        return { items: json?.items ?? [], meta: json?.meta ?? { total: 0 } };
      },

      /**
       * Get an API key by ID
       */
      async get(id: string): Promise<ApiKeyRecord> {
        const resp = await apiFetch(`${baseUrl}/api/v2/keys/${id}`, {});
        const json = (await resp.json()) as { data?: ApiKeyRecord };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('API key not found', 'NOT_FOUND', undefined, 404);
        return json.data;
      },

      /**
       * Update an API key
       */
      async update(id: string, body: UpdateApiKeyBody): Promise<ApiKeyRecord> {
        const resp = await apiFetch(`${baseUrl}/api/v2/keys/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = (await resp.json()) as { data?: ApiKeyRecord };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to update API key', 'UPDATE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Revoke an API key
       */
      async revoke(id: string, body?: RevokeApiKeyBody): Promise<ApiKeyRecord> {
        const resp = await apiFetch(`${baseUrl}/api/v2/keys/${id}/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        const json = (await resp.json()) as { data?: ApiKeyRecord };
        if (!resp.ok) throw OmniApiError.from(json, resp.status);
        if (!json?.data) throw new OmniApiError('Failed to revoke API key', 'REVOKE_FAILED', undefined, resp.status);
        return json.data;
      },

      /**
       * Delete an API key permanently
       */
      async delete(id: string): Promise<void> {
        const resp = await apiFetch(`${baseUrl}/api/v2/keys/${id}`, {
          method: 'DELETE',
        });
        if (!resp.ok) throw OmniApiError.from(await resp.json(), resp.status);
      },
    },

    // ========================================================================
    // SYSTEM
    // ========================================================================

    /**
     * System health
     */
    system: {
      /**
       * Get health status (no auth required)
       */
      async health(): Promise<HealthResponse> {
        // Health endpoint doesn't require auth, but we need Accept-Encoding: identity
        // to avoid Bun/Hono gzip compatibility issues
        const healthClient = createClient<paths>({ baseUrl: `${baseUrl}/api/v2` });
        const noCompressionMiddleware: Middleware = {
          async onRequest({ request }) {
            request.headers.set('Accept-Encoding', 'identity');
            return request;
          },
        };
        healthClient.use(noCompressionMiddleware);
        const { data, error, response } = await healthClient.GET('/health');
        throwIfError(response, error);
        return data ?? { status: 'unhealthy' };
      },
    },

    /**
     * Raw openapi-fetch client for advanced usage
     */
    raw: client,
  };
}

/**
 * Type for the Omni client
 */
export type OmniClient = ReturnType<typeof createOmniClient>;
