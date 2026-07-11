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
import { AgentDetailPage } from '../pages/agents/AgentDetailPage';
import { AgentsListPage } from '../pages/agents/AgentsListPage';
import { AutomationDetailPage } from '../pages/automations/AutomationDetailPage';
import { AutomationsListPage } from '../pages/automations/AutomationsListPage';
import { BatchJobDetailPage } from '../pages/batch-jobs/BatchJobDetailPage';
import { BatchJobsListPage } from '../pages/batch-jobs/BatchJobsListPage';
import { ChatPage } from '../pages/chat/ChatPage';
import { AgentStatePage } from '../pages/dev/AgentStatePage';
import { CapabilitiesPage } from '../pages/dev/CapabilitiesPage';
import { ActivityPage } from '../pages/home/ActivityPage';
import { HealthPage } from '../pages/home/HealthPage';
import { OverviewPage } from '../pages/home/OverviewPage';
import { InstanceDetailPage } from '../pages/instances/InstanceDetailPage';
import { InstancesListPage } from '../pages/instances/InstancesListPage';
import { ProviderDetailPage } from '../pages/providers/ProviderDetailPage';
import { ProvidersListPage } from '../pages/providers/ProvidersListPage';
import { RoutingPage } from '../pages/routing/RoutingPage';
import { AppShell } from './AppShell';
import { ALL_NAV_ITEMS } from './sitemap';

/** Paths shipped as real, live pages. Everything else is a placeholder. */
const LIVE_PAGES: Record<string, ComponentType> = {
  '/': OverviewPage,
  '/health': HealthPage,
  '/activity': ActivityPage,
  '/chat': ChatPage,
  '/instances': InstancesListPage,
  '/agents': AgentsListPage,
  '/providers': ProvidersListPage,
  '/automations': AutomationsListPage,
  '/batch-jobs': BatchJobsListPage,
  '/routing': RoutingPage,
  '/dev/capabilities': CapabilitiesPage,
};

/** Detail routes not present in the sitemap (param routes, sub-pages). */
const EXTRA_ROUTES: RouteObject[] = [
  { path: 'instances/:id', element: <InstanceDetailPage /> },
  { path: 'agents/:id', element: <AgentDetailPage /> },
  { path: 'providers/:id', element: <ProviderDetailPage /> },
  { path: 'automations/:id', element: <AutomationDetailPage /> },
  { path: 'batch-jobs/:id', element: <BatchJobDetailPage /> },
  { path: 'dev/agent-state', element: <AgentStatePage /> },
];

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
    children: [...childRoutes(), ...EXTRA_ROUTES, { path: '*', element: <PlaceholderPage /> }],
  },
];
