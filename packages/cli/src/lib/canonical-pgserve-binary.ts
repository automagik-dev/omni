/**
 * Canonical pgserve binary resolver — mirror of the genie-side resolver
 * shipped in genie@4.260520.3 (`src/lib/canonical-pgserve-binary.ts`).
 *
 * Background
 * ----------
 * The autopg-distribution-cutover-finalize wish (autopg repo) renamed the
 * published v3 binary from `pgserve` to `autopg`. Both binaries expose an
 * identical command surface (`install`, `port`, `url`, `status`, `restart`);
 * only the on-disk name differs. Every omni consumer that historically
 * hardcoded `'pgserve'` in a spawn arg now routes through this resolver
 * so v3-only hosts (which have `autopg` on PATH but no `pgserve`) succeed
 * instead of falling out as "binary unavailable".
 *
 * Resolution policy
 * -----------------
 *   - Prefer `autopg` (v3 canonical) when present.
 *   - Fall back to `pgserve` (v2 legacy) for cutover hosts.
 *   - Return null when neither is on PATH — caller surfaces the canonical
 *     install hint via {@link canonicalPgserveInstallHint}.
 *
 * Lifecycle
 * ---------
 *   - Memoized; cached value persists for the process lifetime.
 */

import { execFileSync } from 'node:child_process';

const CANONICAL_PGSERVE_BINARY = 'autopg';
const LEGACY_PGSERVE_BINARY = 'pgserve';

let cached: string | null | undefined;

function which(cmd: string): string | null {
  try {
    const result = execFileSync('which', [cmd], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical pgserve binary on this host. Memoized.
 */
export function resolvePgserveBinary(): string | null {
  if (cached !== undefined) return cached;
  if (which(CANONICAL_PGSERVE_BINARY)) {
    cached = CANONICAL_PGSERVE_BINARY;
    return cached;
  }
  if (which(LEGACY_PGSERVE_BINARY)) {
    cached = LEGACY_PGSERVE_BINARY;
    return cached;
  }
  cached = null;
  return cached;
}

/**
 * Copy-paste recovery commands for the "binary not found" path. Points
 * at the autopg v3 installer; ordered so the operator runs them
 * top-to-bottom.
 */
export function canonicalPgserveInstallHint(): string[] {
  return [
    '  curl -fsSL https://raw.githubusercontent.com/automagik-dev/autopg/main/install.sh | bash',
    '  omni install     # OR: omni doctor --fix',
  ];
}
