'use client';

/**
 * Root of the Omni Admin pack: providers + router.
 *
 * Router choice — **memory router**. The pack renders inside a KHAL window (or
 * the dev harness), neither of which owns the browser URL bar in a way the pack
 * should hijack. A memory router keeps navigation state entirely inside the pack,
 * so it behaves identically standalone and embedded, and multiple windows never
 * fight over the address bar. One router is created per mount, giving each window
 * its own history.
 *
 * Provider order (outer → inner): OmniClient (data layer) → Query (cache) →
 * Scope (instance/channel selection, which needs the client + cache).
 */
import { useState } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { OmniClientProvider } from './providers/OmniClientProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ScopeProvider } from './providers/ScopeProvider';
import { routes } from './routes';

export interface OmniAdminAppProps {
  /** BFF mount the SDK targets (default `/omni`). */
  bffBase?: string;
  /** Initial route for the memory router (default `/`). */
  initialPath?: string;
}

export function OmniAdminApp({ bffBase = '/omni', initialPath = '/' }: OmniAdminAppProps) {
  const [router] = useState(() => createMemoryRouter(routes, { initialEntries: [initialPath] }));

  return (
    <OmniClientProvider bffBase={bffBase}>
      <QueryProvider>
        <ScopeProvider>
          <RouterProvider router={router} />
        </ScopeProvider>
      </QueryProvider>
    </OmniClientProvider>
  );
}
