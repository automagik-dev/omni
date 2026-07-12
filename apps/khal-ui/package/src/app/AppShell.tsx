'use client';

/**
 * The OS silhouette: a fixed 268px `SidebarNav` rail beside a main column of a
 * slim scope toolbar, the routed page ({@link Outlet}), and a bottom StatusBar.
 * The app root wears `khal-wallpaper` for a subtle branded ground. A ⌘K command
 * palette is owned here so one open-state drives the keyboard shortcut, the
 * toolbar affordance, and the StatusBar hint. The content area scrolls
 * independently; the rail, toolbar, and StatusBar stay put. Fills its container,
 * so it works both as the harness's full window and as an embedded KHAL view.
 */
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { T } from '../components/tokens';
import { AuthBanner } from './AuthBanner';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { OmniStatusBar } from './OmniStatusBar';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { Sidebar } from './Sidebar';

/** Content column width per route. Consoles and wide tables get the wider cap. */
const NORMAL_MAX = 1040;
const WIDE_MAX = 1440;
const WIDE_ROUTES = new Set(['/chat', '/events', '/logs', '/metrics', '/conversations', '/media-console']);

function isWideRoute(path: string): boolean {
  if (WIDE_ROUTES.has(path)) return true;
  // Detail routes (e.g. /instances/:id) are two-segment resource views — give
  // them the wider allowance too.
  return /^\/[^/]+\/[^/]+/.test(path);
}

export function AppShell() {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const wide = isWideRoute(location.pathname);

  return (
    <div
      className="khal-wallpaper"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%' }}
    >
      <AuthBanner />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', background: T.bg, color: T.fg }}>
        <Sidebar />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <Header onOpenPalette={openPalette} />
          <main
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Keyed by pathname so a crashed page auto-clears when you navigate
                away — and so the fade-up mount replays on each route change. The
                outer div owns the content padding; the inner caps + centers the
                column (1040 default, wider for consoles and big tables). */}
            <div
              key={location.pathname}
              className="khal-anim-fade-up"
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                padding: '40px clamp(24px, 4vw, 56px)',
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: wide ? WIDE_MAX : NORMAL_MAX,
                  margin: '0 auto',
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <RouteErrorBoundary resetKey={location.pathname}>
                  <Outlet />
                </RouteErrorBoundary>
              </div>
            </div>
          </main>
          <OmniStatusBar onOpenPalette={openPalette} />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
