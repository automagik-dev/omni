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
 * Omni's own DSH plugins (apps/*-dsh) are the exception: each carries the Omni
 * version of its last change, so it moves to <version> only when its folder
 * changed since the release its current version names, and otherwise keeps its
 * version (scripts/lib/plugin-versions.ts). A pending `engines.omni` minimum
 * (above the version before this cut) becomes `>=<version>`.
 *
 * The full list of tracked fields lives in scripts/lib/version-fields.ts and
 * is shared with scripts/verify-versions.ts so the CI drift guard cannot fall
 * out of sync with this script.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planPluginVersions } from './lib/plugin-versions';
import { getAllVersionFields, repoRoot } from './lib/version-fields';

/** Rewrite `engines.omni` in a plugin's package.json, keeping its layout. */
function writeOmniRange(dir: string, range: string): void {
  const path = join(repoRoot, dir, 'package.json');
  const content = readFileSync(path, 'utf-8');
  const data = JSON.parse(content) as { engines?: Record<string, string> };
  data.engines = { ...data.engines, omni: range };
  const indent = content.match(/^(\s+)"/m)?.[1] ?? '  ';
  writeFileSync(path, `${JSON.stringify(data, null, indent)}\n`, 'utf-8');
}

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

  const previous = String(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version);
  // Judged before anything is written: the plugins' folders as the cut found them.
  const plans = new Map(planPluginVersions(repoRoot, version, previous).map((plan) => [plan.dir, plan]));
  for (const plan of plans.values()) {
    console.log(`  plugin: ${plan.dir} ${plan.from} -> ${plan.to} (${plan.why})`);
    if (plan.omniRange !== null) {
      writeOmniRange(plan.dir, plan.omniRange);
      console.log(`  plugin: ${plan.dir} engines.omni -> ${plan.omniRange}`);
    }
  }

  const fields = getAllVersionFields();
  let updated = 0;
  let skipped = 0;

  for (const field of fields) {
    const target = field.plugin ? (plans.get(field.plugin)?.to ?? version) : version;
    const changed = field.write(target);
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
