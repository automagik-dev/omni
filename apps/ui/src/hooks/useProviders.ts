import { getClient } from '@/lib/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// Add query keys for providers
const providerKeys = {
  all: ['providers'] as const,
  list: () => [...providerKeys.all, 'list'] as const,
  detail: (id: string) => [...providerKeys.all, id] as const,
  agents: (id: string) => [...providerKeys.all, id, 'agents'] as const,
  teams: (id: string) => [...providerKeys.all, id, 'teams'] as const,
  workflows: (id: string) => [...providerKeys.all, id, 'workflows'] as const,
};

/**
 * Hook for listing agent providers
 */
export function useProviders() {
  return useQuery({
    queryKey: providerKeys.list(),
    queryFn: () => getClient().providers.list(),
  });
}

/**
 * Hook for getting a single provider
 */
export function useProvider(id: string | undefined) {
  return useQuery({
    queryKey: providerKeys.detail(id ?? ''),
    queryFn: () => getClient().providers.get(id!),
    enabled: !!id,
  });
}

/**
 * Hook for listing agents from an Agno provider
 */
export function useProviderAgents(id: string | undefined) {
  return useQuery({
    queryKey: providerKeys.agents(id ?? ''),
    queryFn: () => getClient().providers.listAgents(id!),
    enabled: !!id,
  });
}

/**
 * Hook for listing teams from an Agno provider
 */
export function useProviderTeams(id: string | undefined) {
  return useQuery({
    queryKey: providerKeys.teams(id ?? ''),
    queryFn: () => getClient().providers.listTeams(id!),
    enabled: !!id,
  });
}

/**
 * Hook for listing workflows from an Agno provider
 */
export function useProviderWorkflows(id: string | undefined) {
  return useQuery({
    queryKey: providerKeys.workflows(id ?? ''),
    queryFn: () => getClient().providers.listWorkflows(id!),
    enabled: !!id,
  });
}

/**
 * Hook for creating a provider
 */
export function useCreateProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<ReturnType<typeof getClient>['providers']['create']>[0]) =>
      getClient().providers.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
    },
  });
}

/**
 * Hook for deleting a provider
 */
export function useDeleteProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().providers.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providerKeys.all });
    },
  });
}

/**
 * Hook for checking provider health
 */
export function useCheckProviderHealth() {
  return useMutation({
    mutationFn: (id: string) => getClient().providers.checkHealth(id),
  });
}
