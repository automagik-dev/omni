'use client';

/**
 * Shell layout route: the collapsible sidebar beside a column of the global
 * header and the routed page ({@link Outlet}). The page area scrolls
 * independently so the header and sidebar stay put. Fills its container, so it
 * works both as the harness's full window and as an embedded KHAL view.
 */
import { Outlet, useLocation } from 'react-router-dom';
import { T } from '../components/tokens';
import { AuthBanner } from './AuthBanner';
import { Header } from './Header';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const location = useLocation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%' }}>
      <AuthBanner />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', background: T.bg, color: T.fg }}>
        <Sidebar />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <Header />
          <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {/* Keyed by pathname so a crashed page auto-clears when you navigate away. */}
            <RouteErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </RouteErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  );
}
