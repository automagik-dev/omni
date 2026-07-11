'use client';

/**
 * Left pane: the chat list. Instance selector (seeded from the global scope),
 * a search filter, and rows showing avatar, name, last-message preview + time,
 * unread badge, and pinned / muted / archived indicators. Polled incrementally
 * so unread counts and ordering stay live.
 */
import { Avatar, Input, Spinner } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { useScope } from '../../app/providers/ScopeProvider';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { T } from '../../components/tokens';
import { channelLabel } from '../instances/instance-helpers';
import { chatDisplayName, formatClock, isCanaryChat, isProductionChat } from './chat-helpers';
import { useChatList } from './useChatData';

function chatFlags(chat: ChatRow): { archived: boolean; pinned: boolean; muted: boolean } {
  const settings = (chat.settings ?? {}) as Record<string, unknown>;
  const archived = chat.isArchived === true || chat.visibility === 'archived' || Boolean(chat.archivedAt);
  const pinned = chat.isPinned === true || Boolean(chat.pinnedAt) || settings.pinned === true;
  const muted = chat.isMuted === true || Boolean(chat.mutedUntil) || settings.muted === true;
  return { archived, pinned, muted };
}

function lastActivityLabel(chat: ChatRow): string {
  const raw = chat.lastMessageAt ?? chat.updatedAt ?? null;
  if (!raw) return '';
  return formatClock(new Date(raw).getTime());
}

export function ChatList({
  selectedChatId,
  onSelectChat,
}: {
  selectedChatId: string | null;
  onSelectChat: (chat: ChatRow) => void;
}) {
  const scope = useScope();
  const [localInstanceId, setLocalInstanceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  // The list scope follows the global scope unless the user overrides it here.
  const instanceId = localInstanceId ?? scope.selectedInstanceId ?? undefined;

  const list = useChatList({ instanceId, search, includeArchived });

  const chats = useMemo(() => {
    const activityMs = (c: ChatRow) => {
      const raw = c.lastMessageAt ?? c.updatedAt ?? null;
      const t = raw ? new Date(raw).getTime() : 0;
      return Number.isNaN(t) ? 0 : t;
    };
    // Pinned first, then by last activity (the server already activity-sorts).
    return [...list.chats].sort((a, b) => {
      const pinDelta = (chatFlags(b).pinned ? 1 : 0) - (chatFlags(a).pinned ? 1 : 0);
      return pinDelta !== 0 ? pinDelta : activityMs(b) - activityMs(a);
    });
  }, [list.chats]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: T.surface }}>
      <div
        style={{ padding: 10, borderBottom: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <select
          value={instanceId ?? ''}
          onChange={(e) => setLocalInstanceId(e.target.value || null)}
          style={selectStyle}
        >
          <option value="">All instances</option>
          {scope.instances.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} · {channelLabel(inst.channel)}
            </option>
          ))}
        </select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats…" size="small" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived
        </label>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {list.isLoading && chats.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
            <Spinner />
          </div>
        ) : chats.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: T.muted, textAlign: 'center' }}>
            {list.error ? `Failed to load: ${list.error.message}` : 'No chats found.'}
          </div>
        ) : (
          chats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              selected={chat.id === selectedChatId}
              onSelect={() => onSelectChat(chat)}
            />
          ))
        )}
      </div>

      <div style={{ padding: '6px 10px', borderTop: `1px solid ${T.border}` }}>
        <FreshnessBadge observedAt={list.lastPolledAt} source="chats 6s" degraded={Boolean(list.error)} />
      </div>
    </div>
  );
}

function ChatListItem({ chat, selected, onSelect }: { chat: ChatRow; selected: boolean; onSelect: () => void }) {
  const flags = chatFlags(chat);
  const unread = chat.unreadCount ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '9px 12px',
        border: 'none',
        borderBottom: `1px solid ${T.borderSubtle}`,
        background: selected ? 'color-mix(in srgb, var(--khal-accent, #3b82f6) 16%, transparent)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <Avatar name={chatDisplayName(chat)} src={chat.avatarUrl ?? undefined} size="sm" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {flags.pinned && (
            <span title="Pinned" style={{ fontSize: 11 }}>
              📌
            </span>
          )}
          <span
            style={{
              fontWeight: unread > 0 ? 700 : 550,
              fontSize: 13,
              color: T.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {chatDisplayName(chat)}
          </span>
          {isProductionChat(chat) && isCanaryChat(chat) && (
            <span style={{ fontSize: 9, color: T.ok, fontWeight: 700 }}>CANARY</span>
          )}
          <span style={{ fontSize: 10.5, color: T.muted, flexShrink: 0 }}>{lastActivityLabel(chat)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              color: T.muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {chat.lastMessageFromMe ? 'You: ' : ''}
            {chat.lastMessagePreview ?? '—'}
          </span>
          {flags.muted && (
            <span title="Muted" style={{ fontSize: 10 }}>
              🔕
            </span>
          )}
          {flags.archived && <span style={{ fontSize: 9, color: T.muted }}>archived</span>}
          {unread > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#fff',
                background: T.accent,
                borderRadius: 999,
                padding: '0 6px',
                minWidth: 16,
                textAlign: 'center',
              }}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

const selectStyle = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.bg,
  color: T.fg,
  fontSize: 12.5,
  width: '100%',
} as const;
