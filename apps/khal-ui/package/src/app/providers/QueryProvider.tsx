'use client';

/**
 * TanStack Query provider for the pack. One `QueryClient` per pack mount (each
 * KHAL window gets its own cache). Defaults favour an admin console: no refetch
 * storms on window focus, one retry, and a short stale window so re-opening a
 * page shows fresh-enough data without a spinner.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
