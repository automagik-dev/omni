'use client';

import type { OmniAdminAppProps } from '../../app/OmniAdminApp';
import { OmniAdminApp } from '../../app/OmniAdminApp';

interface MainViewProps {
  windowId?: string;
  meta?: Record<string, unknown>;
}

/**
 * KHAL view entry for the Omni Admin pack. The KHAL host supplies the theme,
 * auth, and tooltip context around this component (the dev harness reproduces
 * them); everything below — data layer, router, and the full shell — is owned by
 * {@link OmniAdminApp}. `meta.initialPath`/`meta.bffBase` let the host deep-link
 * a window to a route or point the pack at a non-default BFF mount.
 */
export function MainView({ windowId, meta }: MainViewProps) {
  const initialPath = typeof meta?.initialPath === 'string' ? meta.initialPath : undefined;
  const bffBase = typeof meta?.bffBase === 'string' ? (meta.bffBase as OmniAdminAppProps['bffBase']) : undefined;

  return (
    <div data-window-id={windowId} style={{ height: '100%', minHeight: 0, display: 'flex' }}>
      <OmniAdminApp initialPath={initialPath} bffBase={bffBase} />
    </div>
  );
}
