'use client';

/**
 * Six-group collapsible sidebar, driven entirely by {@link SITEMAP}. Navigation
 * uses the pack's memory router (see {@link OmniAdminApp}) so it never touches
 * the KHAL host's URL bar. Each item marks itself active from the current route.
 */
import { CollapsibleSidebar, Icons } from '@khal-os/ui';
import { useLocation, useNavigate } from 'react-router-dom';
import { SITEMAP } from './sitemap';

function isActive(current: string, path: string): boolean {
  if (path === '/') return current === '/';
  return current === path || current.startsWith(`${path}/`);
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <CollapsibleSidebar defaultSize={240} min={68} max={320} side="left">
      <CollapsibleSidebar.Header>
        <span style={{ fontSize: 13, fontWeight: 650, letterSpacing: '0.02em' }}>Omni Admin</span>
        <CollapsibleSidebar.CollapseButton />
      </CollapsibleSidebar.Header>
      <CollapsibleSidebar.Content>
        {SITEMAP.map((group) => {
          const Icon = Icons[group.icon] ?? Icons.Folder;
          return (
            <CollapsibleSidebar.Section key={group.id} title={group.title}>
              {group.items.map((item) => (
                <CollapsibleSidebar.Item
                  key={item.path}
                  icon={<Icon size={16} />}
                  active={isActive(location.pathname, item.path)}
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </CollapsibleSidebar.Item>
              ))}
            </CollapsibleSidebar.Section>
          );
        })}
      </CollapsibleSidebar.Content>
    </CollapsibleSidebar>
  );
}
