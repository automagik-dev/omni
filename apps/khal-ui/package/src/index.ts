export { default as manifest } from './manifest';

// View entry (KHAL host loads this) + the app root it renders.
export { MainView } from './views/main/MainView';
export { OmniAdminApp } from './app/OmniAdminApp';
export type { OmniAdminAppProps } from './app/OmniAdminApp';

// Data layer.
export { createOmniAdminClient } from './api/client';
export { omniExt } from './api/ext';
export type { OmniAdminClient } from './api/client';

// Providers, contexts, and hooks (consumed by later groups' pages).
export { OmniClientProvider, useOmniClient, QueryProvider, ScopeProvider, useScope } from './app/providers';
export type { OmniClientContextValue, OmniClientProviderProps, ScopeContextValue } from './app/providers';
export {
  useDiag,
  useIncrementalPoll,
  useOmniMutation,
  useOmniQuery,
  useSse,
  mergeById,
  SseConnection,
} from './hooks';
export type {
  DiagResult,
  UseDiagResult,
  UseIncrementalPollOptions,
  UseIncrementalPollResult,
  UseSseOptions,
  UseSseResult,
  SseMessage,
  OmniMutationConfig,
  OmniMutationResult,
  EventSourceFactory,
  EventSourceLike,
  TimerHost,
} from './hooks';

// Sitemap (single source of truth for sidebar + routes).
export { SITEMAP, ALL_NAV_ITEMS, findNavItem } from './app/sitemap';
export type { NavGroup, NavItem, IconKey } from './app/sitemap';

// Shared primitives.
export * from './components';

// Capability inventory.
export type { Capability, CapabilityInventory } from './capabilities';
export { capabilities, capabilityInventory } from './capabilities';
