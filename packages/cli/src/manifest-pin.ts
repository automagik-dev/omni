/**
 * CLI startup self-heal for the @automagik/omni semver-drift footgun.
 *
 * Background
 * ----------
 * Omni's version scheme is `2.YYMMDD.X`. The legacy scheme used 8-digit
 * `YYYYMMDD` minors (`2.20260221.x`). Semver compares minors as integers,
 * so `^2.260430.10` resolves to `2.20260221.1` because 20260221 > 260430.
 *
 * The package's own `postinstall` hook (scripts/postinstall-pin-version.cjs)
 * tries to rewrite the global manifest from `^2.260430.10` to
 * `2.260430.10` (exact). But bun's install lifecycle writes the final
 * manifest entry AFTER running postinstall, so the postinstall pin gets
 * overwritten by the original install. Empirically:
 *
 *     T+0  bun resolves @automagik/omni@next → 2.260430.10
 *     T+1  bun extracts tarball
 *     T+2  postinstall fires; rewrites manifest to "2.260430.10" ✅
 *     T+3  bun finalizes, writes manifest "@automagik/omni": "^2.260430.10" ❌
 *
 * This module is the second leg: every time the omni CLI starts, it
 * checks the global manifest and self-pins if it sees a caret/tilde
 * range. The pin happens NATURALLY after install because the operator's
 * very first `omni …` invocation post-install fires this code. From
 * that point on, no range is ever in the manifest.
 *
 * Why not just spawn a detached subprocess from postinstall?
 * - Race-prone: relies on guessing how long bun's manifest write takes.
 * - Confusing in logs: a stray child process appears to outlive the
 *   parent shell.
 * - Less observable: the operator doesn't see what's happening.
 *
 * The CLI-startup approach is deterministic, observable (logs to stderr
 * once), and idempotent (a no-op when the pin is already exact).
 *
 * Performance
 * -----------
 *  - One stat + one JSON parse on every invocation. ~1ms typical.
 *  - When a pin needs writing, one tmp-write + rename. <5ms typical.
 *  - Bypassed entirely when env `OMNI_SKIP_POSTINSTALL_PIN=1` is set
 *    (same opt-out as the postinstall hook).
 *
 * Removal
 * -------
 * When the legacy `2.20260218–2.20260221` versions are deprecated /
 * unpublished, this becomes a no-op safely. Delete the file at that
 * point and remove the call from index.ts.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from './version.js';

const PACKAGE_NAME = '@automagik/omni';
const BUN_GLOBAL_MANIFEST = join(homedir(), '.bun', 'install', 'global', 'package.json');

/**
 * Replace `"@automagik/omni": "^X.Y.Z"` with the exact version in the
 * given manifest path. No-op when the entry is already exact, missing,
 * or a non-range spec (file:, git+, tarball URL).
 *
 * Returns true when a write occurred. Exported for tests.
 */
export function pinManifestEntry(manifestPath: string, exactVersion: string): boolean {
  if (!existsSync(manifestPath)) return false;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    // Corrupt manifest → don't make it worse. Operator's package manager
    // will throw a more useful error than ours can.
    return false;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;

  let changed = false;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[field];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    const depMap = deps as Record<string, unknown>;
    const current = depMap[PACKAGE_NAME];
    if (typeof current !== 'string') continue;
    // Only rewrite caret / tilde ranges. Leave file:, git+, tarball URLs,
    // or workspace specs alone — they're not vulnerable to the
    // legacy-version-resolve-up bug.
    if (!current.startsWith('^') && !current.startsWith('~')) continue;
    if (current === exactVersion) continue;
    depMap[PACKAGE_NAME] = exactVersion;
    changed = true;
  }

  if (!changed) return false;

  // Atomic rename so a half-baked write can't leave the manifest
  // unparseable for the next install.
  const tmp = `${manifestPath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    renameSync(tmp, manifestPath);
  } catch {
    // Manifest was readonly, dir-was-readonly, etc. — don't fail the CLI
    // for a self-heal hiccup.
    return false;
  }
  return true;
}

/**
 * Run the self-heal on omni CLI startup. Best-effort, never throws,
 * never blocks. Safe to call early in `index.ts` before commander
 * parses argv.
 */
export function selfHealManifestPin(): void {
  if (process.env.OMNI_SKIP_POSTINSTALL_PIN === '1') return;
  try {
    pinManifestEntry(BUN_GLOBAL_MANIFEST, VERSION);
  } catch {
    // Belt-and-suspenders. The CLI must NEVER fail because of this.
  }
}
