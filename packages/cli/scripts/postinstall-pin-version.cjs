#!/usr/bin/env node
/**
 * postinstall-pin-version.cjs
 *
 * Self-heal the global package.json caret range that triggers the
 * "version drift back to 2.20260221.x" footgun.
 *
 * Background
 * ----------
 * Omni's version scheme is `2.YYMMDD.X` (e.g. `2.260430.7`). The legacy
 * scheme used 8-digit YYYYMMDD minors (e.g. `2.20260221.1`). Semver
 * compares minors numerically:
 *
 *     2.260430.7    →  MINOR = 260430
 *     2.20260221.1  →  MINOR = 20260221     ← 77× larger
 *
 * So `^2.260430.7` in a package.json semver-resolves to
 * `2.20260221.1` (legacy version still on the registry). Every range-
 * resolving install (e.g. plain `bun install -g`, or any tool that
 * re-resolves the global manifest) flips the install backward.
 *
 * What this script does
 * ---------------------
 * On every `bun add -g @automagik/omni` / `npm install -g
 * @automagik/omni`, this postinstall runs and rewrites the
 * `@automagik/omni` entry in the global manifest from a caret range to
 * an exact pin (`"2.260430.7"` no `^`). That stops the drift at the
 * source — operators don't need to remember `--exact`, and any later
 * range-resolve sees the exact version they last installed.
 *
 * Where this script writes
 * ------------------------
 *   - `~/.bun/install/global/package.json` (bun's global manifest)
 *   - `<npm root -g>/package.json` (only if it exists; npm's global
 *     install layout doesn't always include this file)
 *
 * Hardening
 * ---------
 *   - Best-effort: NEVER fails the install. Any error → log to stderr
 *     and exit 0. The install proceeds; the operator can still pin
 *     manually.
 *   - Idempotent: writing the same file twice is a no-op.
 *   - Touches ONLY `@automagik/omni` — leaves other dependencies alone.
 *   - No-op when run inside the package's own dev tree (workspace
 *     install): we detect via the absence of the global manifest path.
 *   - No-op when env `OMNI_SKIP_POSTINSTALL_PIN=1` (escape hatch for
 *     CI / testers / downstream packagers who pin via their own tooling).
 *
 * Removal
 * -------
 * When the legacy `2.20260218–2.20260221` versions are deprecated or
 * unpublished from the registry (the proper fix), this script becomes a
 * no-op safely. It can be removed at that point.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PACKAGE_NAME = '@automagik/omni';

function log(msg) {
  // Stderr only so JSON tooling consuming stdout stays clean.
  process.stderr.write(`[omni postinstall] ${msg}\n`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(tmp, filePath);
}

/**
 * Replace `"@automagik/omni": "^X.Y.Z"` with the exact version. Returns
 * true when a change was applied, false otherwise.
 */
function pinInManifest(manifestPath, exactVersion) {
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = readJson(manifestPath);
  if (!manifest || typeof manifest !== 'object') return false;

  let changed = false;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[field];
    if (!deps || typeof deps !== 'object') continue;
    const current = deps[PACKAGE_NAME];
    if (typeof current !== 'string') continue;
    // Skip when already exact OR when not a caret range (e.g. a tarball
    // URL, git ref, file: spec, or workspace marker — none of these are
    // affected by the legacy-version-resolve-up bug).
    if (!current.startsWith('^') && !current.startsWith('~')) continue;
    if (current === exactVersion) continue;
    deps[PACKAGE_NAME] = exactVersion;
    changed = true;
  }

  if (changed) {
    writeJsonAtomic(manifestPath, manifest);
  }
  return changed;
}

function getOurVersion() {
  // package.json sits one directory up from this script (packages/cli/
  // when running from source, or the package root when running from
  // npm-installed tarball — same relative layout in both).
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const pkg = readJson(pkgPath);
  if (!pkg || typeof pkg.version !== 'string') return null;
  return pkg.version;
}

function getNpmGlobalRoot() {
  // Best-effort: shell out to npm root -g. Cap a short timeout so a
  // hung npm doesn't block the install pipeline.
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 3000 });
    return out.trim();
  } catch {
    return null;
  }
}

function main() {
  if (process.env.OMNI_SKIP_POSTINSTALL_PIN === '1') {
    return; // operator opt-out
  }

  const ourVersion = getOurVersion();
  if (!ourVersion) {
    log('skipped: could not read own package version');
    return;
  }

  const targets = [];

  // bun global manifest
  const bunGlobalManifest = path.join(os.homedir(), '.bun', 'install', 'global', 'package.json');
  targets.push({ label: 'bun', path: bunGlobalManifest });

  // npm global manifest (only if `npm` is installed)
  const npmRoot = getNpmGlobalRoot();
  if (npmRoot) {
    targets.push({ label: 'npm', path: path.join(npmRoot, '..', 'package.json') });
  }

  let pinned = 0;
  for (const target of targets) {
    try {
      if (pinInManifest(target.path, ourVersion)) {
        log(`pinned ${PACKAGE_NAME} to ${ourVersion} in ${target.label} global manifest (${target.path})`);
        pinned += 1;
      }
    } catch (err) {
      // Never fail the install. Surface the reason for diagnosis but
      // exit 0 below.
      log(`warning: could not pin ${target.label} manifest at ${target.path}: ${err?.message ? err.message : err}`);
    }
  }

  if (pinned === 0) {
    // Either no global manifest had a caret entry (already pinned, or
    // installed via a path that doesn't write to package.json), or the
    // package isn't in any global manifest. Either way: no-op is fine.
  }
}

try {
  main();
} catch (err) {
  // Last-resort safety net. The install MUST NOT fail because of this
  // script.
  process.stderr.write(`[omni postinstall] unexpected error (non-fatal): ${err?.stack ? err.stack : err}\n`);
}

process.exit(0);
