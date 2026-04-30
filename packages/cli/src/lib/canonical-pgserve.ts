/**
 * Canonical pgserve setup — Wave 3 of the canonical-pgserve-pm2-supervision
 * wish (pgserve#55). Extracted from `commands/install.ts` to keep that
 * file under the 400-line target.
 *
 * Used only by `omni install --canonical-pgserve`. Probes the global
 * `pgserve` binary, runs `pgserve install` (idempotent), and reads
 * `pgserve url` to discover the canonical connection string. Returns
 * null on any failure so the caller can fall back to embedded pgserve
 * with a warning instead of breaking the install.
 */

import * as output from '../output.js';

/**
 * Probe + register canonical pgserve under pm2 + return its URL.
 * Returns null when pgserve isn't installed globally OR when one of
 * the probe/install/url calls fails — caller falls back to embedded.
 */
export async function setupCanonicalPgserve(): Promise<string | null> {
  if (!(await isPgserveInstalled())) {
    output.warn(
      '`pgserve` binary not found in PATH. Install with: bun add -g pgserve  (then re-run `omni install --canonical-pgserve`)',
    );
    return null;
  }

  output.raw('  Registering canonical pgserve under pm2 (idempotent)...');
  const installCode = await Bun.spawn({ cmd: ['pgserve', 'install'], stdout: 'inherit', stderr: 'inherit' }).exited;
  if (installCode !== 0) {
    output.warn(`pgserve install exited with code ${installCode} — falling back to embedded pgserve`);
    return null;
  }

  // Read the canonical URL via the discovery API. Caller writes this into
  // serverConfig.databaseUrl so omni-api connects there.
  const urlProc = Bun.spawn({ cmd: ['pgserve', 'url'], stdout: 'pipe', stderr: 'inherit' });
  const stdout = await new Response(urlProc.stdout).text();
  const urlCode = await urlProc.exited;
  if (urlCode !== 0) {
    output.warn(`pgserve url exited with code ${urlCode} — falling back to embedded pgserve`);
    return null;
  }
  const url = stdout.trim();
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    output.warn(`pgserve url returned unexpected output ("${url}") — falling back to embedded pgserve`);
    return null;
  }
  return url;
}

async function isPgserveInstalled(): Promise<boolean> {
  try {
    const code = await Bun.spawn({ cmd: ['pgserve', '--version'], stdout: 'pipe', stderr: 'pipe' }).exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Convenience wrapper used by `omni install`. When the operator passed
 * `--canonical-pgserve`, mutates `cfg.databaseUrl` to the canonical url
 * (on success) and returns true so the caller can pass `useCanonicalPgserve:
 * true` to `buildRuntimeEnv`. Returns false when the operator didn't pass
 * the flag OR when canonical setup failed and we're falling back to embedded.
 */
export async function maybeSwitchToCanonicalPgserve(
  options: { canonicalPgserve?: boolean },
  cfg: { databaseUrl: string },
): Promise<boolean> {
  if (options.canonicalPgserve !== true) return false;
  output.raw('  Canonical pgserve mode (--canonical-pgserve)');
  const url = await setupCanonicalPgserve();
  if (!url) {
    output.warn('Canonical pgserve setup did not complete — proceeding with embedded pgserve.');
    output.raw('');
    return false;
  }
  cfg.databaseUrl = url;
  output.raw(`    ✓ omni-api will connect to ${url}`);
  output.raw('    ✓ embedded pgserve will be skipped (PGSERVE_EMBEDDED=false)');
  output.raw('');
  return true;
}
