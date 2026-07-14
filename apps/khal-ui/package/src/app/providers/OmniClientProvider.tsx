'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { OmniAdminClient } from '../../api/client';
import { createOmniAdminClient } from '../../api/client';
/**
 * Provides the Omni data layer (typed SDK client + off-spec `ext` helpers) to
 * the whole pack, bound once to a BFF base. The API key never touches the
 * browser — the BFF injects it — so everything here is origin-relative and safe.
 */
import type { OmniExt } from '../../api/ext';
import { omniExt } from '../../api/ext';
import { useKhalToken } from '../../auth/useAuthz';

export interface OmniClientContextValue {
  client: OmniAdminClient;
  ext: OmniExt;
  /** BFF mount the SDK targets (default `/omni`). */
  bffBase: string;
  /** BFF diagnostics endpoint, at the BFF origin root (default `/diag`). */
  diagPath: string;
}

const OmniClientContext = createContext<OmniClientContextValue | null>(null);

export interface OmniClientProviderProps {
  children: ReactNode;
  bffBase?: string;
  diagPath?: string;
}

export function OmniClientProvider({ children, bffBase = '/omni', diagPath = '/diag' }: OmniClientProviderProps) {
  // The KHAL identity token (when the host issues one) is forwarded to the BFF
  // as `Authorization: Bearer <token>`. Absent (standalone harness) ⇒ omitted.
  const token = useKhalToken();
  const value = useMemo<OmniClientContextValue>(
    () => ({
      client: createOmniAdminClient(bffBase, token),
      ext: omniExt(bffBase, token),
      bffBase,
      diagPath,
    }),
    [bffBase, diagPath, token],
  );
  return <OmniClientContext.Provider value={value}>{children}</OmniClientContext.Provider>;
}

export function useOmniClient(): OmniClientContextValue {
  const value = useContext(OmniClientContext);
  if (!value) throw new Error('useOmniClient must be used within <OmniClientProvider>');
  return value;
}
