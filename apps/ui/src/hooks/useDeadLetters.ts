import { toast } from '@/components/ui/toaster';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { ListDeadLettersParams, ResolveDeadLetterBody } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * List dead letters
 */
export function useDeadLetters(params?: ListDeadLettersParams) {
  return useQuery({
    queryKey: queryKeys.deadLettersList(params as Record<string, unknown> | undefined),
    queryFn: () => getClient().deadLetters.list(params),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

/**
 * Get dead letter statistics
 */
export function useDeadLetterStats() {
  return useQuery({
    queryKey: [...queryKeys.deadLetters, 'stats'],
    queryFn: () => getClient().deadLetters.stats(),
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

/**
 * Retry a dead letter
 */
export function useRetryDeadLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().deadLetters.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deadLetters });
      toast.success('Dead letter queued for retry');
    },
    onError: (error) => {
      toast.error(`Failed to retry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });
}

/**
 * Resolve a dead letter
 */
export function useResolveDeadLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResolveDeadLetterBody }) =>
      getClient().deadLetters.resolve(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deadLetters });
      toast.success('Dead letter marked as resolved');
    },
    onError: (error) => {
      toast.error(`Failed to resolve: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });
}

/**
 * Abandon a dead letter
 */
export function useAbandonDeadLetter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().deadLetters.abandon(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deadLetters });
      toast.success('Dead letter abandoned');
    },
    onError: (error) => {
      toast.error(`Failed to abandon: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });
}
