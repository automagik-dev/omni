/**
 * Typed data layer for Omni capabilities that are NOT in the OpenAPI spec and
 * therefore absent from the generated `@omni/sdk` surface — the "off-spec" and
 * "dark" families the capability inventory tracks (trust, handoffs, follow-up,
 * agent-state one-shot, turns, context).
 *
 * Every call goes through the BFF `/omni` mount (see {@link createOmniAdminClient}),
 * so the API key stays server-side. Group B builds views on top of these typed
 * helpers; Group A ships the contract.
 */
// Turn admin types — defined here because `@omni/sdk` keeps them internal
// (not re-exported from its entrypoint).
export interface TurnItem {
  id: string;
  instanceId: string;
  chatId: string;
  messageId: string;
  agentId: string;
  apiKeyId: string;
  status: string;
  action: string | null;
  nudgeCount: number;
  messagesSent: number;
  startedAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  closedReason: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TurnListResponse {
  items: TurnItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface TurnStats {
  openCount: number;
  totalCount: number;
  avgDurationMs: number;
  timeoutRate: number;
}

// ── Off-spec result shapes (index signatures capture undocumented fields) ─────

export interface TrustHost {
  id: string;
  hostId?: string;
  label?: string | null;
  scopes?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface HandoffRecord {
  id: string;
  chatId?: string;
  instanceId?: string;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  reason?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface FollowUpConfig {
  enabled?: boolean;
  idleMinutes?: number | null;
  prompt?: string | null;
  [key: string]: unknown;
}

// ── Instance sub-resource shapes (off-spec / broader than the narrow SDK type) ──

/**
 * The full instance row. The generated `Instance` type in `@omni/sdk` is a
 * summary — it omits the ~60 config columns the detail endpoint actually
 * returns. This index-signature type captures the complete row so the config
 * editor and read-back diff see every field.
 */
export interface InstanceRow {
  id: string;
  name: string;
  channel: string;
  isActive: boolean;
  isDefault: boolean;
  [key: string]: unknown;
}

export interface SupportedChannel {
  id: string;
  name: string;
  description?: string;
  version?: string;
  loaded: boolean;
  capabilities?: Record<string, unknown>;
}

export interface BlocklistEntry {
  jid?: string;
  id?: string;
  name?: string | null;
  [key: string]: unknown;
}

export interface GuildSummary {
  id: string;
  name?: string | null;
  [key: string]: unknown;
}

export interface AgentRouteRow {
  id: string;
  instanceId: string;
  scope: string;
  agentId: string | null;
  chatId?: string | null;
  personId?: string | null;
  label?: string | null;
  priority?: number;
  isActive?: boolean;
  [key: string]: unknown;
}

/** The agent state-machine statuses the backend accepts (NATS KV enum). */
export const AGENT_STATUSES = ['idle', 'thinking', 'typing', 'sending', 'running_task', 'waiting', 'error'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export interface AgentStateSnapshot {
  agentId: string;
  chatId: string;
  conversationId?: string | null;
  status?: AgentStatus | string;
  statusMeta?: Record<string, unknown> | null;
  /** Epoch milliseconds. */
  updatedAt?: number;
  [key: string]: unknown;
}

export interface ContextResult {
  chatId?: string;
  messages?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ── Live-chat rich shapes (broader than the narrow SDK Chat/Message types) ─────
// The generated `@omni/sdk` Chat/Message types are summaries; the live endpoints
// return ~40 columns the WhatsApp-Web console needs (unread counts, delivery
// status, reactions, media, sender identity). Index signatures capture the rest.

/** A chat row as the live `/chats` endpoint returns it. */
export interface ChatRow {
  id: string;
  instanceId: string;
  externalId: string;
  canonicalId?: string | null;
  chatType: string;
  channel: string;
  name?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  parentChatId?: string | null;
  participantCount?: number;
  messageCount?: number;
  unreadCount?: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastMessageFromMe?: boolean;
  /** 'visible' | 'archived' | 'hidden'. */
  visibility?: string;
  labels?: string[];
  settings?: Record<string, unknown> | null;
  conversationId?: string | null;
  isGroup?: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** A message row as the live `/chats/:id/messages` and `/messages` endpoints return it. */
export interface MessageRow {
  id: string;
  chatId: string;
  externalId?: string | null;
  source?: string;
  senderPersonId?: string | null;
  senderPlatformUserId?: string | null;
  senderDisplayName?: string | null;
  senderAgentId?: string | null;
  isFromMe?: boolean;
  messageType: string;
  textContent?: string | null;
  transcription?: string | null;
  imageDescription?: string | null;
  videoDescription?: string | null;
  documentExtraction?: string | null;
  hasMedia?: boolean;
  mediaMimeType?: string | null;
  mediaUrl?: string | null;
  mediaLocalPath?: string | null;
  mediaMetadata?: Record<string, unknown> | null;
  replyToMessageId?: string | null;
  quotedText?: string | null;
  quotedSenderName?: string | null;
  isForwarded?: boolean;
  forwardCount?: number;
  mentions?: unknown;
  status?: string | null;
  /** 'pending' | 'sent' | 'delivered' | 'read' | 'failed'. */
  deliveryStatus?: string | null;
  editCount?: number;
  editedAt?: string | null;
  reactions?: unknown;
  reactionCounts?: Record<string, number> | null;
  platformTimestamp?: string | null;
  receivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** An event row as the live `/events` endpoint returns it (pipeline trace). */
export interface EventRow {
  id: string;
  externalId?: string | null;
  channel?: string;
  instanceId?: string;
  eventType: string;
  direction?: string | null;
  contentType?: string | null;
  textContent?: string | null;
  /** The chat's external JID (e.g. `...@s.whatsapp.net`). */
  chatId?: string | null;
  /** The chat's internal UUID — the join key back to a `ChatRow.id`. */
  chatUuid?: string | null;
  conversationId?: string | null;
  agentId?: string | null;
  status?: string | null;
  errorMessage?: string | null;
  errorStage?: string | null;
  receivedAt?: string | null;
  processedAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  processingTimeMs?: number | null;
  agentLatencyMs?: number | null;
  totalLatencyMs?: number | null;
  rawPayload?: unknown;
  agentRequest?: unknown;
  agentResponse?: unknown;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  [key: string]: unknown;
}

/** A staged payload record from `/events/:id/payloads` (request/response snapshots). */
export interface EventPayloadRecord {
  id?: string;
  eventId?: string;
  stage?: string;
  payload?: unknown;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ListChatsExtParams {
  instanceId?: string;
  channel?: string;
  chatType?: string;
  excludeChatTypes?: string;
  search?: string;
  includeArchived?: boolean;
  includeHidden?: boolean;
  unreadOnly?: boolean;
  sort?: 'activity' | 'unread' | 'name';
  limit?: number;
  cursor?: string;
  label?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ListMessagesExtParams {
  limit?: number;
  before?: string;
  after?: string;
  mediaOnly?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface PaginatedRows<T> {
  items: T[];
  meta?: { hasMore?: boolean; cursor?: string | null; total?: number };
}

export interface MediaDownloadResult {
  messageId: string;
  instanceId: string;
  mediaMimeType?: string | null;
  mediaLocalPath?: string | null;
  downloadUrl: string;
  cached: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
  mode?: string;
  [key: string]: unknown;
}

export interface AgentSummary {
  id: string;
  name?: string | null;
  provider?: string | null;
  model?: string | null;
  agentProviderId?: string | null;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface ProviderSummary {
  id: string;
  name?: string | null;
  schema?: string | null;
  [key: string]: unknown;
}

export interface ListTurnsParams {
  instanceId?: string;
  chatId?: string;
  agentId?: string;
  status?: string;
  limit?: number;
  offset?: number;
  [key: string]: string | number | undefined;
}

export interface OmniError {
  code: string;
  message: string;
  upstreamStatus?: number;
}

// ── Agents / automation family shapes (Group E) ───────────────────────────────
// Full rows for the agents-automation vertical. These mirror the API's Drizzle
// rows (broader than the summary `AgentSummary`/`ProviderSummary` above) so the
// registry cards and detail views can render every field the schema exposes.

export type AgentProvider = 'claude' | 'agno' | 'openai' | 'gemini' | 'custom' | 'omni-internal';
export type AgentType = 'assistant' | 'workflow' | 'team' | 'tool';

/** A full agent row from GET /agents / GET /agents/:id. */
export interface AgentRow {
  id: string;
  name: string;
  provider: AgentProvider | string;
  model?: string | null;
  agentType: AgentType | string;
  capabilities?: string[];
  ownerId?: string | null;
  agentProviderId?: string | null;
  configPath?: string | null;
  isInternal?: boolean;
  isActive?: boolean;
  metadata?: Record<string, unknown> | null;
  agentCard?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AgentIdentityRow {
  id?: string;
  platformIdentityId?: string;
  agentId?: string;
  [key: string]: unknown;
}

export type AgentTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_input';

export interface AgentTaskRow {
  id: string;
  agentId: string;
  chatId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  type: string;
  title: string;
  description?: string | null;
  status: AgentTaskStatus | string;
  progress?: number;
  priority?: number;
  metadata?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  parentTaskId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** A full provider row. `apiKey` arrives masked; sensitive schemaConfig is `[REDACTED]`. */
export interface ProviderRow {
  id: string;
  name: string;
  schema?: string;
  baseUrl?: string;
  apiKey?: string | null;
  schemaConfig?: Record<string, unknown> | null;
  defaultStream?: boolean;
  defaultTimeout?: number;
  supportsStreaming?: boolean;
  supportsImages?: boolean;
  supportsAudio?: boolean;
  supportsDocuments?: boolean;
  description?: string | null;
  tags?: string[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** POST /providers/:id/health response. */
export interface ProviderHealth {
  healthy: boolean;
  latency?: number;
  error?: string | null;
}

/** A discovered entry (agent/team/workflow) from a provider's discovery call. */
export interface ProviderEntry {
  id?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

/** Provider sub-resource list — carries a `message` when the schema doesn't support discovery. */
export interface ProviderEntriesResult {
  items?: ProviderEntry[];
  message?: string;
  error?: string;
}

export interface AutomationRow {
  id: string;
  name: string;
  description?: string | null;
  triggerEventType: string;
  triggerConditions?: Array<Record<string, unknown>>;
  conditionLogic?: 'and' | 'or' | string;
  actions?: Array<Record<string, unknown>>;
  debounce?: Record<string, unknown> | null;
  enabled?: boolean;
  priority?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AutomationTestResult {
  matched: boolean;
  conditions?: unknown[];
  actions?: Array<{ type: string; wouldExecute: boolean }>;
  dryRun?: boolean;
  [key: string]: unknown;
}

export interface AutomationExecuteResult {
  automationId: string;
  triggered: boolean;
  results: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface AutomationLogRow {
  id?: string;
  automationId?: string;
  eventId?: string;
  status?: 'success' | 'failed' | 'skipped' | string;
  conditionsMatched?: boolean;
  actionsExecuted?: unknown;
  error?: string | null;
  executionTimeMs?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export interface AutomationMetrics {
  running?: boolean;
  instanceQueues?: unknown[];
  totalExecutions?: number;
  totalActions?: number;
  successRate?: number;
  avgExecutionTimeMs?: number;
  recentFailures?: number;
  [key: string]: unknown;
}

export type BatchJobType = 'targeted_chat_sync' | 'time_based_batch' | 'media_redownload';
export type BatchJobStatusValue = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BatchJobRow {
  id: string;
  jobType: BatchJobType | string;
  instanceId: string;
  status: BatchJobStatusValue | string;
  requestParams?: Record<string, unknown> | null;
  totalItems?: number;
  processedItems?: number;
  failedItems?: number;
  skippedItems?: number;
  currentItem?: string | null;
  progressPercent?: number;
  totalCostUsd?: number | string;
  totalTokens?: number;
  errorMessage?: string | null;
  errors?: Array<Record<string, unknown>>;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  [key: string]: unknown;
}

export interface BatchJobStatusRow {
  id: string;
  status: BatchJobStatusValue | string;
  totalItems?: number;
  processedItems?: number;
  failedItems?: number;
  skippedItems?: number;
  progressPercent?: number;
  currentItem?: string | null;
  totalCostUsd?: number;
  totalTokens?: number;
  estimatedCompletion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  [key: string]: unknown;
}

export interface BatchJobEstimate {
  totalItems?: number;
  estimatedCostUsd?: number;
  estimatedTokens?: number;
  breakdown?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RouteCacheMetrics {
  cache?: Record<string, unknown>;
  timestamp?: string;
  [key: string]: unknown;
}

export interface ListAgentsParams {
  ownerId?: string;
  provider?: string;
  isActive?: boolean;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ListAgentTasksParams {
  agentId?: string;
  chatId?: string;
  conversationId?: string;
  status?: string;
  type?: string;
  parentTaskId?: string;
  limit?: number;
  cursor?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ListAutomationLogsParams {
  limit?: number;
  cursor?: string;
  status?: string;
  eventType?: string;
  automationId?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ListBatchJobsParams {
  instanceId?: string;
  status?: string;
  jobType?: string;
  limit?: number;
  cursor?: string;
  [key: string]: string | number | boolean | undefined;
}

// ── Horizontal-coverage family shapes (Group F) ───────────────────────────────
// Loose index-signatured rows for the remaining Omni families the breadth pass
// surfaces. Shapes mirror the API's Drizzle rows / service returns; index
// signatures capture undocumented columns so tables/detail views see every field.

export interface ConversationRow {
  id: string;
  title?: string | null;
  summary?: string | null;
  state?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PersonRow {
  id: string;
  displayName?: string | null;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  avatarUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PersonPresence {
  person?: PersonRow;
  identities?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
  byChannel?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ContactRow {
  platformUserId?: string;
  displayName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  isGroup?: boolean;
  isBusiness?: boolean;
  platformMetadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface GroupRow {
  externalId?: string;
  name?: string | null;
  description?: string | null;
  memberCount?: number;
  createdAt?: string | null;
  createdBy?: string | null;
  isReadOnly?: boolean;
  platformMetadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface JourneySummary {
  totalTracked?: number;
  completedJourneys?: number;
  activeJourneys?: number;
  since?: number;
  stages?: Record<
    string,
    { count: number; avg: number; min: number; max: number; p50: number; p95: number; p99: number }
  >;
  [key: string]: unknown;
}

export interface Journey {
  correlationId?: string;
  checkpoints?: Array<{ name: string; stage: string; timestamp: number }>;
  startedAt?: number;
  completedAt?: number;
  latencies?: Record<string, number>;
  [key: string]: unknown;
}

export interface VoiceSession {
  sessionId: string;
  instanceId?: string;
  channelId?: string;
  state?: string;
  participants?: unknown;
  createdAt?: string;
  [key: string]: unknown;
}

export interface EventAnalytics {
  totalMessages?: number;
  successfulMessages?: number;
  failedMessages?: number;
  successRate?: number;
  avgProcessingTimeMs?: number | null;
  avgAgentTimeMs?: number | null;
  messageTypes?: Record<string, number>;
  errorStages?: Record<string, number>;
  instances?: Record<string, number>;
  byChannel?: Record<string, number>;
  byDirection?: { inbound: number; outbound: number };
  timeline?: Array<{ bucket: string; count: number }>;
  [key: string]: unknown;
}

export interface EventMetrics {
  totalEvents?: number;
  eventsLast24h?: number;
  eventsLast7d?: number;
  eventsLastHour?: number;
  eventsPerHour?: number;
  eventsPerMinute?: number;
  completed?: number;
  failed?: number;
  pending?: number;
  avgProcessingTimeMs?: number | null;
  avgAgentLatencyMs?: number | null;
  p95ProcessingTimeMs?: number | null;
  failureRate?: number;
  errorsByStage?: Record<string, number>;
  deadLettersPending?: number;
  deadLettersResolved?: number;
  payloadsStored?: number;
  storageSizeBytes?: number;
  [key: string]: unknown;
}

export interface ReplaySession {
  id: string;
  status?: string;
  options?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  dryRun?: boolean;
  [key: string]: unknown;
}

export interface DeadLetterRow {
  id: string;
  eventId?: string;
  eventType?: string;
  subject?: string;
  payload?: unknown;
  error?: string;
  stack?: string | null;
  autoRetryCount?: number;
  manualRetryCount?: number;
  nextAutoRetryAt?: string | null;
  status?: 'pending' | 'retrying' | 'resolved' | 'abandoned' | string;
  createdAt?: string;
  lastRetryAt?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  [key: string]: unknown;
}

export interface DeadLetterStats {
  total?: number;
  pending?: number;
  resolved?: number;
  abandoned?: number;
  byEventType?: Record<string, number>;
  [key: string]: unknown;
}

export interface LogEntry {
  time?: string | number;
  level?: string;
  module?: string;
  msg?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SettingRow {
  id?: string;
  key: string;
  value?: unknown;
  valueType?: 'string' | 'integer' | 'boolean' | 'json' | 'secret' | string;
  category?: string | null;
  description?: string | null;
  isSecret?: boolean;
  isRequired?: boolean;
  defaultValue?: unknown;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string | null;
  [key: string]: unknown;
}

export interface SettingHistoryRow {
  oldValue?: unknown;
  newValue?: unknown;
  changedBy?: string | null;
  changedAt?: string;
  changeReason?: string | null;
  [key: string]: unknown;
}

export interface PayloadConfigRow {
  id?: string;
  eventType: string;
  storeWebhookRaw?: boolean;
  storeAgentRequest?: boolean;
  storeAgentResponse?: boolean;
  storeChannelSend?: boolean;
  storeError?: boolean;
  retentionDays?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PayloadStats {
  totalPayloads?: number;
  totalSizeOriginal?: number;
  totalSizeCompressed?: number;
  avgCompressionRatio?: number;
  byStage?: Record<string, number>;
  byEventType?: Record<string, number>;
  [key: string]: unknown;
}

export interface EventPayloadStageRecord {
  id?: string;
  eventId?: string;
  eventType?: string;
  stage?: string;
  payloadSizeOriginal?: number | null;
  payloadSizeCompressed?: number | null;
  timestamp?: string;
  containsMedia?: boolean;
  containsBase64?: boolean;
  deletedAt?: string | null;
  hasData?: boolean;
  payload?: unknown;
  [key: string]: unknown;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  description?: string | null;
  keyPrefix?: string;
  scopes?: string[];
  profile?: string | null;
  instanceIds?: string[];
  status?: 'active' | 'revoked' | 'expired' | string;
  rateLimit?: number | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  usageCount?: number;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
  createdAt?: string;
  /** Present ONLY on the create response, once. */
  plainTextKey?: string;
  [key: string]: unknown;
}

export interface ApiKeyAuditRow {
  id?: string;
  apiKeyId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  responseTimeMs?: number | null;
  timestamp?: string;
  [key: string]: unknown;
}

export interface WebhookSourceRow {
  id: string;
  name: string;
  description?: string | null;
  expectedHeaders?: Record<string, boolean> | null;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AccessRuleRow {
  id: string;
  instanceId?: string | null;
  ruleType?: 'allow' | 'deny' | string;
  phonePattern?: string | null;
  platformUserId?: string | null;
  personId?: string | null;
  priority?: number;
  enabled?: boolean;
  reason?: string | null;
  action?: 'block' | 'allow' | 'silent_block' | string;
  blockMessage?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface MediaResult {
  provider?: string;
  [key: string]: unknown;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(`${base}/api/v2${path}`, init);
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (json as { error?: OmniError } | undefined)?.error;
    throw new Error(err?.message ?? `Omni request failed (${res.status})`);
  }
  return json as T;
}

// ── Typed off-spec surface ────────────────────────────────────────────────────

/**
 * Factory for the off-spec Omni surface, bound to a BFF base
 * (default `/omni`, proxied by Vite in the harness).
 */
export function omniExt(base = '/omni') {
  const get = <T>(path: string) => request<T>(base, 'GET', path);
  const post = <T>(path: string, body?: unknown) => request<T>(base, 'POST', path, body);
  const put = <T>(path: string, body?: unknown) => request<T>(base, 'PUT', path, body);
  const patch = <T>(path: string, body?: unknown) => request<T>(base, 'PATCH', path, body);
  const del = <T>(path: string, body?: unknown) => request<T>(base, 'DELETE', path, body);
  const enc = encodeURIComponent;

  return {
    trust: {
      listHosts: () => get<{ items?: TrustHost[] }>('/trust/hosts'),
      getHost: (id: string) => get<{ data?: TrustHost }>(`/trust/hosts/${encodeURIComponent(id)}`),
      handshake: (body: Record<string, unknown>) => post<{ data?: TrustHost }>('/trust/handshake', body),
      /** LIVE: wholesale-replace a host's scopes. */
      patchScopes: (id: string, scopes: string[]) => patch<{ data?: TrustHost }>(`/trust/hosts/${enc(id)}`, { scopes }),
      /** DESTRUCTIVE: revoke a trust host (breaks its signing). */
      remove: (id: string) => del<{ data?: TrustHost }>(`/trust/hosts/${enc(id)}`),
    },
    handoffs: {
      list: (params?: { chatId?: string; instanceId?: string; limit?: number; offset?: number }) =>
        get<{ data?: HandoffRecord[]; meta?: { limit?: number; offset?: number; count?: number } }>(
          `/handoffs${buildQuery(params)}`,
        ),
      get: (id: string) => get<{ data?: HandoffRecord }>(`/handoffs/${encodeURIComponent(id)}`),
    },
    followUp: {
      getForChat: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/chats/${enc(id)}`),
      setForChat: (id: string, body: FollowUpConfig) =>
        put<{ data?: FollowUpConfig }>(`/follow-up/chats/${enc(id)}`, body),
      clearForChat: (id: string) => del<{ data?: unknown }>(`/follow-up/chats/${enc(id)}`),
      getForAgent: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/agents/${enc(id)}`),
      setForAgent: (id: string, body: FollowUpConfig) =>
        put<{ data?: FollowUpConfig }>(`/follow-up/agents/${enc(id)}`, body),
      clearForAgent: (id: string) => del<{ data?: unknown }>(`/follow-up/agents/${enc(id)}`),
      getForInstance: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/instances/${enc(id)}`),
      setForInstance: (id: string, body: FollowUpConfig) =>
        put<{ data?: FollowUpConfig }>(`/follow-up/instances/${enc(id)}`, body),
      clearForInstance: (id: string) => del<{ data?: unknown }>(`/follow-up/instances/${enc(id)}`),
    },
    /**
     * Instance sub-resources absent from the generated SDK surface. Every path
     * goes through the same BFF mount, so the API key stays server-side. Group C
     * (instances slice) builds the per-instance config, lifecycle, groups,
     * blocklist, recovery, Discord, and routing views on top of these.
     */
    instances: {
      // Create with channel-specific fields (broader than the narrow SDK body).
      create: (body: Record<string, unknown>) => post<{ data?: InstanceRow }>('/instances', body),
      // Full config row + partial config PATCH (broader than the narrow SDK type).
      getRaw: (id: string) => get<{ data?: InstanceRow }>(`/instances/${enc(id)}`),
      patch: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: InstanceRow }>(`/instances/${enc(id)}`, body),
      supportedChannels: () => get<{ items?: SupportedChannel[] }>('/instances/supported-channels'),
      list: () => get<{ items?: InstanceRow[] }>('/instances'),
      // Per-instance directory reads (contacts / groups fan-in for the messaging pages).
      contacts: (id: string, params?: { limit?: number; search?: string; guildId?: string; excludeGroups?: boolean }) =>
        get<{ items?: ContactRow[]; meta?: Record<string, unknown> }>(
          `/instances/${enc(id)}/contacts${buildQuery(params)}`,
        ),
      groups: (id: string, params?: { limit?: number; search?: string }) =>
        get<{ items?: GroupRow[]; meta?: Record<string, unknown> }>(
          `/instances/${enc(id)}/groups${buildQuery(params)}`,
        ),

      // Profile writes.
      setProfileName: (id: string, name: string) =>
        put<{ data?: unknown }>(`/instances/${enc(id)}/profile/name`, { name }),
      setProfileStatus: (id: string, status: string) =>
        put<{ data?: unknown }>(`/instances/${enc(id)}/profile/status`, { status }),
      setProfilePicture: (id: string, base64: string, mimeType?: string) =>
        put<{ data?: unknown }>(`/instances/${enc(id)}/profile/picture`, { base64, mimeType }),
      deleteProfilePicture: (id: string) => del<{ data?: unknown }>(`/instances/${enc(id)}/profile/picture`),

      // Blocklist.
      blocklist: (id: string) => get<{ items?: BlocklistEntry[] }>(`/instances/${enc(id)}/blocklist`),
      block: (id: string, contactId: string) => post<{ data?: unknown }>(`/instances/${enc(id)}/block`, { contactId }),
      unblock: (id: string, contactId: string) => del<{ data?: unknown }>(`/instances/${enc(id)}/block`, { contactId }),

      // Privacy / presence / number-check / calls.
      privacy: (id: string) => get<{ data?: Record<string, unknown> }>(`/instances/${enc(id)}/privacy`),
      setPresence: (id: string, body: { status: string; activityText?: string; activityType?: string }) =>
        put<{ data?: unknown }>(`/instances/${enc(id)}/presence`, body),
      checkNumber: (id: string, phones: string[]) =>
        post<{ data?: unknown; results?: unknown }>(`/instances/${enc(id)}/check-number`, { phones }),
      rejectCall: (id: string, callId: string, callFrom: string) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/calls/reject`, { callId, callFrom }),

      // Recovery.
      resync: (id: string, body: { since?: string; until?: string; chatJids?: string[] }) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/resync`, body),
      replay: (id: string, body: { since?: string }) => post<{ data?: unknown }>(`/instances/${enc(id)}/replay`, body),

      // Group management.
      createGroup: (id: string, subject: string, participants: string[]) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/groups`, { subject, participants }),
      groupInvite: (id: string, groupJid: string) =>
        get<{ data?: { inviteCode?: string; inviteLink?: string } }>(
          `/instances/${enc(id)}/groups/${enc(groupJid)}/invite`,
        ),
      revokeGroupInvite: (id: string, groupJid: string) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/groups/${enc(groupJid)}/invite/revoke`),
      joinGroup: (id: string, code: string) => post<{ data?: unknown }>(`/instances/${enc(id)}/groups/join`, { code }),
      setGroupSubject: (id: string, groupJid: string, subject: string) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/groups/${enc(groupJid)}/subject`, { subject }),
      setGroupDescription: (id: string, groupJid: string, description: string) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/groups/${enc(groupJid)}/description`, { description }),
      setGroupSettings: (id: string, groupJid: string, setting: string) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/groups/${enc(groupJid)}/settings`, { setting }),
      groupParticipants: (id: string, groupJid: string, action: string, participants: string[]) =>
        patch<{ data?: unknown }>(`/instances/${enc(id)}/groups/${enc(groupJid)}/participants`, {
          action,
          participants,
        }),
      setGroupPicture: (id: string, groupJid: string, base64: string, mimeType?: string) =>
        put<{ data?: unknown }>(`/instances/${enc(id)}/groups/${enc(groupJid)}/picture`, { base64, mimeType }),
      leaveGroup: (id: string, groupJid: string) =>
        post<{ data?: unknown }>(`/instances/${enc(id)}/groups/${enc(groupJid)}/leave`),
      chatInvite: (id: string, chatId: string) =>
        get<{ data?: { inviteCode?: string; inviteLink?: string } }>(
          `/instances/${enc(id)}/chats/${enc(chatId)}/invite`,
        ),

      // Discord guilds.
      guilds: (id: string) => get<{ items?: GuildSummary[] }>(`/instances/${enc(id)}/guilds`),
      guildConfig: (id: string, guildId: string) =>
        get<{ data?: Record<string, unknown> }>(`/instances/${enc(id)}/guilds/${enc(guildId)}/config`),
      setGuildConfig: (id: string, guildId: string, config: Record<string, unknown>) =>
        put<{ data?: unknown }>(`/instances/${enc(id)}/guilds/${enc(guildId)}/config`, config),
      resetGuildConfig: (id: string, guildId: string) =>
        del<{ data?: unknown }>(`/instances/${enc(id)}/guilds/${enc(guildId)}/config`),
      guildAudit: (id: string, guildId: string) =>
        get<{ items?: unknown[]; data?: unknown }>(`/instances/${enc(id)}/guilds/${enc(guildId)}/audit`),

      // Per-instance agent routes (CRUD only — deeper routing UX is Group E).
      listRoutes: (id: string) => get<{ items?: AgentRouteRow[] }>(`/instances/${enc(id)}/routes`),
      getRoute: (id: string, routeId: string) =>
        get<{ data?: AgentRouteRow }>(`/instances/${enc(id)}/routes/${enc(routeId)}`),
      createRoute: (id: string, body: Record<string, unknown>) =>
        post<{ data?: AgentRouteRow }>(`/instances/${enc(id)}/routes`, body),
      patchRoute: (id: string, routeId: string, body: Record<string, unknown>) =>
        patch<{ data?: AgentRouteRow }>(`/instances/${enc(id)}/routes/${enc(routeId)}`, body),
      deleteRoute: (id: string, routeId: string) =>
        del<{ data?: unknown }>(`/instances/${enc(id)}/routes/${enc(routeId)}`),
    },
    agentState: {
      /** One-shot current state. Returns 404 when no active state exists for the pair. */
      get: (agentId: string, chatId: string) =>
        get<{ data?: AgentStateSnapshot }>(`/agent-state/${enc(agentId)}/${enc(chatId)}`),
      /**
       * Update state. The state machine (`idle` → `thinking` → `typing` →
       * `sending` → `idle`, with `running_task`/`waiting`/`error` branches) is
       * KV-backed; a valid status is one of {@link AGENT_STATUSES}.
       */
      put: (
        agentId: string,
        chatId: string,
        body: { status: AgentStatus; statusMeta?: Record<string, unknown>; conversationId?: string | null },
      ) => put<{ data?: AgentStateSnapshot }>(`/agent-state/${enc(agentId)}/${enc(chatId)}`, body),
      /** SSE stream path (relative to `/api/v2`) for {@link useSse}. Filter by chat or agent. */
      streamPath: (filter: { chatId?: string; agentId?: string }) =>
        `/agent-state/stream${buildQuery({ chatId: filter.chatId, agentId: filter.agentId })}`,
    },
    /**
     * Live-chat reads (rich rows) and the off-spec chat mutations the SDK omits
     * (pin/unpin, mute/unmute, disappearing timer, clear-session, reopen-contact,
     * hide/unhide, by-external lookup). Archive/label/read/rename/participants
     * stay on the typed SDK surface; these fill the gaps.
     */
    chats: {
      list: (params?: ListChatsExtParams) => get<PaginatedRows<ChatRow>>(`/chats${buildQuery(params)}`),
      get: (id: string) => get<{ data?: ChatRow }>(`/chats/${enc(id)}`),
      byExternal: (instanceId: string, externalId: string) =>
        get<{ data?: ChatRow }>(`/chats/by-external${buildQuery({ instanceId, externalId })}`),
      messages: (id: string, params?: ListMessagesExtParams) =>
        get<{ items?: MessageRow[] }>(`/chats/${enc(id)}/messages${buildQuery(params)}`),
      pin: (id: string, instanceId: string) => post<{ data?: ChatRow }>(`/chats/${enc(id)}/pin`, { instanceId }),
      unpin: (id: string, instanceId: string) => post<{ data?: ChatRow }>(`/chats/${enc(id)}/unpin`, { instanceId }),
      mute: (id: string, instanceId: string, duration?: number) =>
        post<{ data?: ChatRow }>(`/chats/${enc(id)}/mute`, { instanceId, ...(duration ? { duration } : {}) }),
      unmute: (id: string, instanceId: string) => post<{ data?: ChatRow }>(`/chats/${enc(id)}/unmute`, { instanceId }),
      hide: (id: string) => post<{ data?: ChatRow }>(`/chats/${enc(id)}/hide`),
      unhide: (id: string) => post<{ data?: ChatRow }>(`/chats/${enc(id)}/unhide`),
      disappearing: (id: string, instanceId: string, duration: 'off' | '24h' | '7d' | '90d') =>
        post<{ data?: unknown }>(`/chats/${enc(id)}/disappearing`, { instanceId, duration }),
      clearSession: (instanceId: string, chatId: string) =>
        post<{ data?: unknown }>('/chats/clear-session', { instanceId, chatId }),
      reopenContact: (id: string) => post<{ data?: unknown }>(`/chats/${enc(id)}/reopen-contact`),
      syncNames: (instanceId: string) => post<{ data?: unknown }>('/chats/sync-names', { instanceId }),
      // Full-surface coverage (create/delete/participants/conversation) — the
      // console surfaces a subset, but the typed data layer reaches all of them.
      create: (body: Record<string, unknown>) => post<{ data?: ChatRow }>('/chats', body),
      remove: (id: string) => del<{ data?: unknown }>(`/chats/${enc(id)}`),
      patchParticipant: (id: string, platformUserId: string, body: Record<string, unknown>) =>
        patch<{ data?: unknown }>(`/chats/${enc(id)}/participants/${enc(platformUserId)}`, body),
      forConversation: (conversationId: string) =>
        get<{ items?: ChatRow[] }>(`/conversations/${enc(conversationId)}/chats`),
    },
    /**
     * Message helpers beyond the SDK's send surface: media caching, external
     * lookup, and the full read/annotate/moderate row operations. The console
     * uses the send + media subset; the rest complete the typed data layer.
     */
    messages: {
      list: (params?: { chatId?: string; instanceId?: string; limit?: number; cursor?: string }) =>
        get<PaginatedRows<MessageRow>>(`/messages${buildQuery(params)}`),
      get: (id: string) => get<{ data?: MessageRow }>(`/messages/${enc(id)}`),
      getByExternal: (instanceId: string, externalId: string) =>
        get<{ data?: MessageRow }>(`/messages/by-external${buildQuery({ instanceId, externalId })}`),
      create: (body: Record<string, unknown>) => post<{ data?: MessageRow }>('/messages', body),
      patch: (id: string, body: Record<string, unknown>) => patch<{ data?: MessageRow }>(`/messages/${enc(id)}`, body),
      remove: (id: string) => del<{ data?: unknown }>(`/messages/${enc(id)}`),
      edit: (id: string, body: Record<string, unknown>) =>
        post<{ data?: MessageRow }>(`/messages/${enc(id)}/edit`, body),
      star: (id: string, body?: Record<string, unknown>) => post<{ data?: unknown }>(`/messages/${enc(id)}/star`, body),
      unstar: (id: string, body?: Record<string, unknown>) =>
        del<{ data?: unknown }>(`/messages/${enc(id)}/star`, body),
      addReaction: (id: string, body: Record<string, unknown>) =>
        post<{ data?: unknown }>(`/messages/${enc(id)}/reactions`, body),
      removeReaction: (id: string, body: Record<string, unknown>) =>
        del<{ data?: unknown }>(`/messages/${enc(id)}/reactions`, body),
      markRead: (id: string, body: { instanceId: string }) =>
        post<{ data?: unknown }>(`/messages/${enc(id)}/read`, body),
      batchMarkRead: (body: { instanceId: string; chatId: string; messageIds: string[] }) =>
        post<{ data?: unknown }>('/messages/read', body),
      setDeliveryStatus: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: unknown }>(`/messages/${enc(id)}/delivery-status`, body),
      setTranscription: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: unknown }>(`/messages/${enc(id)}/transcription`, body),
      setImageDescription: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: unknown }>(`/messages/${enc(id)}/image-description`, body),
      setVideoDescription: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: unknown }>(`/messages/${enc(id)}/video-description`, body),
      setDocumentExtraction: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: unknown }>(`/messages/${enc(id)}/document-extraction`, body),
      // Channel-side moderation + alternate persist endpoints.
      deleteOnChannel: (body: Record<string, unknown>) => post<{ data?: unknown }>('/messages/delete-channel', body),
      editOnChannel: (body: Record<string, unknown>) => post<{ data?: unknown }>('/messages/edit-channel', body),
      persistContact: (body: Record<string, unknown>) => post<{ data?: unknown }>('/messages/contact', body),
      persistLocation: (body: Record<string, unknown>) => post<{ data?: unknown }>('/messages/location', body),
      persistSticker: (body: Record<string, unknown>) => post<{ data?: unknown }>('/messages/sticker', body),
      persistReaction: (body: Record<string, unknown>) => post<{ data?: unknown }>('/messages/reaction', body),
      ttsVoices: () => get<{ data?: { voices?: unknown[] } }>('/messages/tts/voices'),
      /** Ensure a message's media is cached locally; returns a BFF-servable URL. */
      mediaDownload: (ref: { messageId: string } | { chatId: string; externalId: string }) =>
        post<{ data?: MediaDownloadResult }>('/messages/media/download', ref),
    },
    /**
     * Event pipeline reads. `/events` ignores a chat filter server-side, so
     * {@link listForChat} over-fetches and narrows client-side on `chatUuid`.
     */
    events: {
      list: (params?: {
        instanceId?: string;
        eventType?: string;
        channel?: string;
        direction?: string;
        personId?: string;
        search?: string;
        since?: string;
        until?: string;
        limit?: number;
        cursor?: string;
      }) => get<PaginatedRows<EventRow>>(`/events${buildQuery(params)}`),
      get: (id: string) => get<{ data?: EventRow }>(`/events/${enc(id)}`),
      analytics: (params?: {
        since?: string;
        until?: string;
        instanceId?: string;
        granularity?: string;
        allTime?: boolean;
      }) => get<EventAnalytics>(`/events/analytics${buildQuery(params)}`),
      bySender: (senderId: string, params?: { instanceId?: string; limit?: number }) =>
        get<{ items?: EventRow[]; meta?: { total?: number; hasMore?: boolean } }>(
          `/events/by-sender/${enc(senderId)}${buildQuery(params)}`,
        ),
      timeline: (personId: string, params?: { channels?: string; since?: string; until?: string; limit?: number }) =>
        get<{ personId?: string; items?: EventRow[]; meta?: { hasMore?: boolean; cursor?: string } }>(
          `/events/timeline/${enc(personId)}${buildQuery(params)}`,
        ),
      /** POST full-text/filter search. */
      search: (body: Record<string, unknown>) =>
        post<{ items?: EventRow[]; meta?: { hasMore?: boolean; cursor?: string }; summary?: string }>(
          '/events/search',
          body,
        ),
      /** LIVE: publish a synthetic `custom.*` event into the pipeline. */
      trigger: (body: {
        eventType: string;
        payload: Record<string, unknown>;
        correlationId?: string;
        instanceId?: string;
      }) => post<{ eventId?: string; published?: boolean }>('/events/trigger', body),
      payloads: (id: string) => get<{ items?: EventPayloadStageRecord[] }>(`/events/${enc(id)}/payloads`),
      payloadStage: (id: string, stage: string) =>
        get<{ data?: EventPayloadStageRecord }>(`/events/${enc(id)}/payloads/${enc(stage)}`),
      /** DESTRUCTIVE: soft-delete all stored payloads for an event. */
      deletePayloads: (id: string, reason: string) =>
        del<{ deleted?: number }>(`/events/${enc(id)}/payloads`, { reason }),
    },
    eventOps: {
      metrics: () => get<{ data?: EventMetrics }>('/event-ops/metrics'),
      replayList: () => get<{ items?: ReplaySession[] }>('/event-ops/replay'),
      replayGet: (id: string) => get<{ data?: ReplaySession }>(`/event-ops/replay/${enc(id)}`),
      /** LIVE: start a replay session (accepts dryRun in the body). */
      replayCreate: (body: Record<string, unknown>) => post<{ data?: ReplaySession }>('/event-ops/replay', body),
      /** LIVE: cancel a running replay session. */
      replayDelete: (id: string) => del<{ success?: boolean }>(`/event-ops/replay/${enc(id)}`),
      /** LIVE: run scheduled maintenance (auto-retry + cleanup). */
      scheduled: () =>
        post<{ data?: { autoRetry?: Record<string, number>; payloadCleanup?: number; deadLetterCleanup?: number } }>(
          '/event-ops/scheduled',
        ),
    },
    deadLetters: {
      list: (params?: {
        status?: string;
        eventType?: string;
        since?: string;
        until?: string;
        limit?: number;
        cursor?: string;
      }) =>
        get<{ items?: DeadLetterRow[]; meta?: { hasMore?: boolean; cursor?: string } }>(
          `/dead-letters${buildQuery(params)}`,
        ),
      get: (id: string) => get<{ data?: DeadLetterRow }>(`/dead-letters/${enc(id)}`),
      stats: () => get<{ data?: DeadLetterStats }>('/dead-letters/stats'),
      /** LIVE: re-enqueue a failed event. */
      retry: (id: string) =>
        post<{ success?: boolean; deadLetterId?: string; error?: string }>(`/dead-letters/${enc(id)}/retry`),
      /** LIVE: mark resolved with an operator note. */
      resolve: (id: string, note: string) =>
        post<{ data?: DeadLetterRow }>(`/dead-letters/${enc(id)}/resolve`, { note }),
      /** DESTRUCTIVE: abandon (give up on) a failed event. */
      abandon: (id: string) => post<{ data?: DeadLetterRow }>(`/dead-letters/${enc(id)}/abandon`),
    },
    logs: {
      recent: (params?: { modules?: string; level?: string; limit?: number }) =>
        get<{ items?: LogEntry[]; meta?: { total?: number; bufferSize?: number; limit?: number } }>(
          `/logs/recent${buildQuery(params)}`,
        ),
      /** SSE stream path (relative to `/api/v2`) for {@link useSse}. */
      streamPath: (params?: { modules?: string; level?: string }) => `/logs/stream${buildQuery(params)}`,
    },
    metrics: {
      /** Prometheus exposition text (through the BFF). */
      text: async () => {
        const res = await fetch(`${base}/api/v2/metrics`, { headers: { accept: 'text/plain' } });
        return res.text();
      },
    },
    conversations: {
      list: (params?: { limit?: number }) => get<{ items?: ConversationRow[] }>(`/conversations${buildQuery(params)}`),
      get: (id: string) => get<{ data?: ConversationRow }>(`/conversations/${enc(id)}`),
      chats: (id: string) => get<{ items?: ChatRow[] }>(`/conversations/${enc(id)}/chats`),
      create: (body: Record<string, unknown>) => post<{ data?: ConversationRow }>('/conversations', body),
      patch: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: ConversationRow }>(`/conversations/${enc(id)}`, body),
      remove: (id: string) => del<{ success?: boolean }>(`/conversations/${enc(id)}`),
    },
    persons: {
      list: (params?: { search?: string; limit?: number; cursor?: string }) =>
        get<{ items?: PersonRow[]; meta?: { hasMore?: boolean; cursor?: string } }>(`/persons${buildQuery(params)}`),
      get: (id: string) => get<{ data?: PersonRow }>(`/persons/${enc(id)}`),
      patch: (id: string, body: Record<string, unknown>) => patch<{ data?: PersonRow }>(`/persons/${enc(id)}`, body),
      presence: (id: string) => get<{ data?: PersonPresence }>(`/persons/${enc(id)}/presence`),
      timeline: (id: string, params?: { channels?: string; since?: string; until?: string; limit?: number }) =>
        get<{ items?: EventRow[]; meta?: { hasMore?: boolean; cursor?: string } }>(
          `/persons/${enc(id)}/timeline${buildQuery(params)}`,
        ),
      /** DESTRUCTIVE identity ops — never run against production persons in validation. */
      link: (identityA: string, identityB: string) =>
        post<{ data?: PersonRow }>('/persons/link', { identityA, identityB }),
      unlink: (identityId: string, reason: string) =>
        post<{ data?: { person?: PersonRow; identity?: unknown } }>('/persons/unlink', { identityId, reason }),
      merge: (sourcePersonId: string, targetPersonId: string, reason?: string) =>
        post<{ data?: { person?: PersonRow; deletedPersonId?: string } }>('/persons/merge', {
          sourcePersonId,
          targetPersonId,
          reason,
        }),
    },
    journeys: {
      summary: (params?: { since?: string }) => get<JourneySummary>(`/journeys/summary${buildQuery(params)}`),
      get: (correlationId: string) => get<Journey>(`/journeys/${enc(correlationId)}`),
    },
    voice: {
      sessions: () => get<{ items?: VoiceSession[] }>('/voice/sessions'),
      session: (id: string) => get<{ data?: VoiceSession }>(`/voice/sessions/${enc(id)}`),
      /** LIVE: join a voice channel (could disturb a live instance). */
      join: (body: { instanceId: string; channelId: string; guildId?: string }) =>
        post<{ data?: VoiceSession }>('/voice/join', body),
      /** LIVE: leave a voice session. */
      leave: (sessionId: string) => post<{ success?: boolean }>('/voice/leave', { sessionId }),
    },
    settings: {
      list: (params?: { category?: string }) => get<{ items?: SettingRow[] }>(`/settings${buildQuery(params)}`),
      get: (key: string) => get<{ data?: SettingRow }>(`/settings/${enc(key)}`),
      history: (key: string, params?: { limit?: number; since?: string }) =>
        get<{ items?: SettingHistoryRow[] }>(`/settings/${enc(key)}/history${buildQuery(params)}`),
      /** LIVE: set a single setting (type auto-detected). */
      put: (key: string, value: unknown, reason?: string) =>
        put<{ data?: SettingRow }>(`/settings/${enc(key)}`, { value, reason }),
      /** LIVE: bulk update. */
      patch: (settings: Record<string, unknown>, reason?: string) =>
        patch<{ items?: SettingRow[] }>('/settings', { settings, reason }),
      /** DESTRUCTIVE: delete a setting key. */
      remove: (key: string) => del<{ success?: boolean }>(`/settings/${enc(key)}`),
    },
    payloadConfig: {
      list: () => get<{ items?: PayloadConfigRow[] }>('/payload-config'),
      stats: () => get<{ data?: PayloadStats }>('/payload-stats'),
      /** LIVE: upsert per-event-type payload storage config. */
      put: (eventType: string, body: Record<string, unknown>) =>
        put<{ data?: PayloadConfigRow }>(`/payload-config/${enc(eventType)}`, body),
    },
    keys: {
      list: (params?: { status?: string; limit?: number }) =>
        get<{ items?: ApiKeyRow[]; meta?: { total?: number } }>(`/keys${buildQuery(params)}`),
      get: (id: string) => get<{ data?: ApiKeyRow }>(`/keys/${enc(id)}`),
      audit: (id: string, params?: { limit?: number; cursor?: string }) =>
        get<{ items?: ApiKeyAuditRow[]; meta?: { total?: number; hasMore?: boolean; cursor?: string } }>(
          `/keys/${enc(id)}/audit${buildQuery(params)}`,
        ),
      /** LIVE: create a key. Response carries `plainTextKey` ONCE. `admin` profile is refused server-side. */
      create: (body: Record<string, unknown>) => post<{ data?: ApiKeyRow }>('/keys', body),
      patch: (id: string, body: Record<string, unknown>) => patch<{ data?: ApiKeyRow }>(`/keys/${enc(id)}`, body),
      /** DESTRUCTIVE: revoke a key. */
      revoke: (id: string, reason?: string) => post<{ data?: ApiKeyRow }>(`/keys/${enc(id)}/revoke`, { reason }),
      /** DESTRUCTIVE: hard-delete a key. */
      remove: (id: string) => del<{ data?: { deleted?: boolean } }>(`/keys/${enc(id)}`),
    },
    webhookSources: {
      list: (params?: { enabled?: boolean }) =>
        get<{ items?: WebhookSourceRow[] }>(`/webhook-sources${buildQuery(params)}`),
      get: (id: string) => get<{ data?: WebhookSourceRow }>(`/webhook-sources/${enc(id)}`),
      create: (body: Record<string, unknown>) => post<{ data?: WebhookSourceRow }>('/webhook-sources', body),
      patch: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: WebhookSourceRow }>(`/webhook-sources/${enc(id)}`, body),
      /** DESTRUCTIVE: delete a webhook source. */
      remove: (id: string) => del<{ success?: boolean }>(`/webhook-sources/${enc(id)}`),
    },
    media: {
      tts: (body: Record<string, unknown>) => post<{ data?: MediaResult }>('/media/tts', body),
      stt: (body: Record<string, unknown>) => post<{ data?: MediaResult }>('/media/stt', body),
      imagine: (body: Record<string, unknown>) => post<{ data?: MediaResult }>('/media/imagine', body),
      vision: (body: Record<string, unknown>) => post<{ data?: MediaResult }>('/media/vision', body),
      film: (body: Record<string, unknown>) => post<{ data?: MediaResult }>('/media/film', body),
      music: (body: Record<string, unknown>) => post<{ data?: MediaResult }>('/media/music', body),
    },
    apiInfo: {
      info: () => get<Record<string, unknown>>('/info'),
      health: () => get<Record<string, unknown>>('/health'),
      openApiUrl: () => `${base}/api/v2/openapi.json`,
      docsUrl: () => `${base}/api/v2/docs`,
    },
    access: {
      check: (body: { instanceId: string; platformUserId: string; channel: string }) =>
        post<{ data?: AccessDecision }>('/access/check', body),
      rules: (params?: { instanceId?: string; type?: string }) =>
        get<{ items?: AccessRuleRow[] }>(`/access/rules${buildQuery(params)}`),
      rule: (id: string) => get<{ data?: AccessRuleRow }>(`/access/rules/${enc(id)}`),
      createRule: (body: Record<string, unknown>) => post<{ data?: AccessRuleRow }>('/access/rules', body),
      patchRule: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: AccessRuleRow }>(`/access/rules/${enc(id)}`, body),
      /** DESTRUCTIVE: delete an access rule. */
      removeRule: (id: string) => del<{ success?: boolean }>(`/access/rules/${enc(id)}`),
    },
    /** Read-only id → name resolvers for the Agent Lens (agents/providers). */
    resolve: {
      agents: (params?: { limit?: number }) => get<{ items?: AgentSummary[] }>(`/agents${buildQuery(params)}`),
      agent: (id: string) => get<{ data?: AgentSummary }>(`/agents/${enc(id)}`),
      providers: (params?: { limit?: number }) => get<{ items?: ProviderSummary[] }>(`/providers${buildQuery(params)}`),
      routes: (instanceId: string) => get<{ items?: AgentRouteRow[] }>(`/instances/${enc(instanceId)}/routes`),
    },
    /**
     * First-class agent registry (Group E). CRUD plus the sub-resources the SDK
     * keeps off its typed surface: identities and per-agent tasks.
     */
    agents: {
      list: (params?: ListAgentsParams) => get<{ items?: AgentRow[] }>(`/agents${buildQuery(params)}`),
      get: (id: string) => get<{ data?: AgentRow }>(`/agents/${enc(id)}`),
      create: (body: Record<string, unknown>) => post<{ data?: AgentRow }>('/agents', body),
      patch: (id: string, body: Record<string, unknown>) => patch<{ data?: AgentRow }>(`/agents/${enc(id)}`, body),
      remove: (id: string) => del<{ success?: boolean }>(`/agents/${enc(id)}`),
      identities: (id: string) => get<{ items?: AgentIdentityRow[] }>(`/agents/${enc(id)}/identities`),
      linkIdentity: (id: string, body: Record<string, unknown>) =>
        post<{ data?: AgentIdentityRow }>(`/agents/${enc(id)}/identities/link`, body),
      tasks: (id: string) => get<{ items?: AgentTaskRow[]; hasMore?: boolean }>(`/agents/${enc(id)}/tasks`),
    },
    /** Persistent agent task history (top-level surface). */
    agentTasks: {
      list: (params?: ListAgentTasksParams) =>
        get<{ items?: AgentTaskRow[]; hasMore?: boolean; cursor?: string }>(`/agent-tasks${buildQuery(params)}`),
      get: (id: string) => get<{ data?: AgentTaskRow }>(`/agent-tasks/${enc(id)}`),
      create: (body: Record<string, unknown>) => post<{ data?: AgentTaskRow }>('/agent-tasks', body),
      patch: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: AgentTaskRow }>(`/agent-tasks/${enc(id)}`, body),
      remove: (id: string) => del<{ success?: boolean }>(`/agent-tasks/${enc(id)}`),
    },
    /** Agent provider config + health + (Agno-only) discovery of agents/teams/workflows. */
    providers: {
      list: (params?: { active?: boolean }) => get<{ items?: ProviderRow[] }>(`/providers${buildQuery(params)}`),
      get: (id: string) => get<{ data?: ProviderRow }>(`/providers/${enc(id)}`),
      create: (body: Record<string, unknown>) => post<{ data?: ProviderRow }>('/providers', body),
      patch: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: ProviderRow }>(`/providers/${enc(id)}`, body),
      remove: (id: string) => del<{ success?: boolean }>(`/providers/${enc(id)}`),
      /** Read-only probe — reports latency + status, never mutates provider state. */
      health: (id: string) => post<ProviderHealth>(`/providers/${enc(id)}/health`),
      agents: (id: string) => get<ProviderEntriesResult>(`/providers/${enc(id)}/agents`),
      teams: (id: string) => get<ProviderEntriesResult>(`/providers/${enc(id)}/teams`),
      workflows: (id: string) => get<ProviderEntriesResult>(`/providers/${enc(id)}/workflows`),
    },
    /**
     * Event-driven automations: CRUD, enable/disable, dry-run test (no side
     * effects) vs live execute (runs actions), per-automation + global logs, and
     * engine metrics.
     */
    automations: {
      list: (params?: { enabled?: boolean }) => get<{ items?: AutomationRow[] }>(`/automations${buildQuery(params)}`),
      get: (id: string) => get<{ data?: AutomationRow }>(`/automations/${enc(id)}`),
      create: (body: Record<string, unknown>) => post<{ data?: AutomationRow }>('/automations', body),
      patch: (id: string, body: Record<string, unknown>) =>
        patch<{ data?: AutomationRow }>(`/automations/${enc(id)}`, body),
      remove: (id: string) => del<{ success?: boolean }>(`/automations/${enc(id)}`),
      enable: (id: string) => post<{ data?: AutomationRow }>(`/automations/${enc(id)}/enable`),
      disable: (id: string) => post<{ data?: AutomationRow }>(`/automations/${enc(id)}/disable`),
      /** Dry-run: evaluates conditions against a sample event; does NOT run actions. */
      test: (id: string, event: { type: string; payload: Record<string, unknown> }) =>
        post<AutomationTestResult>(`/automations/${enc(id)}/test`, { event }),
      /** LIVE: actually runs the automation's actions with the provided event. */
      execute: (id: string, event: { type: string; payload: Record<string, unknown> }) =>
        post<AutomationExecuteResult>(`/automations/${enc(id)}/execute`, { event }),
      logs: (id: string, params?: { limit?: number; cursor?: string }) =>
        get<PaginatedRows<AutomationLogRow>>(`/automations/${enc(id)}/logs${buildQuery(params)}`),
      globalLogs: (params?: ListAutomationLogsParams) =>
        get<PaginatedRows<AutomationLogRow>>(`/automation-logs${buildQuery(params)}`),
      metrics: () => get<AutomationMetrics>('/automation-metrics'),
    },
    /** Batch media-processing jobs: estimate → create → poll status → cancel. */
    batchJobs: {
      list: (params?: ListBatchJobsParams) => get<PaginatedRows<BatchJobRow>>(`/batch-jobs${buildQuery(params)}`),
      get: (id: string) => get<{ data?: BatchJobRow }>(`/batch-jobs/${enc(id)}`),
      status: (id: string) => get<{ data?: BatchJobStatusRow }>(`/batch-jobs/${enc(id)}/status`),
      /** Read-only cost/count preview — no job is created. */
      estimate: (body: Record<string, unknown>) => post<{ data?: BatchJobEstimate }>('/batch-jobs/estimate', body),
      create: (body: Record<string, unknown>) => post<{ data?: BatchJobRow }>('/batch-jobs', body),
      cancel: (id: string) => post<{ data?: BatchJobRow }>(`/batch-jobs/${enc(id)}/cancel`),
    },
    /** A2A agent discovery (read-only): the discoverable-agent list and per-agent card. */
    a2a: {
      agents: () => get<{ items?: Record<string, unknown>[] }>('/a2a/agents'),
      card: (agentId: string) => get<{ data?: Record<string, unknown> }>(`/a2a/agents/${enc(agentId)}/card`),
    },
    /** Cross-instance route resolver metrics (global cache stats). */
    routes: {
      metrics: () => get<{ data?: RouteCacheMetrics }>('/routes/metrics'),
    },
    turns: {
      list: (params?: ListTurnsParams) => get<{ data?: TurnListResponse }>(`/turns${buildQuery(params)}`),
      get: (id: string) => get<{ data?: TurnItem }>(`/turns/${encodeURIComponent(id)}`),
      stats: () => get<{ data?: TurnStats }>('/turns/stats'),
      /** LIVE: admin force-close a single turn. */
      forceClose: (id: string, reason?: string) =>
        post<{ data?: { turnId?: string; status?: string; closedAt?: string } }>(`/turns/${enc(id)}/close`, { reason }),
      /** LIVE (admin): close ALL open turns — requires confirm. */
      closeAll: (reason?: string) =>
        post<{ data?: { closedCount?: number; message?: string } }>('/turns/close-all', { confirm: true, reason }),
    },
    context: {
      get: () => get<{ data?: ContextResult }>('/context'),
      /** LIVE: set the API key's context pointer (use a synthetic chatId only in validation). */
      set: (body: { instanceId?: string; chatId?: string; messageId?: string }) =>
        post<{ data?: Record<string, unknown> }>('/context', body),
      /** LIVE: switch the active instance. */
      use: (instanceId: string) => post<{ data?: { activeInstanceId?: string } }>('/context/use', { instanceId }),
      /** DESTRUCTIVE: clear the context pointer. */
      clear: () => del<{ data?: { cleared?: boolean } }>('/context'),
    },
  };
}

export type OmniExt = ReturnType<typeof omniExt>;
