import { getClient } from '@/lib/sdk';
import type { BatchJob, CreateBatchJobBody, ListBatchJobsParams } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Query keys for batch jobs
 */
export const batchJobKeys = {
  all: ['batchJobs'] as const,
  list: (params?: ListBatchJobsParams) => [...batchJobKeys.all, 'list', params] as const,
  detail: (id: string) => [...batchJobKeys.all, 'detail', id] as const,
  status: (id: string) => [...batchJobKeys.all, 'status', id] as const,
};

/**
 * Hook for listing batch jobs
 */
export function useBatchJobs(params?: ListBatchJobsParams) {
  return useQuery({
    queryKey: batchJobKeys.list(params),
    queryFn: () => getClient().batchJobs.list(params),
  });
}

/**
 * Hook for getting a single batch job
 */
export function useBatchJob(id: string | undefined) {
  return useQuery<BatchJob>({
    queryKey: batchJobKeys.detail(id ?? ''),
    queryFn: () => getClient().batchJobs.get(id!),
    enabled: !!id,
  });
}

/**
 * Hook for getting batch job status (lightweight, for polling)
 */
export function useBatchJobStatus(id: string | undefined, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: batchJobKeys.status(id ?? ''),
    queryFn: () => getClient().batchJobs.getStatus(id!),
    enabled: options?.enabled !== false && !!id,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Hook for creating a batch job
 */
export function useCreateBatchJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBatchJobBody) => getClient().batchJobs.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchJobKeys.all });
    },
  });
}

/**
 * Hook for cancelling a batch job
 */
export function useCancelBatchJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().batchJobs.cancel(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: batchJobKeys.all });
      queryClient.invalidateQueries({ queryKey: batchJobKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: batchJobKeys.status(id) });
    },
  });
}

/**
 * Hook for estimating batch job cost
 */
export function useEstimateBatchJob() {
  return useMutation({
    mutationFn: (data: Omit<CreateBatchJobBody, 'force'>) => getClient().batchJobs.estimate(data),
  });
}
