import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { CreateAccessRuleBody, ListAccessRulesParams } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * List access rules
 */
export function useAccessRules(params?: ListAccessRulesParams) {
  return useQuery({
    queryKey: queryKeys.accessRulesList(params as Record<string, unknown> | undefined),
    queryFn: () => getClient().access.listRules(params),
  });
}

/**
 * Create an access rule
 */
export function useCreateAccessRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateAccessRuleBody) => getClient().access.createRule(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-rules'] });
    },
  });
}

/**
 * Delete an access rule
 */
export function useDeleteAccessRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getClient().access.deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-rules'] });
    },
  });
}

/**
 * Check if a user has access
 */
export function useCheckAccess() {
  return useMutation({
    mutationFn: (params: { instanceId: string; platformUserId: string; channel: string }) =>
      getClient().access.checkAccess(params),
  });
}
