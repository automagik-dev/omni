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
const LOCAL_URLFOR_CEILING = 14;
const LOCAL_URLFOR_ACKNOWLEDGED = [
  'packages/api/scripts/__tests__/reconcile-identity-fragmentation-postgres.test.ts',
  'packages/api/src/__tests__/connector-ingress-postgres.test.ts',
  'packages/api/src/__tests__/connector-keyed-tenancy-postgres.test.ts',
  'packages/api/src/__tests__/events-custom-journal-postgres.test.ts',
  'packages/api/src/__tests__/follow-up-freshness-postgres.test.ts',
  'packages/api/src/__tests__/webhook-clickup-source-postgres.test.ts',
  'packages/api/src/__tests__/webhook-github-source-postgres.test.ts',
  'packages/api/src/plugins/__tests__/identity-canonicalization-postgres.test.ts',
  'packages/api/src/routes/v2/__tests__/chats-get-by-id-names-postgres.test.ts',
  'packages/api/src/routes/v2/__tests__/chats-sync-names-postgres.test.ts',
  'packages/api/src/services/__tests__/event-schema-gates-postgres.test.ts',
  'packages/api/src/services/__tests__/manifest-compiler-postgres.test.ts',
  'packages/api/src/services/__tests__/strict-schema-gate-postgres.test.ts',
  'packages/api/src/services/__tests__/webhook-idempotency-postgres.test.ts',
];

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
  const actual = suites('packages')
    .filter((file) => /function urlFor\(/.test(readFileSync(resolve(root, file), 'utf8')))
    .sort();
  expect(actual).toEqual(LOCAL_URLFOR_ACKNOWLEDGED);
  expect(LOCAL_URLFOR_ACKNOWLEDGED.length).toBeLessThanOrEqual(LOCAL_URLFOR_CEILING);
});
