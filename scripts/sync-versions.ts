#!/usr/bin/env bun

/**
 * Sync all package.json versions to a single unified version.
 *
 * Usage: bun scripts/sync-versions.ts <version>
 * Example: bun scripts/sync-versions.ts 2.20260215.3
 *
 * Updates root package.json + all packages/* and apps/* package.json files.
 * Excludes: packages/audio-decode-shim (vendored fork with its own version).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

/** Packages excluded from version sync */
const EXCLUDED = new Set(['audio-decode-shim']);

function findPackageJsonFiles(): string[] {
  const paths: string[] = [join(repoRoot, 'package.json')];

  for (const dir of ['packages', 'apps']) {
    const base = join(repoRoot, dir);
    if (!existsSync(base)) continue;

    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (EXCLUDED.has(entry.name)) continue;

      const pkgPath = join(base, entry.name, 'package.json');
      if (existsSync(pkgPath)) {
        paths.push(pkgPath);
      }
    }
  }

  return paths;
}

function updatePackageJson(filePath: string, version: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(content) as Record<string, unknown>;

  if (pkg.version === version) {
    return false; // Already correct
  }

  pkg.version = version;

  // Preserve original formatting (detect indent)
  const indent = content.match(/^(\s+)"/m)?.[1] ?? '  ';
  const updated = `${JSON.stringify(pkg, null, indent)}\n`;
  writeFileSync(filePath, updated, 'utf-8');
  return true;
}

function main(): void {
  const version = process.argv[2];

  if (!version) {
    console.error('Usage: bun scripts/sync-versions.ts <version>');
    console.error('Example: bun scripts/sync-versions.ts 2.20260215.3');
    process.exit(1);
  }

  // Basic version format validation
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.error(`Invalid version format: ${version}`);
    console.error('Expected format: N.YYYYMMDD.N (e.g., 2.20260215.3)');
    process.exit(1);
  }

  const files = findPackageJsonFiles();
  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const rel = file.replace(`${repoRoot}/`, '');
    const changed = updatePackageJson(file, version);
    if (changed) {
      console.log(`  updated: ${rel}`);
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\nSync complete: ${updated} updated, ${skipped} already current (${files.length} total)`);
}

main();
