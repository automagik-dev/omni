import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import type { SearchPersonsParams } from '@omni/sdk';
import { useQuery } from '@tanstack/react-query';

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
