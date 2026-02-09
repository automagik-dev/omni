import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { useQuery } from '@tanstack/react-query';

/**
 * Hook for searching messages in a chat
 */
export function useMessageSearch(chatId: string, instanceId: string, query: string) {
  const search = useQuery({
    queryKey: [...queryKeys.events, 'search', chatId, query],
    queryFn: async () => {
      if (!query || query.length < 3) {
        return { items: [], meta: { hasMore: false } };
      }

      // Use events.list with search parameter
      return getClient().events.list({
        search: query,
        instanceId,
        // Filter by message events only
        eventType: 'message.received',
        limit: 50,
      });
    },
    enabled: query.length >= 3, // Only search with 3+ chars
  });

  return {
    results: search.data?.items ?? [],
    isSearching: search.isLoading,
    error: search.error,
  };
}
