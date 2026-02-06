import { getClient } from '@/lib/sdk';
import type { Automation, CreateAutomationBody } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Query keys for automations
 */
export const automationKeys = {
  all: ['automations'] as const,
  list: () => [...automationKeys.all, 'list'] as const,
  detail: (id: string) => [...automationKeys.all, 'detail', id] as const,
  logs: (id: string) => [...automationKeys.all, 'logs', id] as const,
};

/**
 * Hook for listing all automations
 */
export function useAutomations() {
  return useQuery<Automation[]>({
    queryKey: automationKeys.list(),
    queryFn: () => getClient().automations.list(),
  });
}

/**
 * Hook for getting a single automation
 */
export function useAutomation(id: string | undefined) {
  return useQuery<Automation>({
    queryKey: automationKeys.detail(id ?? ''),
    queryFn: () => getClient().automations.get(id!),
    enabled: !!id,
  });
}

/**
 * Hook for creating an automation
 */
export function useCreateAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAutomationBody) => getClient().automations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

/**
 * Hook for updating an automation
 */
export function useUpdateAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateAutomationBody> }) =>
      getClient().automations.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
    },
  });
}

/**
 * Hook for deleting an automation
 */
export function useDeleteAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().automations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
    },
  });
}

/**
 * Hook for enabling an automation
 */
export function useEnableAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().automations.enable(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
    },
  });
}

/**
 * Hook for disabling an automation
 */
export function useDisableAutomation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().automations.disable(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: automationKeys.all });
      queryClient.invalidateQueries({ queryKey: automationKeys.detail(id) });
    },
  });
}

/**
 * Hook for testing an automation (dry run)
 */
export function useTestAutomation() {
  return useMutation({
    mutationFn: ({ id, event }: { id: string; event: { type: string; payload: Record<string, unknown> } }) =>
      getClient().automations.test(id, { event }),
  });
}

/**
 * Hook for getting automation logs
 */
export function useAutomationLogs(id: string | undefined) {
  return useQuery({
    queryKey: automationKeys.logs(id ?? ''),
    queryFn: () => getClient().automations.getLogs(id!),
    enabled: !!id,
  });
}
