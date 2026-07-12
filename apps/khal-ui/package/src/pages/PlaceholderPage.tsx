'use client';

/**
 * Titled placeholder for routes owned by later groups (C–F). It renders a real
 * shell page — never a 404 — with the item's label, hint, and which group will
 * fill it in, so the sitemap is fully navigable from day one.
 */
import { Note } from '@khal-os/ui';
import { useLocation } from 'react-router-dom';
import { SITEMAP, findNavItem } from '../app/sitemap';
import { PageShell } from '../components/PageShell';
import { T } from '../components/tokens';

export function PlaceholderPage() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const group = SITEMAP.find((g) => g.items.some((i) => i.path === pathname));

  return (
    <PageShell eyebrow={group?.title} title={item?.label ?? 'Not found'} description={item?.hint}>
      <Note type="default" label="Planned">
        This surface is scaffolded and reachable. Its resource page lands in a later group of the{' '}
        <code style={{ fontFamily: T.mono }}>omni-khal-ui</code> wish.
      </Note>
      <div style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>route: {pathname}</div>
    </PageShell>
  );
}
