'use client';

/**
 * Center pane: the conversation thread. Day separators, sender grouping, media,
 * delivery ticks (via {@link MessageBubble}), backward windowing (load-older on
 * scroll-to-top), a freshness badge for the live poll, and the composer pinned
 * to the bottom. Auto-scrolls to the newest message only when the operator is
 * already near the bottom, so reading history isn't yanked away.
 */
import { Avatar, Button, EmptyState, Spinner } from '@khal-os/ui';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { T } from '../../components/tokens';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import {
  chatDisplayName,
  dayKey,
  formatDaySeparator,
  isCanaryChat,
  isProductionChat,
  messageTime,
} from './chat-helpers';
import { useChatThread } from './useChatData';

function DaySeparator({ ts }: { ts: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
      <span
        style={{
          fontSize: 11,
          color: T.muted,
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 999,
          padding: '2px 10px',
        }}
      >
        {formatDaySeparator(ts)}
      </span>
    </div>
  );
}

export function ChatThread({
  chat,
  actions,
}: {
  chat: ChatRow;
  /** The chat actions menu, rendered in the header. */
  actions?: ReactNode;
}) {
  const thread = useChatThread(chat.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const prevCount = useRef(0);
  const prevScrollHeight = useRef(0);

  // Track proximity to the bottom so we don't hijack scrolling during reading.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setNearBottom(distance < 120);
    if (el.scrollTop < 60 && thread.hasMore && !thread.loadingOlder) {
      prevScrollHeight.current = el.scrollHeight;
      thread.loadOlder();
    }
  };

  // On message-count change: preserve the viewport anchor after an older-message
  // prepend, otherwise follow the newest message when already near the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = thread.messages.length;
    if (prevScrollHeight.current && el.scrollHeight > prevScrollHeight.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = 0;
    } else if (count > prevCount.current && nearBottom) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
    prevCount.current = count;
  }, [thread.messages.length, nearBottom]);

  const isGroup = Boolean(chat.isGroup) || chat.chatType === 'group';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: T.bg }}>
      {/* header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}
      >
        <Avatar name={chatDisplayName(chat)} src={chat.avatarUrl ?? undefined} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 650, fontSize: 14, color: T.fg, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {chatDisplayName(chat)}
            </span>
            {isProductionChat(chat) &&
              (isCanaryChat(chat) ? (
                <span style={tagStyle(T.ok)}>canary</span>
              ) : (
                <span style={tagStyle(T.warn)}>production</span>
              ))}
          </div>
          <div style={{ fontSize: 11.5, color: T.muted }}>
            {isGroup ? `Group · ${chat.participantCount ?? '—'} participants` : chat.chatType} ·{' '}
            <span style={{ fontFamily: T.mono }}>{chat.id.slice(0, 8)}</span>
          </div>
        </div>
        <FreshnessBadge observedAt={thread.lastPolledAt} source="poll 2.5s" degraded={Boolean(thread.error)} />
        {actions}
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', minHeight: 0 }}
      >
        {thread.initialLoading && thread.messages.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner />
          </div>
        ) : thread.messages.length === 0 ? (
          <EmptyState title="No messages yet" description="Send the first message below." compact />
        ) : (
          <>
            {thread.hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 8px' }}>
                <Button
                  typeName="button"
                  variant="ghost"
                  size="small"
                  onClick={thread.loadOlder}
                  loading={thread.loadingOlder}
                >
                  {thread.loadingOlder ? 'Loading…' : 'Load older'}
                </Button>
              </div>
            )}
            {thread.messages.map((msg, i) => {
              const prev = thread.messages[i - 1];
              const ts = messageTime(msg);
              const dayChanged = !prev || dayKey(messageTime(prev)) !== dayKey(ts);
              const showSender =
                !msg.isFromMe && isGroup && (dayChanged || prev?.senderPlatformUserId !== msg.senderPlatformUserId);
              return (
                <div key={msg.id} style={{ marginBottom: 4 }}>
                  {dayChanged && <DaySeparator ts={ts} />}
                  <MessageBubble msg={msg} showSender={showSender} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <Composer chat={chat} instanceId={chat.instanceId} />
    </div>
  );
}

function tagStyle(color: string) {
  return {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color,
    border: `1px solid ${color}`,
    borderRadius: 999,
    padding: '1px 7px',
  };
}
