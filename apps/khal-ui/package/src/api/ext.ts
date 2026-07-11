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
      getForChat: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/chats/${encodeURIComponent(id)}`),
      getForAgent: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/agents/${encodeURIComponent(id)}`),
      getForInstance: (id: string) => get<{ data?: FollowUpConfig }>(`/follow-up/instances/${encodeURIComponent(id)}`),
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
