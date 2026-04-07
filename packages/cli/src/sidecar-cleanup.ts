/**
 * NATS Reply Sidecar Cleanup
 *
 * Detects and stops the legacy `nats-reply-sidecar.mjs` process during
 * `omni update`. The sidecar was an external workaround for two bugs in
 * `NatsGenieProvider` that were fixed in automagik-dev/omni#362:
 *
 *   1. The in-process subscription used `omni.reply.{instance}.*`, a
 *      single-token wildcard that silently missed every WhatsApp reply
 *      because WhatsApp chat_ids contain dots (e.g.
 *      `5511999999999@s.whatsapp.net`). The sidecar masked this in
 *      production by using the recursive wildcard `omni.reply.>`.
 *   2. `NatsGenieProvider.resetSession()` was missing, so session reset
 *      events were silently dropped for NATS providers.
 *
 * After the upgrade, the in-process provider handles every reply directly.
 * Leaving the sidecar running causes every agent reply to be delivered
 * twice (once by the sidecar, once by the in-process subscription).
 *
 * This module handles two deployment shapes:
 *   - PM2-managed: a process whose name contains `nats-reply-sidecar` OR
 *     whose script path ends in `nats-reply-sidecar.mjs`. We `stop` and
 *     `delete` it.
 *   - Raw / systemd / nohup: a node process whose argv contains
 *     `nats-reply-sidecar.mjs`. We send SIGTERM and let it exit.
 *
 * Detection is best-effort: if neither pm2 nor pgrep is available we
 * silently report "no sidecars found" — the operator can still stop the
 * sidecar manually using the runbook at
 * `docs/migration/nats-genie-sidecar-decommission.md`.
 */

const SIDECAR_BASENAME = 'nats-reply-sidecar.mjs';
const SIDECAR_NAME_HINT = 'nats-reply-sidecar';

// ============================================================================
// Types
// ============================================================================

/** A pm2-managed sidecar process eligible for cleanup. */
export interface Pm2SidecarMatch {
  /** PM2 process name (used by `pm2 stop <name>`) */
  name: string;
  /** Numeric PM2 id (used as a fallback when name is empty) */
  pmId: number | null;
  /** Resolved script path, when pm2 reports it. Empty string if missing. */
  scriptPath: string;
  /** Whether the match was found by name hint or by script path. */
  matchedBy: 'name' | 'script-path';
}

/** A raw (non-pm2) sidecar process eligible for cleanup. */
export interface RawSidecarMatch {
  pid: number;
  /** The full command line as reported by `ps`/`pgrep -fa`. */
  command: string;
}

/** Result of an attempted cleanup operation. */
export interface CleanupResult {
  /** PM2 sidecars discovered (regardless of stop outcome) */
  pm2Detected: Pm2SidecarMatch[];
  /** Raw sidecars discovered (regardless of kill outcome) */
  rawDetected: RawSidecarMatch[];
  /** PM2 sidecars successfully stopped+deleted */
  pm2Stopped: Pm2SidecarMatch[];
  /** PM2 sidecars that failed to stop (caller should warn) */
  pm2Failed: Pm2SidecarMatch[];
  /** Raw sidecars successfully signalled */
  rawKilled: RawSidecarMatch[];
  /** Raw sidecars that failed to be signalled */
  rawFailed: RawSidecarMatch[];
}

/** Shape of a single entry in `pm2 jlist` we care about. */
interface Pm2JListEntry {
  name?: string;
  pm_id?: number;
  pm2_env?: {
    pm_exec_path?: string;
    status?: string;
  };
}

// ============================================================================
// Pure parsers (testable without spawning anything)
// ============================================================================

/**
 * Parse the raw stdout of `pm2 jlist` and return any entries that look like
 * the legacy nats-reply-sidecar. Pure function — no side effects.
 *
 * Matches an entry when EITHER:
 *   - the process name contains `nats-reply-sidecar`, OR
 *   - the script path basename equals `nats-reply-sidecar.mjs`
 *
 * The script-path match is the load-bearing one: an operator may have
 * named the pm2 process `my-bot-sidecar` while still pointing it at the
 * legacy script.
 */
/** Extract a single pm2 entry into a sidecar match, or null when it doesn't match. */
function pm2EntryToMatch(entry: Pm2JListEntry | null | undefined): Pm2SidecarMatch | null {
  if (!entry || typeof entry !== 'object') return null;

  const name = typeof entry.name === 'string' ? entry.name : '';
  const scriptPath = typeof entry.pm2_env?.pm_exec_path === 'string' ? entry.pm2_env.pm_exec_path : '';
  const pmId = typeof entry.pm_id === 'number' ? entry.pm_id : null;

  const nameMatch = name.includes(SIDECAR_NAME_HINT);
  const pathMatch = scriptPath.endsWith(`/${SIDECAR_BASENAME}`) || scriptPath.endsWith(SIDECAR_BASENAME);
  if (!nameMatch && !pathMatch) return null;

  return {
    name,
    pmId,
    scriptPath,
    matchedBy: nameMatch ? 'name' : 'script-path',
  };
}

export function parsePm2SidecarMatches(rawJson: string): Pm2SidecarMatch[] {
  const trimmed = rawJson.trim();
  if (trimmed.length === 0 || trimmed === '[]') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const matches: Pm2SidecarMatch[] = [];
  for (const entry of parsed as Pm2JListEntry[]) {
    const match = pm2EntryToMatch(entry);
    if (match !== null) matches.push(match);
  }
  return matches;
}

/**
 * Parse the raw stdout of `pgrep -fa nats-reply-sidecar.mjs`. Each line has
 * the form `<pid> <full command line>`. Lines with no parseable pid are
 * skipped silently. Pure function.
 */
export function parseRawSidecarMatches(rawPgrep: string): RawSidecarMatch[] {
  const lines = rawPgrep.split('\n');
  const matches: RawSidecarMatch[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // pgrep -fa output: "12345 node /path/to/nats-reply-sidecar.mjs"
    const firstSpace = trimmed.indexOf(' ');
    if (firstSpace === -1) continue;
    const pidStr = trimmed.slice(0, firstSpace);
    const command = trimmed.slice(firstSpace + 1);
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (!command.includes(SIDECAR_BASENAME)) continue;

    matches.push({ pid, command });
  }
  return matches;
}

// ============================================================================
// Detection (impure — spawns subprocesses)
// ============================================================================

/**
 * List pm2-managed sidecar processes by shelling out to `pm2 jlist`.
 * Returns `[]` when pm2 is not installed, jlist fails, or nothing matches.
 *
 * Internal — orchestrated by `cleanupSidecars()`. Not exported because the
 * subprocess-spawning paths aren't unit-tested (mocking `Bun.spawn` against
 * the real CLI runtime is more brittle than it's worth — the pure parsers
 * are the load-bearing logic).
 */
async function detectPm2Sidecars(): Promise<Pm2SidecarMatch[]> {
  try {
    const proc = Bun.spawn({
      cmd: ['pm2', 'jlist'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (exitCode !== 0) return [];
    return parsePm2SidecarMatches(stdout);
  } catch {
    return [];
  }
}

/**
 * List non-pm2 sidecar processes via `pgrep -fa nats-reply-sidecar.mjs`.
 * Returns `[]` when pgrep is not installed or nothing matches.
 *
 * We exclude our own pid defensively, in case the cleanup code path is
 * ever invoked from a process whose argv mentions the sidecar (e.g. a
 * test harness).
 */
async function detectRawSidecars(): Promise<RawSidecarMatch[]> {
  try {
    const proc = Bun.spawn({
      cmd: ['pgrep', '-fa', SIDECAR_BASENAME],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    // pgrep exit code 1 = no matches; treat as success-with-empty.
    if (exitCode !== 0 && exitCode !== 1) return [];
    const matches = parseRawSidecarMatches(stdout);
    const ownPid = process.pid;
    return matches.filter((m) => m.pid !== ownPid);
  } catch {
    return [];
  }
}

// ============================================================================
// Stopping (impure — spawns subprocesses)
// ============================================================================

/**
 * Stop and delete a single pm2 process. Prefers the name; falls back to
 * the numeric pm_id if name is empty. Returns true on success.
 */
async function stopPm2Sidecar(match: Pm2SidecarMatch): Promise<boolean> {
  const target = match.name.length > 0 ? match.name : match.pmId !== null ? String(match.pmId) : null;
  if (target === null) return false;

  // pm2 stop + delete must both succeed for cleanup to be considered done.
  // We deliberately do NOT use `pm2 delete` alone — operators expect a
  // graceful stop signal first so the sidecar can drain in-flight replies.
  for (const verb of ['stop', 'delete']) {
    const proc = Bun.spawn({
      cmd: ['pm2', verb, target],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return false;
  }
  return true;
}

/**
 * Send SIGTERM to a raw sidecar process. Returns true on success.
 *
 * We deliberately use SIGTERM (not SIGKILL) so the sidecar can drain its
 * NATS subscription and exit cleanly. The caller decides whether to wait
 * for the process to actually exit — for `omni update` we don't bother
 * because the new in-process subscription has already taken over by the
 * time this runs.
 */
async function killRawSidecar(match: RawSidecarMatch): Promise<boolean> {
  try {
    process.kill(match.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// High-level orchestration
// ============================================================================

/**
 * Detect and stop every sidecar we can find. Never throws — always returns
 * a result describing what was discovered and what was stopped. The caller
 * decides how to render the outcome and whether to exit non-zero.
 */
export async function cleanupSidecars(): Promise<CleanupResult> {
  const [pm2Detected, rawDetected] = await Promise.all([detectPm2Sidecars(), detectRawSidecars()]);

  const pm2Stopped: Pm2SidecarMatch[] = [];
  const pm2Failed: Pm2SidecarMatch[] = [];
  for (const match of pm2Detected) {
    const ok = await stopPm2Sidecar(match);
    if (ok) {
      pm2Stopped.push(match);
    } else {
      pm2Failed.push(match);
    }
  }

  const rawKilled: RawSidecarMatch[] = [];
  const rawFailed: RawSidecarMatch[] = [];
  for (const match of rawDetected) {
    const ok = await killRawSidecar(match);
    if (ok) {
      rawKilled.push(match);
    } else {
      rawFailed.push(match);
    }
  }

  return {
    pm2Detected,
    rawDetected,
    pm2Stopped,
    pm2Failed,
    rawKilled,
    rawFailed,
  };
}

/**
 * Format a `CleanupResult` as a multi-line summary suitable for printing
 * to the operator. Pure function — no console writes here. Returns an
 * empty string when nothing was detected so the caller can suppress
 * the section entirely.
 */
export function formatCleanupSummary(result: CleanupResult): string {
  const totalDetected = result.pm2Detected.length + result.rawDetected.length;
  if (totalDetected === 0) return '';

  const lines: string[] = [];
  lines.push(`Found ${totalDetected} legacy nats-reply-sidecar process(es) — stopping to prevent duplicate replies.`);

  for (const match of result.pm2Stopped) {
    const label = match.name || `pm_id=${match.pmId}`;
    lines.push(`  ✓ pm2: stopped and deleted "${label}" (matched by ${match.matchedBy})`);
  }
  for (const match of result.pm2Failed) {
    const label = match.name || `pm_id=${match.pmId}`;
    lines.push(`  ✗ pm2: failed to stop "${label}" — run \`pm2 stop ${label} && pm2 delete ${label}\` manually`);
  }
  for (const match of result.rawKilled) {
    lines.push(`  ✓ raw: SIGTERM sent to pid ${match.pid}`);
  }
  for (const match of result.rawFailed) {
    lines.push(`  ✗ raw: failed to signal pid ${match.pid} — kill it manually with \`kill ${match.pid}\``);
  }

  if (result.pm2Failed.length > 0 || result.rawFailed.length > 0) {
    lines.push('See docs/migration/nats-genie-sidecar-decommission.md for the manual cleanup runbook.');
  }

  return lines.join('\n');
}

/** Whether the cleanup result represents a fully-successful run. */
export function cleanupSucceeded(result: CleanupResult): boolean {
  return result.pm2Failed.length === 0 && result.rawFailed.length === 0;
}
