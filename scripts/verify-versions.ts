#!/usr/bin/env bun

/**
 * Verify every tracked version field matches the root package.json.
 *
 * Usage: bun scripts/verify-versions.ts
 *
 * Reads the root package.json `version` as the reference value, then walks
 * every entry from scripts/lib/version-fields.ts and prints a per-file
 * status line. Exits 0 when all files match, 1 when any field drifts (or
 * is missing).
 *
 * Wired into the Quality Gate job in .github/workflows/ci.yml as the
 * "Verify version sync" step so version drift fails CI fast.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAllVersionFields, repoRoot } from './lib/version-fields';

function readRootVersion(): string {
  const content = readFileSync(join(repoRoot, 'package.json'), 'utf-8');
  const data = JSON.parse(content) as { version?: unknown };
  if (typeof data.version !== 'string') {
    throw new Error('root package.json has no string `version` field');
  }
  return data.version;
}

function main(): void {
  const reference = readRootVersion();
  console.log(`Reference version: ${reference}`);

  const fields = getAllVersionFields();
  let mismatches = 0;

  for (const field of fields) {
    const actual = field.read();
    const matches = actual === reference;
    const status = matches ? 'OK      ' : 'MISMATCH';
    const display = actual ?? '<missing>';
    console.log(`${status} ${field.path} → ${display}`);
    if (!matches) {
      mismatches++;
    }
  }

  const total = fields.length;
  const matched = total - mismatches;

  if (mismatches === 0) {
    console.log(`\nOK: ${matched}/${total} files match`);
    process.exit(0);
  }

  console.log(`\nFAIL: ${mismatches} mismatches found`);
  process.exit(1);
}

main();
