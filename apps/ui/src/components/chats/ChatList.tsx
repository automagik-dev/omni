import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { flattenChats, useInfiniteChats } from '@/hooks/useInfiniteChats';
import { useInstances } from '@/hooks/useInstances';
import type { Chat } from '@omni/sdk';
import { MessageSquare, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatListItem } from './ChatListItem';

interface ChatListProps {
  selectedChatId?: string;
  onSelectChat: (chat: Chat) => void;
  instanceId?: string;
  onInstanceChange?: (instanceId: string | undefined) => void;
}

/**
 * Chat list panel with search and infinite scroll
 */
export function ChatList({ selectedChatId, onSelectChat, instanceId, onInstanceChange }: ChatListProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: instances } = useInstances();

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteChats({
    instanceId,
    search: debouncedSearch || undefined,
  });

  const chats = flattenChats(data);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div className="flex h-full flex-col border-r">
      {/* Search header */}
      <div className="border-b p-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        {instances && instances.items.length > 1 && (
          <select
            value={instanceId ?? ''}
            onChange={(e) => onInstanceChange?.(e.target.value || undefined)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All instances</option>
            {instances.items.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Chat list */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-12 w-12" />
            <p className="mt-4">No chats found</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {chats.map((chat) => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                isSelected={chat.id === selectedChatId}
                onClick={() => onSelectChat(chat)}
              />
            ))}
            {isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
