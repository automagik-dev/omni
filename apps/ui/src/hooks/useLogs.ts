import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { ListLogsParams } from '@omni/sdk';
import { useQuery } from '@tanstack/react-query';

/**
 * Hook for fetching recent logs
 */
export function useLogs(params?: ListLogsParams) {
  return useQuery({
    queryKey: queryKeys.logsRecent(params as Record<string, unknown>),
    queryFn: () => getClient().logs.recent(params),
    refetchInterval: 5000, // Poll every 5 seconds for new logs
  });
}
