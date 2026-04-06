#!/usr/bin/env bun

/**
 * Sync every tracked version field to a single unified calver.
 *
 * Usage: bun scripts/sync-versions.ts <version>
 * Example: bun scripts/sync-versions.ts 2.260215.3
 *
 * Updates root package.json, every workspace package.json (excluding the
 * vendored `audio-decode-shim` fork), the omni Claude plugin manifest, and
 * the omni entry in the Claude marketplace manifest.
 *
 * The full list of tracked fields lives in scripts/lib/version-fields.ts and
 * is shared with scripts/verify-versions.ts so the CI drift guard cannot fall
 * out of sync with this script.
 */

import { getAllVersionFields } from './lib/version-fields';

function main(): void {
  const version = process.argv[2];

  if (!version) {
    console.error('Usage: bun scripts/sync-versions.ts <version>');
    console.error('Example: bun scripts/sync-versions.ts 2.260215.3');
    process.exit(1);
  }

  // Basic version format validation
  if (!/^\d+\.\d{6}\.\d+$/.test(version)) {
    console.error(`Invalid version format: ${version}`);
    console.error('Expected format: N.YYMMDD.N (e.g., 2.260215.3)');
    process.exit(1);
  }

  const fields = getAllVersionFields();
  let updated = 0;
  let skipped = 0;

  for (const field of fields) {
    const changed = field.write(version);
    if (changed) {
      console.log(`  updated: ${field.path}`);
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\nSync complete: ${updated} updated, ${skipped} already current (${fields.length} total)`);
}

main();
