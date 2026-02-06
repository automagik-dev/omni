import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { SearchPersonsParams } from '@omni/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Search for persons
 */
export function usePersons(params: SearchPersonsParams) {
  return useQuery({
    queryKey: queryKeys.personsList({ search: params.search, limit: params.limit }),
    queryFn: () => getClient().persons.search(params),
    enabled: params.search.length >= 2, // Only search with at least 2 characters
  });
}

/**
 * Fetch a single person by ID
 */
export function usePerson(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.personsDetail(id!),
    queryFn: () => getClient().persons.get(id!),
    enabled: !!id,
  });
}

/**
 * Get person presence (all identities and activity summary)
 */
export function usePersonPresence(id: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.personsDetail(id!), 'presence'],
    queryFn: () => getClient().persons.presence(id!),
    enabled: !!id,
  });
}

/**
 * Link two identities to the same person
 */
export function useLinkIdentities() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ identityA, identityB }: { identityA: string; identityB: string }) => {
      const client = getClient();
      const baseUrl = (client as unknown as { baseUrl: string }).baseUrl || '';
      const response = await fetch(`${baseUrl}/api/v2/persons/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('omni-api-key') || ''}`,
        },
        body: JSON.stringify({ identityA, identityB }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error?.message || 'Failed to link identities');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
  });
}

/**
 * Unlink an identity from its person
 */
export function useUnlinkIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ identityId, reason }: { identityId: string; reason: string }) => {
      const client = getClient();
      const baseUrl = (client as unknown as { baseUrl: string }).baseUrl || '';
      const response = await fetch(`${baseUrl}/api/v2/persons/unlink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('omni-api-key') || ''}`,
        },
        body: JSON.stringify({ identityId, reason }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error?.message || 'Failed to unlink identity');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
  });
}

/**
 * Merge two persons into one
 */
export function useMergePersons() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sourcePersonId,
      targetPersonId,
      reason,
    }: {
      sourcePersonId: string;
      targetPersonId: string;
      reason?: string;
    }) => {
      const client = getClient();
      const baseUrl = (client as unknown as { baseUrl: string }).baseUrl || '';
      const response = await fetch(`${baseUrl}/api/v2/persons/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('omni-api-key') || ''}`,
        },
        body: JSON.stringify({ sourcePersonId, targetPersonId, reason }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error?.message || 'Failed to merge persons');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
  });
}
