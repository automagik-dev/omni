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
import { A2APage } from '../pages/resources/A2APage';
import { AccessRulesPage } from '../pages/resources/AccessRulesPage';
import { ApiInfoPage } from '../pages/resources/ApiInfoPage';
import { ApiKeysPage } from '../pages/resources/ApiKeysPage';
import { ContactsPage } from '../pages/resources/ContactsPage';
import { ContextPage } from '../pages/resources/ContextPage';
import { ConversationsPage } from '../pages/resources/ConversationsPage';
import { DeadLettersPage } from '../pages/resources/DeadLettersPage';
import { EventOpsPage } from '../pages/resources/EventOpsPage';
import { EventsPage } from '../pages/resources/EventsPage';
import { GroupsPage } from '../pages/resources/GroupsPage';
import { HandoffsPage } from '../pages/resources/HandoffsPage';
import { JourneysPage } from '../pages/resources/JourneysPage';
import { LogsPage } from '../pages/resources/LogsPage';
import { MediaConsolePage } from '../pages/resources/MediaConsolePage';
import { MetricsPage } from '../pages/resources/MetricsPage';
import { PayloadConfigPage } from '../pages/resources/PayloadConfigPage';
import { PersonsPage } from '../pages/resources/PersonsPage';
import { SettingsPage } from '../pages/resources/SettingsPage';
import { TrustHostsPage } from '../pages/resources/TrustHostsPage';
import { TtsVoicesPage } from '../pages/resources/TtsVoicesPage';
import { TurnsPage } from '../pages/resources/TurnsPage';
import { VoicePage } from '../pages/resources/VoicePage';
import { WebhookSourcesPage } from '../pages/resources/WebhookSourcesPage';
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
  // Group F — horizontal coverage (messaging, operations, configuration, access).
  '/conversations': ConversationsPage,
  '/persons': PersonsPage,
  '/contacts': ContactsPage,
  '/groups': GroupsPage,
  '/journeys': JourneysPage,
  '/voice': VoicePage,
  '/webhook-sources': WebhookSourcesPage,
  '/access-rules': AccessRulesPage,
  '/events': EventsPage,
  '/event-ops': EventOpsPage,
  '/dead-letters': DeadLettersPage,
  '/logs': LogsPage,
  '/metrics': MetricsPage,
  '/settings': SettingsPage,
  '/payload-config': PayloadConfigPage,
  '/tts-voices': TtsVoicesPage,
  '/api-keys': ApiKeysPage,
  '/trust-hosts': TrustHostsPage,
  '/media-console': MediaConsolePage,
  '/turns': TurnsPage,
  '/context': ContextPage,
  '/handoffs': HandoffsPage,
  '/a2a': A2APage,
  '/api-info': ApiInfoPage,
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
