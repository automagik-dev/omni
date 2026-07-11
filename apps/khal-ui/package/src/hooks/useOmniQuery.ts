'use client';

/**
 * Query/mutation wrappers over TanStack Query, specialised for Omni.
 *
 * `useOmniQuery` is a thin typed pass-through. `useOmniMutation` encodes the
 * evidence-first mutation pattern this UI is built around: run the mutation,
 * invalidate the affected caches, then *read back* the entity so the UI can show
 * proof the change landed (consumed by {@link MutationResult}). Group B ships the
 * helper read-only; Waves 3–4 wire real mutations onto it.
 */
import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function useOmniQuery<TData>(
  key: QueryKey,
  queryFn: () => Promise<TData>,
  options?: { enabled?: boolean; refetchInterval?: number; staleTime?: number },
) {
  return useQuery({
    queryKey: key,
    queryFn,
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime,
  });
}

export interface OmniMutationConfig<TVars, TData, TReadBack> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** Query keys to invalidate on success (exact-prefix match). */
  invalidate?: QueryKey[];
  /** Re-fetch the affected entity after success to prove the write landed. */
  readBack?: (data: TData, vars: TVars) => Promise<TReadBack>;
}

export interface OmniMutationResult<TVars, TData, TReadBack> {
  mutate: (vars: TVars) => void;
  mutateAsync: (vars: TVars) => Promise<TData>;
  isPending: boolean;
  error: Error | null;
  data: TData | undefined;
  /** Evidence from the post-mutation read-back, once available. */
  readBackData: TReadBack | undefined;
  reset: () => void;
}

export function useOmniMutation<TVars, TData, TReadBack = unknown>(
  config: OmniMutationConfig<TVars, TData, TReadBack>,
): OmniMutationResult<TVars, TData, TReadBack> {
  const queryClient = useQueryClient();
  const [readBackData, setReadBackData] = useState<TReadBack | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: config.mutationFn,
    onSuccess: async (data, vars) => {
      for (const key of config.invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      if (config.readBack) {
        setReadBackData(await config.readBack(data, vars));
      }
    },
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: (mutation.error as Error | null) ?? null,
    data: mutation.data,
    readBackData,
    reset: () => {
      setReadBackData(undefined);
      mutation.reset();
    },
  };
}
