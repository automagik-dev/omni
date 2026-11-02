/** Live runtime-role proofs; later slices append their two-tenant suites here. */
import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../../..');
const TWO_TENANT_PROOFS = [
  'packages/api/src/__tests__/event-consumers-postgres.test.ts',
  'packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts',
  'packages/api/src/__tests__/event-consumers-tenant-enforced-postgres.test.ts',
  'packages/api/src/__tests__/paired-agent-grants-postgres.test.ts',
];
// Existing debt at 979370390, outside these proofs. This list may only shrink:
// equality catches new definitions AND stale entries after a helper is migrated.
const LOCAL_URLFOR_CEILING = 0;
const LOCAL_URLFOR_ACKNOWLEDGED: string[] = [];

test('every two-tenant proof imports and calls the shared live-role assertion', () => {
  for (const file of TWO_TENANT_PROOFS) {
    const source = readFileSync(resolve(root, file), 'utf8');
    const imports = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@omni\/db\/pg-migrated-template['"]/gs)]
      .map((match) => match[1])
      .join(' ');
    expect(imports).toMatch(/\bassertPgTestRole\b/);
    expect(imports).toMatch(/\bpgRoleUrl\b/);
    expect(source).toMatch(/\bassertPgTestRole\s*\(/);
    expect(LOCAL_URLFOR_ACKNOWLEDGED).not.toContain(file);
  }
});

test('whole-packages local urlFor inventory equals the shrinking acknowledged set', () => {
  // Dirents do not follow workspace dependency symlinks back into packages;
  // every physical package suite is scanned once, without source-file exclusions.
  function suites(directory: string): string[] {
    return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return suites(file);
      return entry.isFile() && file.endsWith('-postgres.test.ts') ? [file] : [];
    });
  }
  const scanned = suites('packages');
  for (const file of TWO_TENANT_PROOFS) expect(scanned).toContain(file);
  expect(scanned.length).toBeGreaterThan(60);
  const actual = scanned.filter((file) => /function urlFor\(/.test(readFileSync(resolve(root, file), 'utf8'))).sort();
  expect(actual).toEqual(LOCAL_URLFOR_ACKNOWLEDGED);
  expect(LOCAL_URLFOR_ACKNOWLEDGED.length).toBeLessThanOrEqual(LOCAL_URLFOR_CEILING);
});
