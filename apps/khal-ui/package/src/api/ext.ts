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

export interface AgentStateSnapshot {
  agentId: string;
  chatId: string;
  state?: Record<string, unknown> | null;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ContextResult {
  chatId?: string;
  messages?: Array<Record<string, unknown>>;
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
      get: (agentId: string, chatId: string) =>
        get<{ data?: AgentStateSnapshot }>(`/agent-state/${encodeURIComponent(agentId)}/${encodeURIComponent(chatId)}`),
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
