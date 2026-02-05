import { queryKeys } from '@/lib/query';
import { clearApiKey, getClient, isAuthenticated, setApiKey } from '@/lib/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Hook for authentication state and actions
 */
export function useAuth() {
  const queryClient = useQueryClient();

  // Check if authenticated
  const authenticated = isAuthenticated();

  // Validate the current API key
  const { data: validation, isLoading: isValidating } = useQuery({
    queryKey: queryKeys.authValidate(),
    queryFn: () => getClient().auth.validate(),
    enabled: authenticated,
    retry: false,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      // Set the key first
      setApiKey(apiKey);
      // Then validate it
      const result = await getClient().auth.validate();
      if (!result.valid) {
        clearApiKey();
        throw new Error('Invalid API key');
      }
      return result;
    },
    onSuccess: () => {
      // Invalidate all queries to refetch with new auth
      queryClient.invalidateQueries();
    },
    onError: () => {
      clearApiKey();
    },
  });

  // Logout function
  const logout = () => {
    clearApiKey();
    queryClient.clear();
    window.location.href = '/login';
  };

  return {
    isAuthenticated: authenticated,
    isValidating,
    isValid: validation?.valid ?? false,
    keyInfo: validation ? { prefix: validation.keyPrefix, name: validation.keyName, scopes: validation.scopes } : null,
    login: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    logout,
  };
}
