import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { ListContactsParams } from '@omni/sdk';
import { useInfiniteQuery } from '@tanstack/react-query';

/**
 * Fetch contacts from an instance with infinite scroll
 */
export function useInfiniteContacts(instanceId: string | undefined, params?: Omit<ListContactsParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.instance(instanceId!), 'contacts', params],
    queryFn: async ({ pageParam }) => {
      return getClient().instances.listContacts(instanceId!, {
        ...params,
        cursor: pageParam,
        limit: params?.limit ?? 50,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.cursor : undefined),
    enabled: !!instanceId,
  });
}
