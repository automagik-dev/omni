/**
 * Route table, derived from {@link SITEMAP} so the sidebar and the router can
 * never drift. Home routes (and the capabilities view) resolve to real pages;
 * every other sitemap item resolves to a titled {@link PlaceholderPage} — so all
 * routes render a shell page and there are no 404s. A trailing catch-all keeps
 * unknown paths on a titled page too.
 */
import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { CapabilitiesPage } from '../pages/dev/CapabilitiesPage';
import { ActivityPage } from '../pages/home/ActivityPage';
import { HealthPage } from '../pages/home/HealthPage';
import { OverviewPage } from '../pages/home/OverviewPage';
import { AppShell } from './AppShell';
import { ALL_NAV_ITEMS } from './sitemap';

/** Paths Group B ships as real, live pages. Everything else is a placeholder. */
const LIVE_PAGES: Record<string, ComponentType> = {
  '/': OverviewPage,
  '/health': HealthPage,
  '/activity': ActivityPage,
  '/dev/capabilities': CapabilitiesPage,
};

function childRoutes(): RouteObject[] {
  return ALL_NAV_ITEMS.map((item) => {
    const Component = LIVE_PAGES[item.path] ?? PlaceholderPage;
    if (item.path === '/') return { index: true, element: <Component /> };
    return { path: item.path.replace(/^\//, ''), element: <Component /> };
  });
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [...childRoutes(), { path: '*', element: <PlaceholderPage /> }],
  },
];
