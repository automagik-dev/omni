/**
 * Multitenancy feature flag (wish: omni-full-multitenancy, Group G1).
 *
 * The entire tenant control plane is OFF by default. It is enabled ONLY when
 * `OMNI_MULTITENANCY_ENABLED` is the exact string `"true"`. Any other value
 * (unset, empty, `"1"`, `"TRUE"`, `"yes"`) leaves the legacy route/auth
 * behavior completely intact and exposes no new control-plane surface.
 *
 * Read the environment on every call rather than caching a boolean at module
 * load so tests can toggle it deterministically without import-order coupling.
 */

export const MULTITENANCY_FLAG_ENV = 'OMNI_MULTITENANCY_ENABLED';

export function isMultitenancyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MULTITENANCY_FLAG_ENV] === 'true';
}

// Slice flags have one decision point; callers never read these env vars directly.
const PAIRED_AGENT_FLAG_ENV = { consumers: 'OMNI_PAIRED_AGENT_CONSUMERS' } as const;

type PairedAgentFlagState = {
  slice: 'consumers';
  flag: 'OMNI_PAIRED_AGENT_CONSUMERS';
} & ({ enabled: true; reason: null } | { enabled: false; reason: 'flag_unset' | 'multitenancy_enabled' });

export function pairedAgentFlagState(slice: 'consumers', env: NodeJS.ProcessEnv = process.env): PairedAgentFlagState {
  const flag = PAIRED_AGENT_FLAG_ENV[slice];
  if (env[flag] !== 'true') return { slice, flag, enabled: false, reason: 'flag_unset' };
  if (isMultitenancyEnabled(env)) return { slice, flag, enabled: false, reason: 'multitenancy_enabled' };
  return { slice, flag, enabled: true, reason: null };
}
