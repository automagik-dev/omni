import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { CreateInstanceBody, ListInstancesParams } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Hook for listing instances
 */
export function useInstances(params?: ListInstancesParams) {
  return useQuery({
    queryKey: queryKeys.instancesList(params as Record<string, unknown>),
    queryFn: () => getClient().instances.list(params),
  });
}

/**
 * Hook for getting a single instance
 */
export function useInstance(id: string) {
  return useQuery({
    queryKey: queryKeys.instance(id),
    queryFn: () => getClient().instances.get(id),
    enabled: !!id,
  });
}

/**
 * Hook for getting instance status
 */
export function useInstanceStatus(id: string) {
  return useQuery({
    queryKey: queryKeys.instanceStatus(id),
    queryFn: () => getClient().instances.status(id),
    enabled: !!id,
    refetchInterval: 5000, // Poll every 5 seconds
  });
}

/**
 * Hook for getting instance QR code
 */
export function useInstanceQr(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.instanceQr(id),
    queryFn: () => getClient().instances.qr(id),
    enabled: !!id && enabled,
    refetchInterval: 10000, // Poll for QR updates
  });
}

/**
 * Hook for creating an instance
 */
export function useCreateInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInstanceBody) => getClient().instances.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances });
    },
  });
}

/**
 * Hook for deleting an instance
 */
export function useDeleteInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().instances.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances });
    },
  });
}

/**
 * Hook for connecting an instance
 */
export function useConnectInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, forceNewQr }: { id: string; forceNewQr?: boolean }) =>
      getClient().instances.connect(id, { forceNewQr }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instance(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.instanceStatus(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.instanceQr(variables.id) });
    },
  });
}

/**
 * Hook for disconnecting an instance
 */
export function useDisconnectInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().instances.disconnect(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instance(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.instanceStatus(id) });
    },
  });
}

/**
 * Hook for restarting an instance
 */
export function useRestartInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, forceNewQr }: { id: string; forceNewQr?: boolean }) =>
      getClient().instances.restart(id, forceNewQr),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instance(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.instanceStatus(variables.id) });
    },
  });
}

/**
 * Hook for logging out an instance
 */
export function useLogoutInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().instances.logout(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instance(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.instanceStatus(id) });
    },
  });
}
