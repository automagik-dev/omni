import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { Message } from '@omni/sdk';
import { useInfiniteQuery } from '@tanstack/react-query';

const PAGE_SIZE = 50;

/**
 * Hook for infinite scroll messages (loads older messages when scrolling up)
 *
 * Note: API returns messages newest-first. We reverse them for display (oldest at top).
 */
export function useInfiniteMessages(chatId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.chatMessages(chatId ?? '', { infinite: true }),
    queryFn: async ({ pageParam }) => {
      if (!chatId) return { items: [] as Message[], hasMore: false };

      const messages = await getClient().chats.getMessages(chatId, {
        limit: PAGE_SIZE,
        before: pageParam ?? undefined,
      });

      // API returns messages, we need to determine if there are more
      const hasMore = messages.length === PAGE_SIZE;
      const oldestMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;

      return {
        items: messages,
        hasMore,
        oldestMessageId,
      };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.oldestMessageId : undefined),
    enabled: !!chatId,
  });
}

/**
 * Flatten and reverse messages for display (oldest at top, newest at bottom)
 */
export function flattenAndReverseMessages(data: ReturnType<typeof useInfiniteMessages>['data']): Message[] {
  if (!data) return [];
  // Flatten all pages, then reverse so oldest is first
  const allMessages = data.pages.flatMap((page) => page.items);
  return [...allMessages].reverse();
}
