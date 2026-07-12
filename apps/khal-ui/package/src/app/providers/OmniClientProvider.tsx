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
  const value = useMemo<OmniClientContextValue>(
    () => ({
      client: createOmniAdminClient(bffBase),
      ext: omniExt(bffBase),
      bffBase,
      diagPath,
    }),
    [bffBase, diagPath],
  );
  return <OmniClientContext.Provider value={value}>{children}</OmniClientContext.Provider>;
}

export function useOmniClient(): OmniClientContextValue {
  const value = useContext(OmniClientContext);
  if (!value) throw new Error('useOmniClient must be used within <OmniClientProvider>');
  return value;
}
