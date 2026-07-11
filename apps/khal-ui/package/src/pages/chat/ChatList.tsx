'use client';

/**
 * Left pane: the chat list. A khal-native instance selector (DropdownMenu seeded
 * from the global scope), a search filter, an include-archived toggle, and a
 * keyboard-navigable {@link ListView} of rows showing avatar, name, last-message
 * preview + time, unread badge, and pinned / muted / archived indicators.
 * ↑/↓ move + open, Enter opens; the active row wears a copper inset bar. Polled
 * incrementally so unread counts and ordering stay live.
 */
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  ListView,
  PillBadge,
  Spinner,
  Toggle,
} from '@khal-os/ui';
import { useMemo, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { useScope } from '../../app/providers/ScopeProvider';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
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

  const selectByKey = (key: string | null) => {
    if (!key) return;
    const chat = chats.find((c) => c.id === key);
    if (chat) onSelectChat(chat);
  };

  const currentInstance = instanceId ? scope.instances.find((i) => i.id === instanceId) : undefined;
  const instanceLabel = currentInstance ? currentInstance.name : 'All instances';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: T.surface }}>
      <div
        style={{ padding: 10, borderBottom: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="omni-seg-btn" style={selectorTrigger}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {instanceLabel}
                {currentInstance && (
                  <span style={{ color: T.muted, fontFamily: T.mono, fontSize: 11 }}>
                    {' '}
                    · {channelLabel(currentInstance.channel)}
                  </span>
                )}
              </span>
              <span style={{ color: T.muted, flexShrink: 0 }}>▾</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={instanceId ?? ''} onValueChange={(v) => setLocalInstanceId(v || null)}>
              <DropdownMenuRadioItem value="">All instances</DropdownMenuRadioItem>
              {scope.instances.map((inst) => (
                <DropdownMenuRadioItem key={inst.id} value={inst.id}>
                  {inst.name} · {channelLabel(inst.channel)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats…" size="small" />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontFamily: T.mono,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: T.muted,
          }}
        >
          <Toggle checked={includeArchived} onChange={setIncludeArchived} aria-label="Include archived chats" />
          Include archived
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {list.isLoading && chats.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
            <Spinner />
          </div>
        ) : chats.length === 0 ? (
          <div style={{ padding: 16 }}>
            <EmptyState
              title={list.error ? 'Failed to load' : 'No chats found'}
              description={list.error ? list.error.message : 'Adjust the instance or search filters.'}
              compact
            />
          </div>
        ) : (
          <ListView<ChatRow>
            items={chats}
            selected={selectedChatId}
            onSelect={selectByKey}
            onActivate={(chat) => onSelectChat(chat)}
            getKey={(chat) => chat.id}
            className="h-full"
            renderItem={(chat, { selected }) => <ChatRowContent chat={chat} selected={selected} />}
          />
        )}
      </div>

      <div style={{ padding: '6px 10px', borderTop: `1px solid ${T.border}` }}>
        <FreshnessBadge observedAt={list.lastPolledAt} source="chats 6s" degraded={Boolean(list.error)} />
      </div>
    </div>
  );
}

/** Row body. Full-bleed so the copper selection asserts over the ListView's own
 * (blue) selected tint, keeping copper as the single selection color. */
function ChatRowContent({ chat, selected }: { chat: ChatRow; selected: boolean }) {
  const flags = chatFlags(chat);
  const unread = chat.unreadCount ?? 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '-4px -8px',
        padding: '9px 12px 10px',
        borderBottom: `1px solid ${T.borderSubtle}`,
        background: selected ? 'color-mix(in oklch, var(--khal-accent) 13%, var(--khal-bg-surface))' : 'transparent',
        boxShadow: selected ? 'inset 2px 0 0 var(--khal-accent)' : 'none',
      }}
    >
      <Avatar name={chatDisplayName(chat)} src={chat.avatarUrl ?? undefined} size="sm" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {flags.pinned && (
            <span title="Pinned" aria-hidden style={{ fontSize: 10 }}>
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
          {isProductionChat(chat) && isCanaryChat(chat) && <StatusTag color={T.ok} label="canary" />}
          <span style={{ fontSize: 10.5, color: T.muted, flexShrink: 0, fontFamily: T.mono }}>
            {lastActivityLabel(chat)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
          <span
            style={{
              fontSize: 12,
              color: unread > 0 ? T.secondary : T.muted,
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
            <span title="Muted" aria-hidden style={{ fontSize: 10 }}>
              🔕
            </span>
          )}
          {flags.archived && (
            <span style={{ fontSize: 9, fontFamily: T.mono, textTransform: 'uppercase', color: T.muted }}>arch</span>
          )}
          {unread > 0 && (
            <PillBadge size="sm" variant="accent">
              {unread > 99 ? '99+' : unread}
            </PillBadge>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusTag({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: T.mono,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

const selectorTrigger = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.bg,
  color: T.fg,
  fontSize: 12.5,
  cursor: 'pointer',
} as const;
