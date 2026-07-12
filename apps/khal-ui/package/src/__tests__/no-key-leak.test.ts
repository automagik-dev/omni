import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Grep gate: the real Omni API key (from the local .env, injected only by the
 * BFF at runtime) must never appear in committed sources, generated evidence, or
 * built pack assets. The key is read from the environment at test time; if it is
 * absent (CI without the secret) the assertion is skipped gracefully — the gate
 * only bites where the key is actually available to leak.
 *
 * Placeholder patterns (omni_sk_xxxx, omni_sk_your…, omni_sk_e2e, the test key in
 * bff.test.ts) are fine — this asserts the *real* key specifically.
 */

// apps/khal-ui root, two levels up from package/src/__tests__.
const APP_ROOT = join(import.meta.dir, '..', '..', '..');

// Directories that ship or are committed. Deliberately excludes .env(.*) — the
// real key legitimately lives there and it is git-ignored.
const SCAN_DIRS = ['package/src', 'service/src', 'scripts', 'dev/src', 'evidence', 'package/dist'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'dist-types']);
const SKIP_FILE = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|map)$/i;

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (!SKIP_FILE.test(name)) out.push(full);
  }
}

describe('no-key-leak gate', () => {
  const realKey = process.env.OMNI_API_KEY ?? '';

  test('the real OMNI_API_KEY does not appear in committed sources, evidence, or built assets', () => {
    if (!realKey || !realKey.startsWith('omni_sk_')) {
      // No real key available (or unset) — nothing to assert against. Skip gracefully.
      return;
    }
    const files: string[] = [];
    for (const rel of SCAN_DIRS) walk(join(APP_ROOT, rel), files);

    const hits: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (content.includes(realKey)) hits.push(file.replace(`${APP_ROOT}/`, ''));
    }

    expect(hits).toEqual([]);
    // Sanity: we actually scanned something.
    expect(files.length).toBeGreaterThan(0);
  });
});
