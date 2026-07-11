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
    },
    handoffs: {
      list: (params?: { chatId?: string; instanceId?: string; limit?: number; cursor?: string }) =>
        get<{ items?: HandoffRecord[] }>(`/handoffs${buildQuery(params)}`),
      get: (id: string) => get<{ data?: HandoffRecord }>(`/handoffs/${encodeURIComponent(id)}`),
    },
    followUp: {
      getForChat: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/chats/${enc(id)}`),
      setForChat: (id: string, body: FollowUpConfig) =>
        put<{ data?: FollowUpConfig }>(`/follow-up/chats/${enc(id)}`, body),
      clearForChat: (id: string) => del<{ data?: unknown }>(`/follow-up/chats/${enc(id)}`),
      getForAgent: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/agents/${enc(id)}`),
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
      list: (params?: { instanceId?: string; eventType?: string; limit?: number; cursor?: string }) =>
        get<PaginatedRows<EventRow>>(`/events${buildQuery(params)}`),
      get: (id: string) => get<{ data?: EventRow }>(`/events/${enc(id)}`),
      payloads: (id: string) => get<{ items?: EventPayloadRecord[] }>(`/events/${enc(id)}/payloads`),
    },
    access: {
      check: (body: { instanceId: string; platformUserId: string; channel: string }) =>
        post<{ data?: AccessDecision }>('/access/check', body),
    },
    /** Read-only id → name resolvers for the Agent Lens (agents/providers). */
    resolve: {
      agents: (params?: { limit?: number }) => get<{ items?: AgentSummary[] }>(`/agents${buildQuery(params)}`),
      agent: (id: string) => get<{ data?: AgentSummary }>(`/agents/${enc(id)}`),
      providers: (params?: { limit?: number }) => get<{ items?: ProviderSummary[] }>(`/providers${buildQuery(params)}`),
      routes: (instanceId: string) => get<{ items?: AgentRouteRow[] }>(`/instances/${enc(instanceId)}/routes`),
    },
    turns: {
      list: (params?: ListTurnsParams) => get<TurnListResponse>(`/turns${buildQuery(params)}`),
      get: (id: string) => get<{ data?: TurnItem }>(`/turns/${encodeURIComponent(id)}`),
      stats: () => get<TurnStats>('/turns/stats'),
    },
    context: {
      get: (params?: { chatId?: string; instanceId?: string; limit?: number }) =>
        get<ContextResult>(`/context${buildQuery(params)}`),
    },
  };
}

export type OmniExt = ReturnType<typeof omniExt>;
