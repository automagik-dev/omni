'use client';

/**
 * The OS-native left rail: a `SidebarNav` compound under a brand header
 * (KhalLogo + app name + theme switch) and a live search that filters the nav.
 * Groups and items come straight from {@link SITEMAP}, so the rail and the
 * router never drift. Navigation uses the pack's memory router (see
 * {@link OmniAdminApp}); each item marks itself active from the current route.
 */
import { Icons, Input, KhalLogo, SidebarNav, ThemeSwitcher, Tooltip } from '@khal-os/ui';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { T } from '../components/tokens';
import { SITEMAP } from './sitemap';

/** Sidebar rail width — the OS silhouette's fixed left column. */
export const SIDEBAR_WIDTH = 268;

function isActive(current: string, path: string): boolean {
  if (path === '/') return current === '/';
  return current === path || current.startsWith(`${path}/`);
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SITEMAP;
    return SITEMAP.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        minHeight: 0,
        background: T.chrome,
        borderRight: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 16px 12px',
        }}
      >
        <KhalLogo size={20} variant="light" />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 650, letterSpacing: '-0.01em', color: T.fg }}>
          Omni Admin
        </span>
        <Tooltip text="Theme" desktopOnly>
          <span style={{ display: 'inline-flex' }}>
            <ThemeSwitcher small />
          </span>
        </Tooltip>
      </div>

      <div style={{ padding: '0 12px 10px' }}>
        <Input
          size="small"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          aria-label="Search navigation"
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 12px' }}>
        {groups.length === 0 ? (
          <p style={{ margin: 0, padding: '12px 8px', fontSize: 12, color: T.muted }}>No matches for "{query}".</p>
        ) : (
          <SidebarNav label="Omni Admin">
            {groups.map((group) => {
              const Icon = Icons[group.icon] ?? Icons.Folder;
              return (
                <SidebarNav.Group key={group.id} title={group.title}>
                  {group.items.map((item) => (
                    <SidebarNav.Item
                      key={item.path}
                      icon={<Icon size={15} />}
                      active={isActive(location.pathname, item.path)}
                      onClick={() => navigate(item.path)}
                    >
                      {item.label}
                    </SidebarNav.Item>
                  ))}
                </SidebarNav.Group>
              );
            })}
          </SidebarNav>
        )}
      </div>
    </aside>
  );
}
