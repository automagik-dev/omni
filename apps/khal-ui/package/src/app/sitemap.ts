/**
 * The Omni Admin sitemap — the single source of truth for both the sidebar and
 * the router. Six groups mirror the operator's mental model. Every item is a
 * real route: Group B ships the Home group (and a live capabilities view) as
 * working pages; Groups C–F replace the `placeholder` items with resource pages.
 *
 * Kept as pure data (icon is a key into `@khal-os/ui`'s `Icons`, resolved in the
 * Sidebar) so the route table and coverage tests can import it without React.
 */

export type IconKey = 'Sparkles' | 'Note' | 'Genie' | 'Link' | 'Logs' | 'Cog' | 'Store' | 'Cloud' | 'Search' | 'Bell';

export interface NavItem {
  /** Route path, always leading-slash absolute (e.g. `/health`). */
  path: string;
  /** Sidebar label and default page title. */
  label: string;
  /** One-line description shown on placeholder pages. */
  hint?: string;
  /** True when Group B ships a real, live page (vs a titled placeholder). */
  live?: boolean;
}

export interface NavGroup {
  id: string;
  title: string;
  icon: IconKey;
  items: NavItem[];
}

export const SITEMAP: NavGroup[] = [
  {
    id: 'home',
    title: 'Home',
    icon: 'Sparkles',
    items: [
      { path: '/', label: 'Overview', live: true, hint: 'Instance states, system health, and event volume.' },
      {
        path: '/health',
        label: 'Health & Incidents',
        live: true,
        hint: 'BFF, backend, consumer lag, and dead letters.',
      },
      { path: '/activity', label: 'Activity', live: true, hint: 'Recent events feed, polled live.' },
    ],
  },
  {
    id: 'messaging',
    title: 'Messaging',
    icon: 'Note',
    items: [
      { path: '/chat', label: 'Chat', hint: 'Live agent console for a conversation.' },
      { path: '/conversations', label: 'Conversations', hint: 'Browse and filter chats.' },
      { path: '/persons', label: 'Persons', hint: 'Identity graph across channels.' },
      { path: '/contacts', label: 'Contacts', hint: 'Per-instance address book.' },
      { path: '/groups', label: 'Groups', hint: 'Group chats and membership.' },
      { path: '/journeys', label: 'Journeys', hint: 'Follow-up and re-engagement flows.' },
      { path: '/voice', label: 'Voice', hint: 'Voice notes and TTS delivery.' },
    ],
  },
  {
    id: 'agents',
    title: 'Agents & Automation',
    icon: 'Genie',
    items: [
      { path: '/agents', label: 'Agents', hint: 'Agent bindings and state.' },
      { path: '/providers', label: 'Providers', hint: 'Agent provider configuration and health.' },
      { path: '/automations', label: 'Automations', hint: 'Event-driven workflows.' },
      { path: '/batch-jobs', label: 'Batch Jobs', hint: 'Transcription and extraction batches.' },
    ],
  },
  {
    id: 'channels',
    title: 'Channels & Access',
    icon: 'Link',
    items: [
      { path: '/instances', label: 'Instances', hint: 'Channel instances and connection status.' },
      { path: '/webhook-sources', label: 'Webhook Sources', hint: 'Inbound webhook registrations.' },
      { path: '/access-rules', label: 'Access Rules', hint: 'Allow/deny routing policy.' },
      { path: '/routing', label: 'Routing', hint: 'How messages map to agents.' },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    icon: 'Logs',
    items: [
      { path: '/events', label: 'Events', hint: 'Event stream browser.' },
      { path: '/event-ops', label: 'Event Ops', hint: 'Replay and reprocessing.' },
      { path: '/dead-letters', label: 'Dead Letters', hint: 'Failed events and resolution.' },
      { path: '/logs', label: 'Logs', hint: 'Live log stream.' },
      { path: '/metrics', label: 'Metrics', hint: 'Volume and latency analytics.' },
    ],
  },
  {
    id: 'configuration',
    title: 'Configuration',
    icon: 'Cog',
    items: [
      { path: '/settings', label: 'Settings', hint: 'Platform settings.' },
      { path: '/payload-config', label: 'Payload Config', hint: 'Per-channel payload shaping.' },
      { path: '/tts-voices', label: 'TTS Voices', hint: 'Voice catalog and defaults.' },
      { path: '/api-keys', label: 'API Keys', hint: 'Key management and scopes.' },
      { path: '/trust-hosts', label: 'Trust Hosts', hint: 'A2A trust handshake registry.' },
      { path: '/media-console', label: 'Media Console', hint: 'Media store inspection.' },
      { path: '/turns', label: 'Turns', hint: 'Turn admin and stats.' },
      { path: '/context', label: 'Context', hint: 'Conversation context retrieval.' },
      { path: '/handoffs', label: 'Handoffs', hint: 'Agent-to-agent handoff records.' },
      { path: '/a2a', label: 'A2A', hint: 'Agent-to-agent discovery.' },
      { path: '/api-info', label: 'API Info', hint: 'Backend version and capabilities.' },
      { path: '/dev/capabilities', label: 'Capabilities', live: true, hint: 'Capability inventory coverage.' },
    ],
  },
];

/** Flattened list of every navigable item, in sidebar order. */
export const ALL_NAV_ITEMS: NavItem[] = SITEMAP.flatMap((group) => group.items);

/** Look up a nav item by its route path. */
export function findNavItem(path: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => item.path === path);
}
