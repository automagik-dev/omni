/**
 * Canonical pgserve helpers — single shared pgserve@^2.1.0 backbone.
 *
 * Background
 * ----------
 * Up through omni 2.260430, omni-api spawned its own embedded pgserve
 * via `await import('pgserve')`. That worked, but every other service
 * (genie-serve, future agents) that wanted Postgres span its own copy,
 * so a single host could end up with 3+ pgserve instances on different
 * ports with scattered data dirs. Canonical pgserve fixes this:
 *
 *   - `pgserve install` (from pgserve@^2.1.0) registers ONE pm2-supervised
 *     pgserve instance on the canonical port (8432).
 *   - `pgserve url` returns its connection string — every downstream
 *     service (omni, genie, ...) reads this and connects there.
 *   - `omni install` calls `pgserve install` first, writes the URL into
 *     `~/.omni/config.json`, and starts omni-api with `PGSERVE_EMBEDDED=false`
 *     so the API skips its own embedded boot path.
 *
 * Embedded mode is NOT removed. It stays as the active path on existing
 * installs (where `serverConfig.useCanonicalPgserve` is undefined or
 * false) until the operator opts in via `omni doctor --fix`. Fresh
 * installs default to canonical.
 */

import { loadServerConfig } from '../config.js';
import * as output from '../output.js';

/**
 * Minimum pgserve binary version required for the canonical install
 * subcommands (`install`, `url`, `port`, `status`). Wave 1 of the
 * canonical-pgserve-pm2-supervision wish landed in 2.1.0; anything older
 * lacks the install command.
 */
export const PGSERVE_REQUIRED_VERSION = '^2.1.0';

/**
 * Probe `pgserve --version`. Returns true when the binary is callable.
 * Doesn't enforce the minimum version — `setupCanonicalPgserve` will
 * surface a clear error from `pgserve install` itself if the binary is
 * too old (it'll exit non-zero with "unknown command: install").
 */
export async function isPgserveInstalled(): Promise<boolean> {
  try {
    const code = await Bun.spawn({ cmd: ['pgserve', '--version'], stdout: 'pipe', stderr: 'pipe' }).exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Ensure the global `pgserve` binary is installed and on PATH. Best-effort:
 * - If already installed, return true immediately.
 * - Otherwise try `bun add -g pgserve@<PGSERVE_REQUIRED_VERSION>`.
 * - Returns false on failure (caller decides whether to fall back to
 *   embedded or fail hard).
 */
export async function ensurePgserveBinary(): Promise<boolean> {
  if (await isPgserveInstalled()) return true;
  output.raw(`  Installing pgserve@${PGSERVE_REQUIRED_VERSION} globally (bun add -g)...`);
  const installCode = await Bun.spawn({
    cmd: ['bun', 'add', '-g', `pgserve@${PGSERVE_REQUIRED_VERSION}`],
    stdout: 'inherit',
    stderr: 'inherit',
  }).exited;
  if (installCode !== 0) {
    output.warn(`bun add -g pgserve@${PGSERVE_REQUIRED_VERSION} exited with code ${installCode}`);
    return false;
  }
  // Re-probe — bun's global bin may not be on PATH yet for the running shell
  // but `pgserve --version` should still resolve via the absolute global path.
  return isPgserveInstalled();
}

/**
 * Run `pgserve install` (idempotent — exits 0 with "already installed"
 * on subsequent invocations). Returns true on success.
 */
async function runPgserveInstall(): Promise<boolean> {
  output.raw('  Registering canonical pgserve under pm2 (idempotent)...');
  const installCode = await Bun.spawn({ cmd: ['pgserve', 'install'], stdout: 'inherit', stderr: 'inherit' }).exited;
  if (installCode !== 0) {
    output.warn(`pgserve install exited with code ${installCode}`);
    return false;
  }
  return true;
}

/**
 * Read the canonical connection string via `pgserve url`. Returns null
 * when the call fails or the output isn't a postgres URL.
 */
async function readPgserveUrl(): Promise<string | null> {
  const proc = Bun.spawn({ cmd: ['pgserve', 'url'], stdout: 'pipe', stderr: 'inherit' });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    output.warn(`pgserve url exited with code ${code}`);
    return null;
  }
  const url = stdout.trim();
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    output.warn(`pgserve url returned unexpected output ("${url}")`);
    return null;
  }
  return url;
}

/**
 * Full canonical pgserve setup: ensure binary → `pgserve install` → read
 * the canonical url. Returns the URL on success, null on any failure.
 *
 * The caller (omni install) writes this URL into serverConfig.databaseUrl
 * so omni-api connects there with `PGSERVE_EMBEDDED=false`.
 */
export async function setupCanonicalPgserve(): Promise<string | null> {
  if (!(await ensurePgserveBinary())) {
    output.warn('Canonical pgserve binary unavailable — install manually: bun add -g pgserve@^2.1.0');
    return null;
  }
  if (!(await runPgserveInstall())) return null;
  return readPgserveUrl();
}

/**
 * Decide whether an install run should use canonical pgserve and, when yes,
 * mutate `cfg.databaseUrl` to the canonical url.
 *
 * Semantics:
 *   - Fresh install → ALWAYS canonical (auto-installs `pgserve` globally
 *     when missing, runs `pgserve install`, reads `pgserve url`). If
 *     canonical setup completely fails, falls back to embedded with a warn
 *     — the install still completes.
 *   - Reinstall → preserves the operator's existing
 *     `serverConfig.useCanonicalPgserve`. If `true`, re-runs setup
 *     (idempotent) to refresh the canonical url. If `false`/undefined,
 *     leaves embedded mode alone — operator migrates via `omni doctor --fix`.
 */
export async function resolveCanonicalPgservePreference(
  isReinstall: boolean,
  cfg: { databaseUrl: string },
): Promise<boolean> {
  if (isReinstall) {
    const existing = loadServerConfig().useCanonicalPgserve === true;
    if (!existing) return false;
    output.raw('  Canonical pgserve mode (preserved from previous install)');
    const url = await setupCanonicalPgserve();
    if (!url) {
      output.warn('Canonical pgserve refresh failed — keeping previous databaseUrl.');
      return true;
    }
    cfg.databaseUrl = url;
    output.raw(`    ✓ omni-api will connect to ${url}`);
    output.raw('');
    return true;
  }
  output.raw('  Canonical pgserve mode (default for new installs)');
  const url = await setupCanonicalPgserve();
  if (!url) {
    output.warn(
      'Canonical pgserve setup did not complete — falling back to embedded pgserve. Run `omni doctor --fix` later to migrate.',
    );
    output.raw('');
    return false;
  }
  cfg.databaseUrl = url;
  output.raw(`    ✓ omni-api will connect to ${url}`);
  output.raw('    ✓ embedded pgserve will be skipped (PGSERVE_EMBEDDED=false)');
  output.raw('');
  return true;
}
