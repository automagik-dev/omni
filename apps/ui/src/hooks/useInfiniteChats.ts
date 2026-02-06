import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { ListChatsParams } from '@omni/sdk';
import { useInfiniteQuery } from '@tanstack/react-query';

const PAGE_SIZE = 50;

/**
 * Hook for infinite scroll chat list
 */
export function useInfiniteChats(params?: Omit<ListChatsParams, 'cursor' | 'limit'>) {
  return useInfiniteQuery({
    queryKey: queryKeys.chatsList({ ...params, infinite: true }),
    queryFn: async ({ pageParam }) => {
      const result = await getClient().chats.list({
        ...params,
        limit: PAGE_SIZE,
        cursor: pageParam ?? undefined,
      });
      return result;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.cursor : undefined),
  });
}

/**
 * Helper to flatten infinite query pages into a single array
 */
export function flattenChats(data: ReturnType<typeof useInfiniteChats>['data']) {
  if (!data) return [];
  return data.pages.flatMap((page) => page.items);
}
