'use client';

/**
 * Center pane: the conversation thread. Day separators, sender grouping, media,
 * delivery ticks (via {@link MessageBubble}), backward windowing (load-older on
 * scroll-to-top), a freshness badge for the live poll, and the composer pinned
 * to the bottom. Auto-scrolls to the newest message only when the operator is
 * already near the bottom, so reading history isn't yanked away — and floats a
 * "new messages" chip when a message lands while scrolled up.
 */
import { Avatar, Button, EmptyState, GlassCard, PillBadge, Spinner } from '@khal-os/ui';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
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
    <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 10px' }}>
      <span
        style={{
          fontSize: 10,
          fontFamily: T.mono,
          fontWeight: 650,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: T.tertiary,
          background: T.surface,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: 999,
          padding: '3px 12px',
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
  const [hasNew, setHasNew] = useState(false);
  const prevCount = useRef(0);
  const prevScrollHeight = useRef(0);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    setHasNew(false);
  };

  // Track proximity to the bottom so we don't hijack scrolling during reading.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 120;
    setNearBottom(near);
    if (near) setHasNew(false);
    if (el.scrollTop < 60 && thread.hasMore && !thread.loadingOlder) {
      prevScrollHeight.current = el.scrollHeight;
      thread.loadOlder();
    }
  };

  // On message-count change: preserve the viewport anchor after an older-message
  // prepend, otherwise follow the newest message when already near the bottom —
  // and raise the "new messages" chip when one lands while scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = thread.messages.length;
    if (prevScrollHeight.current && el.scrollHeight > prevScrollHeight.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = 0;
    } else if (count > prevCount.current) {
      if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
      else if (prevCount.current > 0) setHasNew(true);
    }
    prevCount.current = count;
  }, [thread.messages.length, nearBottom]);

  const isGroup = Boolean(chat.isGroup) || chat.chatType === 'group';
  const production = isProductionChat(chat);
  const canary = isCanaryChat(chat);

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
            <span
              style={{
                fontWeight: 650,
                fontSize: 14,
                color: T.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {chatDisplayName(chat)}
            </span>
            {production &&
              (canary ? (
                <PillBadge size="sm" variant="accent" dot dotColor={T.ok}>
                  canary
                </PillBadge>
              ) : (
                <PillBadge size="sm" variant="muted" dot dotColor={T.warn}>
                  production
                </PillBadge>
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
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={scrollRef} onScroll={onScroll} style={{ height: '100%', overflowY: 'auto', padding: '8px 14px' }}>
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
                  <div key={msg.id} className="omni-msg-in" style={{ marginBottom: 4 }}>
                    {dayChanged && <DaySeparator ts={ts} />}
                    <MessageBubble msg={msg} showSender={showSender} />
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {hasNew && (
          <button
            type="button"
            onClick={scrollToBottom}
            style={{
              position: 'absolute',
              bottom: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <GlassCard variant="raised" padding="sm" hover>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: T.fg,
                }}
              >
                <span style={{ color: T.accent }}>↓</span> New messages
              </span>
            </GlassCard>
          </button>
        )}
      </div>

      <Composer chat={chat} instanceId={chat.instanceId} />
    </div>
  );
}
