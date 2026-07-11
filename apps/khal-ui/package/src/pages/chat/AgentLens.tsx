'use client';

/**
 * Right pane: Agent Lens — "see what the agent is seeing and doing" for the
 * selected chat. Two tabs: Now (live state) and Trace (correlated event
 * pipeline). Owns the agent-state SSE subscription, the instance event poll, and
 * the id→name resolvers, so opening the lens is what starts those streams.
 * Collapsible to hand the width back to the thread.
 */
import { useMemo, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { AgentLensNow } from './AgentLensNow';
import { AgentLensTrace } from './AgentLensTrace';
import { useAgentState, useChatEvents, useResolvers } from './useChatData';

type Tab = 'now' | 'trace';

export function AgentLens({
  chat,
  collapsed,
  onToggleCollapsed,
}: {
  chat: ChatRow;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { ext } = useOmniClient();
  const [tab, setTab] = useState<Tab>('now');
  const resolvers = useResolvers(chat.instanceId);
  const eventsFeed = useChatEvents(chat.instanceId);
  const candidateAgentId = resolvers.resolveAgentForChat(chat.instanceId, chat.id);
  const agentState = useAgentState(chat.id, candidateAgentId);

  // The chat's recent message external ids are the reliable join to events —
  // DM events carry chatUuid=null, so `chatUuid` alone misses them.
  const messagesQuery = useOmniQuery(['chat-msg-ext', chat.id], () => ext.chats.messages(chat.id, { limit: 50 }), {
    refetchInterval: 8000,
    staleTime: 4000,
  });
  const messageExternalIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messagesQuery.data?.items ?? []) {
      if (m.externalId) set.add(m.externalId);
    }
    return set;
  }, [messagesQuery.data]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title="Show Agent Lens"
        style={{
          writingMode: 'vertical-rl',
          padding: '12px 6px',
          border: 'none',
          borderLeft: `1px solid ${T.border}`,
          background: T.surface,
          color: T.muted,
          cursor: 'pointer',
          fontSize: 12,
          letterSpacing: '0.05em',
        }}
      >
        ◂ Agent Lens
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        background: T.bg,
        borderLeft: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.fg }}>Agent Lens</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {(['now', 'trace'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 7,
                border: `1px solid ${tab === t ? T.accentBlue : T.border}`,
                background:
                  tab === t ? 'color-mix(in srgb, var(--khal-accent, #3b82f6) 18%, transparent)' : 'transparent',
                color: tab === t ? T.fg : T.muted,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse"
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'transparent',
            color: T.muted,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          ▸
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'now' ? (
          <AgentLensNow
            chat={chat}
            agentState={agentState}
            resolvers={resolvers}
            events={eventsFeed.events}
            messageExternalIds={messageExternalIds}
          />
        ) : (
          <AgentLensTrace
            chat={chat}
            events={eventsFeed.events}
            messageExternalIds={messageExternalIds}
            lastPolledAt={eventsFeed.lastPolledAt}
            degraded={Boolean(eventsFeed.error)}
          />
        )}
      </div>
    </div>
  );
}
