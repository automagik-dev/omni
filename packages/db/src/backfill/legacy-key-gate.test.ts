/**
 * Legacy god-key gate for the platform bootstrap (issue #980). Pure — the
 * classifier's SQL read is stubbed with fixture rows; no server.
 */

import { describe, expect, test } from 'bun:test';
import type { ToolingSql } from './db';
import { auditLegacyKeysForBootstrap } from './legacy-key-gate';

interface FixtureRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[] | null;
  instance_ids: string[] | null;
  instance_allowlist: string[] | null;
  status: string;
}

function stubSql(rows: FixtureRow[]): ToolingSql {
  return { unsafe: async () => rows } as unknown as ToolingSql;
}

function row(over: Partial<FixtureRow>): FixtureRow {
  return {
    id: crypto.randomUUID(),
    name: 'legacy-key',
    key_prefix: 'abcdefgh',
    scopes: ['messages:read'],
    instance_ids: ['aaaaaaaa-0000-4000-8000-0000000000a1'],
    instance_allowlist: null,
    status: 'active',
    ...over,
  };
}

describe('legacy god-key gate (platform bootstrap)', () => {
  test('an active `*` god key requires an explicit decision — never auto-classified as platform', async () => {
    const report = await auditLegacyKeysForBootstrap(stubSql([row({ scopes: ['*'], instance_ids: null })]));
    expect(report.requiresExplicitDecision).toBe(true);
    expect(report.godKeyWorklist).toHaveLength(1);
    expect(report.godKeyWorklist[0]?.classification).toBe('platform-credential');
    expect(report.godKeyWorklist[0]?.requiresOwnerAndPurpose).toBe(true);
  });

  test('an unrestricted key (no instance restriction) is on the worklist too', async () => {
    const report = await auditLegacyKeysForBootstrap(
      stubSql([row({ scopes: ['messages:read'], instance_ids: null, instance_allowlist: null })]),
    );
    expect(report.requiresExplicitDecision).toBe(true);
  });

  test('a revoked god key does not block the bootstrap', async () => {
    const report = await auditLegacyKeysForBootstrap(
      stubSql([row({ scopes: ['*'], instance_ids: null, status: 'revoked' })]),
    );
    expect(report.requiresExplicitDecision).toBe(false);
    expect(report.godKeyWorklist).toHaveLength(0);
    // The classifier still counted it — only the ACTIVE worklist gates.
    expect(report.counts['platform-credential']).toBe(1);
  });

  test('restricted keys do not require a decision', async () => {
    const report = await auditLegacyKeysForBootstrap(stubSql([row({})]));
    expect(report.requiresExplicitDecision).toBe(false);
    expect(report.totalLegacyKeys).toBe(1);
  });

  test('the gate report never carries hash or secret material', async () => {
    const report = await auditLegacyKeysForBootstrap(stubSql([row({ scopes: ['*'], instance_ids: null })]));
    expect(JSON.stringify(report)).not.toMatch(/hash|omni_sk_[A-Za-z0-9]{9,}/i);
  });
});
