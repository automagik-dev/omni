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
import { readSlackReturnNonce } from '../pages/instances/instance-helpers';
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

/**
 * Where this mount should start.
 *
 * Normally the host's `initialPath`. The one exception is the Slack install
 * return leg: the callback sends the browser back to the shell URL carrying
 * `?slack=<nonce>`, and only the instances page knows how to resolve that
 * nonce, report the outcome and refresh the list. The nonce is single-use and
 * expires in five minutes, so if this mount opened on some other route the
 * outcome would simply never be surfaced. Reading the browser query to choose
 * the starting route is the same thing the dev harness does through
 * `meta.initialPath`; it neither navigates nor rewrites the URL bar, and the
 * instances page still owns the nonce.
 */
function startingPath(initialPath: string): string {
  if (typeof window === 'undefined') return initialPath;
  return readSlackReturnNonce(window.location.search) === null ? initialPath : '/instances';
}

export function OmniAdminApp({ bffBase = '/omni', initialPath = '/' }: OmniAdminAppProps) {
  const [router] = useState(() => createMemoryRouter(routes, { initialEntries: [startingPath(initialPath)] }));

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
