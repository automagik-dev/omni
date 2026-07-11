'use client';

/**
 * The live agent console — a WhatsApp-Web-style three-pane page: chat list,
 * conversation thread, and the Agent Lens. Select a chat on the left, converse
 * in the center, and watch what the agent is seeing and doing on the right.
 *
 * Supports a `?chatId=` (optionally `&instanceId=`) deep link so other pages
 * (e.g. an instance's detail view) can open a specific conversation here.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChatRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { T } from '../../components/tokens';
import { AgentLens } from './AgentLens';
import { ChatActionsMenu } from './ChatActionsMenu';
import { ChatList } from './ChatList';
import { ChatThread } from './ChatThread';

export function ChatPage() {
  const { ext } = useOmniClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<ChatRow | null>(null);
  const [lensCollapsed, setLensCollapsed] = useState(false);

  // Deep link: hydrate the selected chat from `?chatId=` once.
  const deepChatId = searchParams.get('chatId');
  useEffect(() => {
    if (!deepChatId || selected?.id === deepChatId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await ext.chats.get(deepChatId);
        if (!cancelled && res.data) setSelected(res.data);
      } catch {
        /* invalid deep link — leave the list to drive selection */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deepChatId, ext, selected?.id]);

  const selectChat = (chat: ChatRow) => {
    setSelected(chat);
    const next = new URLSearchParams(searchParams);
    next.set('chatId', chat.id);
    next.set('instanceId', chat.instanceId);
    setSearchParams(next, { replace: true });
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, minWidth: 0 }}>
      <div style={{ width: 320, flexShrink: 0, borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
        <ChatList selectedChatId={selected?.id ?? null} onSelectChat={selectChat} />
      </div>

      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {selected ? (
          <ChatThread
            key={selected.id}
            chat={selected}
            actions={<ChatActionsMenu chat={selected} onChanged={() => void 0} />}
          />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 8,
              color: T.muted,
              padding: 24,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: T.fg }}>Select a conversation</div>
            <div style={{ fontSize: 13 }}>Pick a chat on the left to open the live thread and the Agent Lens.</div>
          </div>
        )}
      </div>

      {selected && (
        <div
          style={{
            width: lensCollapsed ? 'auto' : 380,
            flexShrink: 0,
            minHeight: 0,
          }}
        >
          <AgentLens
            key={selected.id}
            chat={selected}
            collapsed={lensCollapsed}
            onToggleCollapsed={() => setLensCollapsed((c) => !c)}
          />
        </div>
      )}
    </div>
  );
}
