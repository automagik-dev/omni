/**
 * Compile-time peer requirements manifest.
 *
 * Declares the minimum versions of peer CLIs (pgserve, genie) that omni
 * is verified to work with. Consumed by:
 *   - `omni requirements [--json]`              (this wish, G6)
 *   - `omni update` step 4 / `preInstallPeerCheck` (this wish, G4)
 *   - `omni doctor` peer-version check          (this wish, G5)
 *
 * The contract — see SHARED-DESIGN.md §3.3:
 *
 * > Each binary has `<cli> --requirements --json` returning
 * > `{ pgserve: ">=2.3", genie: ">=5.0" }` etc.
 *
 * Version specs use the npm-style `>=X.Y[.Z]` form. Only the lower bound
 * is enforced; upper bounds are not declared because the peers are
 * cooperating CLIs in the same release train (operator runs
 * `pgserve update` → `genie update` → `omni update`, so peers move
 * forward together). A peer below the lower bound refuses the upgrade
 * with an explicit remediation pointing at `<peer> update`.
 */

import { spawn } from 'node:child_process';

/**
 * Peer requirements declared at compile time.
 *
 * Keys:
 *   - `pgserve` — the singleton pgserve CLI. Version `2.3` introduced the
 *     canonical UDS + cosign tier surface this wish targets.
 *   - `genie` — peer agent runtime that shares the pgserve cluster. omni
 *     does not directly invoke genie at runtime, but they coexist on the
 *     same host and need to agree on the pgserve role-grant model.
 *
 * Adding a new peer: include both the version range and a `discover`
 * entry in {@link PEER_DISCOVERERS} so `checkPeerVersion()` can shell
 * out to fetch the live version. Discovery functions intentionally
 * shell-out (rather than import the peer) so a missing peer fails
 * gracefully without crashing the parent process.
 */
export const REQUIREMENTS: Readonly<Record<string, string>> = Object.freeze({
  pgserve: '>=2.3',
  genie: '>=5.0',
});

/** Peer name → CLI binary lookup. */
const PEER_BINARIES: Readonly<Record<string, string>> = Object.freeze({
  pgserve: 'pgserve',
  genie: 'genie',
});

/** Maximum time we'll wait for a peer's `--version` invocation (ms). */
const PEER_VERSION_TIMEOUT_MS = 5_000;

/**
 * Result of a single peer-version probe.
 *
 *   - `ok=true`  → peer is at or above the required version.
 *   - `ok=false` → peer is below the required version OR not installed.
 *     `current` is `null` when the peer binary is absent / errored out.
 *   - `current` is the raw version string parsed from `<peer> --version`.
 */
export interface PeerVersionResult {
  name: string;
  required: string;
  current: string | null;
  ok: boolean;
  /** Human-readable reason when `ok=false`. */
  reason?: string;
}

/**
 * Parse a semver-ish version triple from arbitrary CLI version output.
 *
 * Many CLIs emit lines like `pgserve 2.3.1`, `genie v5.0.0-rc.2`, or
 * `omni 2.260507.4`. We extract the first `MAJOR.MINOR[.PATCH]` triple,
 * tolerating leading prefixes (binary name, `v`) and trailing suffixes
 * (`-rc.N`, build metadata, hash). Returns null when no triple matches.
 */
export function parseVersionTriple(raw: string): { major: number; minor: number; patch: number } | null {
  // Match the FIRST occurrence of digit+ . digit+ ( . digit+ )? in the
  // input. Anchoring on whole-string would reject perfectly valid
  // outputs like `pgserve version 2.3.1\n` so we accept embedded form.
  const match = raw.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const major = Number.parseInt(match[1] ?? '', 10);
  const minor = Number.parseInt(match[2] ?? '', 10);
  const patch = match[3] !== undefined ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return { major, minor, patch };
}

/**
 * Parse a `>=X.Y[.Z]` constraint into a version triple.
 *
 * Throws on malformed input — REQUIREMENTS is compile-time and any
 * malformed entry is a programmer error. Released code never sees a
 * malformed constraint at runtime.
 */
export function parseConstraint(spec: string): { major: number; minor: number; patch: number } {
  const trimmed = spec.trim();
  if (!trimmed.startsWith('>=')) {
    throw new Error(
      `Unsupported version constraint shape: "${spec}". Only \`>=X.Y[.Z]\` is supported by REQUIREMENTS.`,
    );
  }
  const triple = parseVersionTriple(trimmed.slice(2));
  if (!triple) {
    throw new Error(`Could not parse version triple from constraint: "${spec}"`);
  }
  return triple;
}

/**
 * Compare two version triples. Returns negative if a<b, 0 if equal,
 * positive if a>b. Stable across major/minor/patch.
 */
export function compareVersions(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Check a single concrete version string against a `>=` constraint.
 * Pure helper — no I/O.
 */
export function satisfiesConstraint(currentRaw: string, constraint: string): boolean {
  const current = parseVersionTriple(currentRaw);
  if (!current) return false;
  const required = parseConstraint(constraint);
  return compareVersions(current, required) >= 0;
}

/** Shell out to `<binary> --version` and capture stdout. */
function fetchPeerVersion(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const proc = spawn(binary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      resolve(null);
    }, PEER_VERSION_TIMEOUT_MS);
    timer.unref();

    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    proc.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        // Non-zero exit means the binary doesn't recognize `--version`.
        // Refuse to parse: when a CLI prints its help banner instead of
        // a version (live evidence: pgserve@2.2.4 — see SHARED-DESIGN.md
        // §5.1 listing `pgserve --version` as a v2.3 add), the banner
        // typically contains many digit-triples (port numbers, IP
        // defaults, doc-block versions) and any of them could leak in
        // as a false positive. The contract for callers is: null means
        // "could not determine"; the resulting PeerVersionResult.reason
        // includes the binary name + flag so operators can self-debug.
        resolve(null);
        return;
      }
      // Defensive: some CLIs emit `--version` on stderr (commander's own
      // built-in help/version output goes to stdout but custom programs
      // sometimes route to stderr). Prefer stdout, fall back to stderr.
      const out = stdout.trim();
      if (out.length > 0) {
        resolve(out);
        return;
      }
      const err = stderr.trim();
      resolve(err.length > 0 ? err : null);
    });
  });
}

/**
 * Probe a single declared peer. Returns a typed result that callers
 * (omni doctor, omni update preInstallPeerCheck) consume to decide
 * whether to proceed.
 *
 * `currentOverride` lets tests inject a known version without spawning
 * a child process. Production callers omit it and pay the shell-out.
 */
export async function checkPeerVersion(
  name: keyof typeof REQUIREMENTS | string,
  currentOverride?: string | null,
): Promise<PeerVersionResult> {
  const required = REQUIREMENTS[name];
  if (!required) {
    return {
      name,
      required: '',
      current: null,
      ok: false,
      reason: `Unknown peer: ${name}. Known peers: ${Object.keys(REQUIREMENTS).join(', ')}.`,
    };
  }
  const binary = PEER_BINARIES[name];
  const raw =
    currentOverride !== undefined ? currentOverride : binary !== undefined ? await fetchPeerVersion(binary) : null;
  if (raw === null) {
    return {
      name,
      required,
      current: null,
      ok: false,
      reason: `Peer "${name}" not installed or did not respond to \`${binary ?? name} --version\` within ${PEER_VERSION_TIMEOUT_MS}ms.`,
    };
  }
  const triple = parseVersionTriple(raw);
  if (!triple) {
    return {
      name,
      required,
      current: raw,
      ok: false,
      reason: `Could not parse version triple from \`${binary ?? name} --version\` output: ${JSON.stringify(raw)}.`,
    };
  }
  const ok = compareVersions(triple, parseConstraint(required)) >= 0;
  const currentString = `${triple.major}.${triple.minor}.${triple.patch}`;
  return {
    name,
    required,
    current: currentString,
    ok,
    reason: ok
      ? undefined
      : `Peer "${name}" version ${currentString} does not satisfy ${required}. Run \`${binary ?? name} update\` first.`,
  };
}

/**
 * Probe every declared peer. Returned in declaration order so callers
 * surfacing JSON output get stable key ordering.
 */
export async function checkAllPeers(): Promise<PeerVersionResult[]> {
  const out: PeerVersionResult[] = [];
  for (const name of Object.keys(REQUIREMENTS)) {
    // eslint-disable-next-line no-await-in-loop -- ordering matters for stable JSON keys.
    out.push(await checkPeerVersion(name));
  }
  return out;
}
