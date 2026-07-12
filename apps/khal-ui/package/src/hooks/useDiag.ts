'use client';

/**
 * Polls the BFF `/diag` endpoint for auth state, backend version, and latency.
 * Drives the header freshness chip and the Health page. `/diag` lives at the BFF
 * origin root (not under `/omni`), so it reports the BFF↔backend edge, not a
 * proxied backend call.
 */
import { useQuery } from '@tanstack/react-query';
import { useOmniClient } from '../app/providers/OmniClientProvider';

export interface DiagResult {
  auth: 'ok' | 'invalid' | 'error';
  keyPrefix?: string | null;
  keyName?: string | null;
  scopes?: string[];
  version?: string | null;
  latencyMs?: number;
  baseUrl?: string;
  reason?: string;
  message?: string;
  /** Upstream HTTP status when the key was rejected (auth: 'invalid'). */
  upstreamStatus?: number;
}

async function fetchDiag(diagPath: string): Promise<DiagResult> {
  const res = await fetch(diagPath, { headers: { accept: 'application/json' } });
  const json = (await res.json()) as DiagResult;
  return json;
}

export interface UseDiagResult {
  diag: DiagResult | undefined;
  isLoading: boolean;
  error: Error | null;
  /** When the current data was observed (epoch ms), for the freshness chip. */
  observedAt: number | undefined;
  refresh: () => void;
}

export function useDiag(pollMs = 15_000): UseDiagResult {
  const { diagPath } = useOmniClient();
  const query = useQuery({
    queryKey: ['diag', diagPath],
    queryFn: () => fetchDiag(diagPath),
    refetchInterval: pollMs,
    staleTime: pollMs,
  });

  return {
    diag: query.data,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    observedAt: query.dataUpdatedAt || undefined,
    refresh: () => void query.refetch(),
  };
}
