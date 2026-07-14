'use client';

/**
 * Data hooks for the live-chat console. Each mirrors the exact path the
 * validation script exercises, so what the operator sees is what the script
 * proves:
 *   - {@link useChatList}    — chat list, incremental poll (dedupe by id).
 *   - {@link useChatThread}  — active-chat messages, fast poll + load-older windowing.
 *   - {@link useChatEvents}  — instance events, client-filtered to the chat (the
 *                              `/events` chatId query is ignored server-side).
 *   - {@link useAgentState}  — agent-state SSE (primary) + one-shot GET (fallback).
 *   - {@link useResolvers}   — agent/provider/route maps for the Agent Lens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRouteRow, AgentStateSnapshot, ChatRow, EventRow, MessageRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { mergeById } from '../../hooks/merge-by-id';
import { useSse } from '../../hooks/useSse';
import { mergeMessagesById, messageTime } from './chat-helpers';

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

// ── Chat list ─────────────────────────────────────────────────────────────────

export interface UseChatListParams {
  instanceId?: string;
  search?: string;
  includeArchived?: boolean;
  intervalMs?: number;
}

export interface UseChatListResult {
  chats: ChatRow[];
  isLoading: boolean;
  error: Error | null;
  lastPolledAt: number | undefined;
  refresh: () => void;
}

/** Incremental chat-list poll. Backs off while the tab is hidden. */
export function useChatList(params: UseChatListParams): UseChatListResult {
  const { ext } = useOmniClient();
  const { instanceId, search, includeArchived, intervalMs = 6000 } = params;
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | undefined>(undefined);
  const inFlight = useRef(false);

  // A fresh query shape starts a fresh list (no cross-instance/search bleed).
  // Reset during render on change (React's "previous-render state" pattern)
  // rather than in an effect, so there's no stale flash and no effect churn.
  const queryKey = `${instanceId ?? ''}|${search ?? ''}|${includeArchived ? 1 : 0}`;
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (queryKey !== prevQueryKey) {
    setPrevQueryKey(queryKey);
    setChats([]);
    setLastPolledAt(undefined);
  }

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    try {
      const res = await ext.chats.list({
        instanceId,
        search: search || undefined,
        includeArchived,
        sort: 'activity',
        limit: 100,
      });
      // The endpoint returns the full activity-sorted window, so it is the
      // source of truth each poll — re-ordering, unread changes, and dropped
      // chats are all reflected without stale rows lingering.
      setChats(res.items ?? []);
      setError(null);
      setLastPolledAt(Date.now());
    } catch (e) {
      setError(toError(e));
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [ext, instanceId, search, includeArchived]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (stopped) return;
      await poll();
      if (stopped) return;
      timer = setTimeout(loop, isHidden() ? intervalMs * 4 : intervalMs);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll, intervalMs]);

  return { chats, isLoading, error, lastPolledAt, refresh: () => void poll() };
}

// ── Active chat thread ─────────────────────────────────────────────────────────

export interface UseChatThreadResult {
  messages: MessageRow[];
  initialLoading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  error: Error | null;
  lastPolledAt: number | undefined;
  loadOlder: () => void;
  refresh: () => void;
}

/**
 * Active-chat messages: a fast poll for the newest page (dedup by id, ascending)
 * plus `loadOlder` windowing that pages backwards on the `before` date cursor.
 */
export function useChatThread(chatId: string | null, pageSize = 30, activeIntervalMs = 2500): UseChatThreadResult {
  const { ext } = useOmniClient();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | undefined>(undefined);
  const messagesRef = useRef<MessageRow[]>([]);
  messagesRef.current = messages;
  const inFlight = useRef(false);

  // Reset the window when the chat changes (previous-render state pattern).
  const [prevChatId, setPrevChatId] = useState(chatId);
  if (chatId !== prevChatId) {
    setPrevChatId(chatId);
    setMessages([]);
    setHasMore(true);
    setError(null);
  }

  const poll = useCallback(async () => {
    if (!chatId || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await ext.chats.messages(chatId, { limit: pageSize });
      setMessages((prev) => mergeMessagesById(prev, res.items ?? []));
      setError(null);
      setLastPolledAt(Date.now());
    } catch (e) {
      setError(toError(e));
    } finally {
      inFlight.current = false;
    }
  }, [ext, chatId, pageSize]);

  useEffect(() => {
    if (!chatId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setInitialLoading(true);
    const loop = async () => {
      if (stopped) return;
      await poll();
      if (stopped) return;
      timer = setTimeout(loop, isHidden() ? activeIntervalMs * 6 : activeIntervalMs);
    };
    void loop().finally(() => {
      if (!stopped) setInitialLoading(false);
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [chatId, poll, activeIntervalMs]);

  const loadOlder = useCallback(async () => {
    if (!chatId || loadingOlder) return;
    const current = messagesRef.current;
    const oldest = current[0];
    if (!oldest) return;
    const before = oldest.platformTimestamp ?? oldest.receivedAt ?? oldest.createdAt ?? undefined;
    if (!before) return;
    setLoadingOlder(true);
    try {
      const res = await ext.chats.messages(chatId, { limit: pageSize, before });
      const older = (res.items ?? []).filter((m) => messageTime(m) < messageTime(oldest));
      if (older.length === 0) setHasMore(false);
      setMessages((prev) => mergeMessagesById(prev, res.items ?? []));
    } catch (e) {
      setError(toError(e));
    } finally {
      setLoadingOlder(false);
    }
  }, [ext, chatId, pageSize, loadingOlder]);

  return {
    messages,
    initialLoading,
    loadingOlder,
    hasMore,
    error,
    lastPolledAt,
    loadOlder: () => void loadOlder(),
    refresh: () => void poll(),
  };
}

// ── Chat events (Agent Lens Trace) ─────────────────────────────────────────────

export interface UseChatEventsResult {
  events: EventRow[];
  isLoading: boolean;
  error: Error | null;
  lastPolledAt: number | undefined;
  refresh: () => void;
}

/**
 * Instance events, polled and accumulated. The caller narrows to the chat with
 * `eventsForChat(events, chat.id)` since `/events` ignores a chat filter.
 */
export function useChatEvents(instanceId: string | null, intervalMs = 5000): UseChatEventsResult {
  const { ext } = useOmniClient();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | undefined>(undefined);
  const inFlight = useRef(false);

  const [prevInstanceId, setPrevInstanceId] = useState(instanceId);
  if (instanceId !== prevInstanceId) {
    setPrevInstanceId(instanceId);
    setEvents([]);
  }

  const poll = useCallback(async () => {
    if (!instanceId || inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    try {
      const res = await ext.events.list({ instanceId, limit: 100 });
      setEvents((prev) => mergeById(prev, res.items ?? [], (e) => e.id, { max: 500 }));
      setError(null);
      setLastPolledAt(Date.now());
    } catch (e) {
      setError(toError(e));
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [ext, instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (stopped) return;
      await poll();
      if (stopped) return;
      timer = setTimeout(loop, isHidden() ? intervalMs * 6 : intervalMs);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [instanceId, poll, intervalMs]);

  return { events, isLoading, error, lastPolledAt, refresh: () => void poll() };
}

// ── Agent state (SSE primary + one-shot fallback) ───────────────────────────────

export interface UseAgentStateResult {
  snapshot: AgentStateSnapshot | null;
  /** Source of the current snapshot. */
  source: 'stream' | 'one-shot' | null;
  connected: boolean;
  degraded: boolean;
  /** Epoch ms of the last state change observed (from either source). */
  lastChangeAt: number | undefined;
  /** True once the stream has emitted its `connected` frame. */
  streamReady: boolean;
  error: Error | null;
}

/**
 * Subscribes to the agent-state SSE stream for a chat and seeds an initial
 * snapshot with a one-shot GET (needs a candidate agentId). The stream is
 * change-only and kept alive by an SSE comment EventSource never surfaces, so
 * the watchdog is disabled (`heartbeatMs: 0`) and `degraded` is driven by
 * transport errors only.
 */
export function useAgentState(chatId: string | null, candidateAgentId: string | null): UseAgentStateResult {
  const { ext } = useOmniClient();
  const [snapshot, setSnapshot] = useState<AgentStateSnapshot | null>(null);
  const [source, setSource] = useState<'stream' | 'one-shot' | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [lastChangeAt, setLastChangeAt] = useState<number | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  const [prevChatId, setPrevChatId] = useState(chatId);
  if (chatId !== prevChatId) {
    setPrevChatId(chatId);
    setSnapshot(null);
    setSource(null);
    setStreamReady(false);
    setLastChangeAt(undefined);
  }

  const streamPath = chatId ? ext.agentState.streamPath({ chatId }) : '';
  // Identity on SSE: `EventSource` cannot set an `Authorization` header, so this
  // stream is authenticated by the browser-attached same-origin `khal-session`
  // cookie — the alternative credential the BFF's `validateKhalSession` accepts.
  const { degraded, connected } = useSse(streamPath, {
    enabled: Boolean(chatId),
    events: ['connected', 'agent.state.changed'],
    heartbeatMs: 0,
    onMessage: (data, eventType) => {
      if (eventType === 'connected') {
        setStreamReady(true);
        return;
      }
      if (eventType === 'agent.state.changed') {
        try {
          const parsed = JSON.parse(data) as AgentStateSnapshot;
          setSnapshot(parsed);
          setSource('stream');
          setLastChangeAt(Date.now());
        } catch {
          /* ignore malformed frame */
        }
      }
    },
  });

  // One-shot seed: only fills in when the stream hasn't already delivered state.
  useEffect(() => {
    if (!chatId || !candidateAgentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await ext.agentState.get(candidateAgentId, chatId);
        if (cancelled || !res?.data) return;
        setSnapshot((prev) => prev ?? res.data ?? null);
        setSource((prev) => prev ?? 'one-shot');
        setLastChangeAt((prev) => prev ?? res.data?.updatedAt);
      } catch (e) {
        // 404 = no active state (agent idle); not an error worth surfacing.
        const msg = e instanceof Error ? e.message : String(e);
        if (!/not found|no active state/i.test(msg)) setError(toError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ext, chatId, candidateAgentId]);

  return { snapshot, source, connected, degraded, lastChangeAt, streamReady, error };
}

// ── Resolvers (agents / providers / routes) ─────────────────────────────────────

export interface Resolvers {
  agentName: (id: string | null | undefined) => string | null;
  agentProviderId: (id: string | null | undefined) => string | null;
  providerName: (id: string | null | undefined) => string | null;
  routesFor: (instanceId: string) => AgentRouteRow[];
  resolveAgentForChat: (instanceId: string, chatId: string) => string | null;
  loaded: boolean;
}

/**
 * Loads the agent/provider catalogs and per-instance routes once, exposing
 * id → name resolvers plus a best-effort "which agent handles this chat".
 */
export function useResolvers(instanceId: string | null): Resolvers {
  const { ext } = useOmniClient();
  const [agents, setAgents] = useState<Map<string, { name: string; providerId: string | null }>>(new Map());
  const [providers, setProviders] = useState<Map<string, string>>(new Map());
  const [routes, setRoutes] = useState<Map<string, AgentRouteRow[]>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ag, pr] = await Promise.all([ext.resolve.agents({ limit: 200 }), ext.resolve.providers({ limit: 200 })]);
        if (cancelled) return;
        setAgents(
          new Map((ag.items ?? []).map((a) => [a.id, { name: a.name ?? a.id, providerId: a.agentProviderId ?? null }])),
        );
        setProviders(new Map((pr.items ?? []).map((p) => [p.id, p.name ?? p.schema ?? p.id])));
      } catch {
        /* resolvers are best-effort; ids render raw when unavailable */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ext]);

  useEffect(() => {
    if (!instanceId || routes.has(instanceId)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await ext.resolve.routes(instanceId);
        if (!cancelled) setRoutes((prev) => new Map(prev).set(instanceId, res.items ?? []));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ext, instanceId, routes]);

  return useMemo<Resolvers>(
    () => ({
      loaded,
      agentName: (id) => (id ? (agents.get(id)?.name ?? null) : null),
      agentProviderId: (id) => (id ? (agents.get(id)?.providerId ?? null) : null),
      providerName: (id) => (id ? (providers.get(id) ?? null) : null),
      routesFor: (iid) => routes.get(iid) ?? [],
      resolveAgentForChat: (iid, cid) => {
        const list = routes.get(iid) ?? [];
        const active = list.filter((r) => r.isActive !== false);
        const byChat = active.find((r) => r.chatId === cid);
        if (byChat?.agentId) return byChat.agentId;
        // Fall back to the highest-priority instance-wide route.
        const wide = [...active].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
        return wide?.agentId ?? null;
      },
    }),
    [loaded, agents, providers, routes],
  );
}
