#!/usr/bin/env node
/**
 * Ensure libicu soname symlinks exist inside @embedded-postgres/linux-x64/native/lib/.
 *
 * The upstream package occasionally ships only the fully-versioned files
 * (libicui18n.so.60.2) without the shorter soname links (libicui18n.so.60) that
 * the bundled postgres binary's DT_NEEDED entries require. pgserve then fails
 * at startup with "cannot open shared object file: libicui18n.so.60".
 *
 * This script detects the gap and creates the missing links. It is:
 *   - Idempotent (safe to re-run)
 *   - Cross-platform safe (exits 0 cleanly when the package isn't installed)
 *   - Resilient (swallows EEXIST races, logs other errors without exiting non-zero)
 *
 * Called from:
 *   - top-level `package.json` postinstall
 *   - `packages/api/package.json` postinstall
 *   - `packages/api/src/pgserve.ts` runtime fallback (inline mirror of this logic)
 *
 * KEEP IN SYNC with the inline `ensureLibicuSymlinks()` helper in
 * packages/api/src/pgserve.ts. Both implementations must agree on:
 *   - Which libraries to patch (ICU_LIBS)
 *   - How the source file is matched (libXXX.so.60.N)
 *   - How the symlink is created (relative basename, inside native/lib)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ICU_LIBS = ['libicui18n', 'libicuuc', 'libicudata'];

/**
 * Walk up from a file path until we find a directory containing package.json.
 * Used to locate a package root when the resolved main module is nested.
 */
function findPackageRoot(startFile) {
  let dir = path.dirname(startFile);
  for (let i = 0; i < 20 && dir !== '/' && dir !== '.'; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Locate @embedded-postgres/linux-x64/native/lib/.
 *
 * Resolution is non-trivial in this repo because:
 *   1. `@embedded-postgres/linux-x64` is an **optional** dep of `pgserve`, so
 *      it's not visible from the top-level package node_modules chain —
 *      only from inside `pgserve`'s own node_modules.
 *   2. `@embedded-postgres/linux-x64/package.json` exists but the package's
 *      `"exports"` field does NOT expose it, so
 *      `require.resolve('@embedded-postgres/linux-x64/package.json')` fails
 *      with ERR_PACKAGE_PATH_NOT_EXPORTED on modern Node.
 *   3. Bun's isolated install layout symlinks `pgserve` into
 *      `node_modules/.bun/pgserve@X/node_modules/pgserve` — so standard
 *      resolution from an arbitrary cwd doesn't find the package.
 *
 * Strategy:
 *   a. Try multiple candidate paths (cwd, __dirname, known monorepo
 *      locations), realpath-following each to catch bun symlinks, and resolve
 *      the package *main* (NOT package.json — `exports` blocks that).
 *   b. Walk up from the resolved JS file to the package root.
 *   c. Fallback: scan `node_modules/.bun/@embedded-postgres+linux-x64@*`
 *      directly — bun's predictable layout lets us locate it even when
 *      standard resolution fails entirely.
 *
 * Returns null when the package isn't installed (darwin, windows, or a
 * monorepo that hasn't been bun-installed yet).
 */
function locateLibDir() {
  // Candidate directories to start resolution from. Order: most-specific first.
  const rawCandidates = [
    process.cwd(),
    path.join(process.cwd(), 'packages', 'api'),
    path.join(process.cwd(), 'packages', 'api', 'node_modules', 'pgserve'),
    __dirname,
    path.join(__dirname, '..'),
    path.join(__dirname, '..', 'packages', 'api'),
    path.join(__dirname, '..', 'packages', 'api', 'node_modules', 'pgserve'),
  ];

  // Follow symlinks (bun isolated layout points real paths into node_modules/.bun/)
  const candidates = [];
  for (const c of rawCandidates) {
    try {
      candidates.push(fs.realpathSync(c));
    } catch {
      // path doesn't exist — skip
    }
    if (!candidates.includes(c)) candidates.push(c);
  }

  // Strategy A: resolve package main, walk up to find package root.
  for (const p of candidates) {
    try {
      const main = require.resolve('@embedded-postgres/linux-x64', { paths: [p] });
      const pkgRoot = findPackageRoot(main);
      if (pkgRoot) {
        const libDir = path.join(pkgRoot, 'native', 'lib');
        if (fs.existsSync(libDir)) return libDir;
      }
    } catch {
      // try next candidate
    }
  }

  // Strategy B: direct filesystem probe of bun's isolated layout.
  const bunRoots = [
    path.join(process.cwd(), 'node_modules', '.bun'),
    path.join(__dirname, '..', 'node_modules', '.bun'),
  ];
  for (const bunRoot of bunRoots) {
    try {
      if (!fs.existsSync(bunRoot)) continue;
      const entries = fs.readdirSync(bunRoot);
      const match = entries.find((e) => /^@embedded-postgres\+linux-x64@/.test(e));
      if (!match) continue;
      const libDir = path.join(bunRoot, match, 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'lib');
      if (fs.existsSync(libDir)) return libDir;
    } catch {
      // try next root
    }
  }

  return null;
}

/**
 * For each libicuXXX.so.60.N file, create libicuXXX.so.60 if missing.
 * Returns a structured result so callers can log or surface errors.
 */
function ensureLibicuSymlinks() {
  const result = {
    libDir: null,
    created: [],
    alreadyPresent: [],
    missingSource: [],
    errors: [],
  };

  const libDir = locateLibDir();
  if (!libDir) return result;
  result.libDir = libDir;

  let entries;
  try {
    entries = fs.readdirSync(libDir);
  } catch (err) {
    result.errors.push({ step: 'readdir', error: String(err) });
    return result;
  }

  for (const libName of ICU_LIBS) {
    // Match libicuXXX.so.60.N (e.g., libicui18n.so.60.2)
    const sourceRe = new RegExp(`^${libName}\\.so\\.60\\.\\d+$`);
    const sourceFile = entries.find((f) => sourceRe.test(f));
    const sonameLink = `${libName}.so.60`;

    if (!sourceFile) {
      result.missingSource.push(libName);
      continue;
    }

    const linkPath = path.join(libDir, sonameLink);
    if (fs.existsSync(linkPath)) {
      result.alreadyPresent.push(sonameLink);
      continue;
    }

    try {
      // Relative target (just the basename) keeps the link movable with the dir.
      fs.symlinkSync(sourceFile, linkPath);
      result.created.push(sonameLink);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        result.alreadyPresent.push(sonameLink);
        continue;
      }
      result.errors.push({ step: 'symlink', file: sonameLink, error: String(err) });
    }
  }

  return result;
}

module.exports = { ensureLibicuSymlinks, locateLibDir, ICU_LIBS };

// Run when invoked directly (postinstall hook or manual CLI).
if (require.main === module) {
  const result = ensureLibicuSymlinks();

  if (!result.libDir) {
    // Package not installed on this platform — not an error.
    process.exit(0);
  }

  if (result.created.length > 0) {
    console.log(`[libicu-shim] created ${result.created.length} symlink(s) in ${result.libDir}:`);
    for (const f of result.created) console.log(`[libicu-shim]   + ${f}`);
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.warn(`[libicu-shim] WARN: ${JSON.stringify(err)}`);
    }
    // Only warn — do NOT exit non-zero. A failed shim should not break
    // `bun install`; pgserve will surface a clearer error at runtime.
  }

  process.exit(0);
}
