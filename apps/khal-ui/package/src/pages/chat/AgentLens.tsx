'use client';

/**
 * Right pane: Agent Lens — "see what the agent is seeing and doing" for the
 * selected chat. Two tabs: Now (live state) and Trace (correlated event
 * pipeline). Owns the agent-state SSE subscription, the instance event poll, and
 * the id→name resolvers, so opening the lens is what starts those streams.
 * Collapsible to hand the width back to the thread.
 */
import { PillBadge } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
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
        className="omni-iconbtn"
        style={{
          height: '100%',
          writingMode: 'vertical-rl',
          padding: '12px 7px',
          border: 'none',
          borderLeft: `1px solid ${T.border}`,
          background: T.surface,
          color: T.secondary,
          cursor: 'pointer',
          fontSize: 10.5,
          fontFamily: T.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
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
          gap: 8,
          padding: '9px 10px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}
      >
        <PillBadge size="sm" variant="muted" dot dotColor={T.accent}>
          Agent Lens
        </PillBadge>
        <div
          style={{
            display: 'flex',
            gap: 2,
            marginLeft: 4,
            padding: 2,
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: T.sunken,
          }}
        >
          {(['now', 'trace'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="omni-seg-btn"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '3px 11px',
                borderRadius: 6,
                border: 'none',
                background: tab === t ? 'color-mix(in oklch, var(--khal-accent) 16%, transparent)' : 'transparent',
                boxShadow:
                  tab === t ? 'inset 0 0 0 1px color-mix(in oklch, var(--khal-accent) 40%, transparent)' : 'none',
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
          className="omni-iconbtn"
          style={{
            marginLeft: 'auto',
            border: 'none',
            borderRadius: 6,
            width: 26,
            height: 26,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: T.muted,
            cursor: 'pointer',
            fontSize: 13,
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
