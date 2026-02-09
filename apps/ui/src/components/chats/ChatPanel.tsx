import { Spinner } from '@/components/ui/spinner';
import { useChatParticipants, useSendMedia, useSendMessage, useToggleAgent } from '@/hooks/useChats';
import { flattenAndReverseMessages, useInfiniteMessages } from '@/hooks/useInfiniteMessages';
import { useInstance } from '@/hooks/useInstances';
import type { Chat } from '@omni/sdk';
import { MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatHeader } from './ChatHeader';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';

interface ChatPanelProps {
  chat: Chat;
  onBack: () => void;
}

// Chat types that are considered group chats (show sender names)
const GROUP_CHAT_TYPES = ['group', 'channel', 'thread', 'forum', 'community', 'announcement'];

/**
 * Full chat conversation panel
 */
export function ChatPanel({ chat, onBack }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { data: instance } = useInstance(chat.instanceId);
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteMessages(chat.id);
  const { data: participants } = useChatParticipants(chat.id);
  const sendMessage = useSendMessage();
  const sendMedia = useSendMedia();
  const toggleAgent = useToggleAgent();

  const agentPaused = chat.settings?.agentPaused ?? false;
  const [showTypingIndicator] = useState(false);

  const messages = flattenAndReverseMessages(data);
  const isGroupChat = GROUP_CHAT_TYPES.includes(chat.chatType);

  // Scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Auto-scroll to bottom on initial load and new messages
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      scrollToBottom();
    }
  }, [isLoading, messages.length, scrollToBottom]);

  // Load more when scrolling to top
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;

    if (el.scrollTop < 100) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const handleSend = async (text: string) => {
    try {
      await sendMessage.mutateAsync({
        instanceId: chat.instanceId,
        to: chat.externalId,
        text,
      });
    } catch {
      // Error handled by mutation
    }
  };

  const handleSendMedia = async (file: File, caption?: string) => {
    try {
      await sendMedia.mutateAsync({
        instanceId: chat.instanceId,
        to: chat.externalId,
        file,
        caption,
      });
    } catch {
      // Error handled by mutation
    }
  };

  const handleToggleAgent = async () => {
    try {
      await toggleAgent.mutateAsync({
        chatId: chat.id,
        paused: !agentPaused,
      });
    } catch {
      // Error handled by mutation
    }
  };

  const error =
    sendMessage.error instanceof Error
      ? sendMessage.error.message
      : sendMedia.error instanceof Error
        ? sendMedia.error.message
        : null;

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        chat={chat}
        instance={instance}
        onBack={onBack}
        participantCount={participants?.length}
        agentPaused={agentPaused}
        onToggleAgent={handleToggleAgent}
        agentToggleLoading={toggleAgent.isPending}
      />

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-4"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <Spinner size="sm" />
          </div>
        )}

        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="h-12 w-12" />
            <p className="mt-4">No messages yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                showSenderName={isGroupChat}
                isGroupChat={isGroupChat}
                instanceId={chat.instanceId}
                to={chat.externalId}
              />
            ))}

            {/* Typing indicator */}
            {showTypingIndicator && <TypingIndicator displayName={chat.name || 'Someone'} />}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <MessageInput
        chatId={chat.id}
        instanceId={chat.instanceId}
        to={chat.externalId}
        channel={chat.channel}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        disabled={sendMessage.isPending || sendMedia.isPending}
        error={error}
      />
    </div>
  );
}
