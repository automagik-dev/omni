'use client';

/**
 * Polls the BFF `/diag` endpoint for auth state, backend version, and latency.
 * Drives the header freshness chip and the Health page. `/diag` lives at the BFF
 * origin root (not under `/omni`), so it reports the BFF↔backend edge, not a
 * proxied backend call.
 */
import { useQuery } from '@tanstack/react-query';
import { useOmniClient } from '../app/providers/OmniClientProvider';
import { useKhalToken } from '../auth/useAuthz';

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

async function fetchDiag(diagPath: string, token?: string): Promise<DiagResult> {
  // `/diag` is a plain fetch, so it forwards the KHAL identity the same way the
  // `ext` layer does: `Authorization: Bearer <jwt>` when the host issued one. The
  // BFF's `validateKhalSession` accepts either this bearer or the same-origin
  // `khal-session` cookie (attached automatically), so the header is additive and
  // optional — omitted in the standalone/dev harness, where the cookie carries it.
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(diagPath, { headers });
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
  const token = useKhalToken();
  const query = useQuery({
    // Key on the token so a login/logout re-polls under the new identity.
    queryKey: ['diag', diagPath, token ?? null],
    queryFn: () => fetchDiag(diagPath, token),
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
