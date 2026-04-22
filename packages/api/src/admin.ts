/**
 * Admin-only entry point consumed by the CLI for TTY-gated admin key
 * minting. The HTTP `POST /keys` route refuses `profile: 'admin'`
 * unconditionally — admin keys are only reachable through this surface,
 * which the CLI calls directly after an interactive `I UNDERSTAND`
 * confirmation. No server-side code imports this module.
 */

export { ApiKeyService } from './services/api-keys';
export type { CreateApiKeyOptions, CreateApiKeyResult, ValidatedApiKey } from './services/api-keys';
export { PROFILES, COWORKER_DEFAULT_DENYLIST_PRESET_KEY } from './constants/profiles';
export type { ProfileName, ProfileTemplate, LockRequirement, ProfileOverrides } from './constants/profiles';
export { resolveProfile, ProfileResolutionError } from './lib/resolve-profile';
export type { ResolveProfileInput, ResolvedProfileColumns } from './lib/resolve-profile';
export { verbsToScopes } from './lib/verbs-to-scopes';

// Re-export DB factory so the CLI admin path can mint keys directly without
// pulling @omni/db as a separate dependency.
export { createDb, closeDb } from '@omni/db';
export type { Database } from '@omni/db';
