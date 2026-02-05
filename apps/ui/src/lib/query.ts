/**
 * TanStack Query configuration
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Create a configured QueryClient instance
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Stale time of 30 seconds for most data
        staleTime: 30 * 1000,
        // Retry failed queries up to 2 times
        retry: 2,
        // Refetch on window focus
        refetchOnWindowFocus: true,
        // Don't refetch on mount if data is fresh
        refetchOnMount: true,
      },
      mutations: {
        // Retry failed mutations once
        retry: 1,
      },
    },
  });
}

/**
 * Query keys for consistent caching
 */
export const queryKeys = {
  // Auth
  auth: ['auth'] as const,
  authValidate: () => [...queryKeys.auth, 'validate'] as const,

  // Instances
  instances: ['instances'] as const,
  instancesList: (params?: Record<string, unknown>) => [...queryKeys.instances, 'list', params] as const,
  instance: (id: string) => [...queryKeys.instances, id] as const,
  instanceStatus: (id: string) => [...queryKeys.instances, id, 'status'] as const,
  instanceQr: (id: string) => [...queryKeys.instances, id, 'qr'] as const,

  // Chats
  chats: ['chats'] as const,
  chatsList: (params?: Record<string, unknown>) => [...queryKeys.chats, 'list', params] as const,
  chat: (id: string) => [...queryKeys.chats, id] as const,
  chatMessages: (id: string, params?: Record<string, unknown>) => [...queryKeys.chats, id, 'messages', params] as const,

  // Events
  events: ['events'] as const,
  eventsList: (params?: Record<string, unknown>) => [...queryKeys.events, 'list', params] as const,

  // Logs
  logs: ['logs'] as const,
  logsRecent: (params?: Record<string, unknown>) => [...queryKeys.logs, 'recent', params] as const,

  // System
  system: ['system'] as const,
  systemHealth: () => [...queryKeys.system, 'health'] as const,

  // Persons
  persons: ['persons'] as const,
  personSearch: (search: string) => [...queryKeys.persons, 'search', search] as const,
  person: (id: string) => [...queryKeys.persons, id] as const,

  // Settings
  settings: ['settings'] as const,
  settingsList: (params?: Record<string, unknown>) => [...queryKeys.settings, 'list', params] as const,

  // Automations
  automations: ['automations'] as const,
  automationsList: (params?: Record<string, unknown>) => [...queryKeys.automations, 'list', params] as const,
  automation: (id: string) => [...queryKeys.automations, id] as const,
} as const;
