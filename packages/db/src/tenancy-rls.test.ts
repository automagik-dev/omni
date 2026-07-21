/**
 * Static contract tests for the RLS enforcement plan
 * (wish: omni-full-multitenancy, Group G3).
 *
 * These assert the SHAPE of the DDL without a server. They are not a substitute
 * for `rls-postgres.test.ts` — only PostgreSQL can prove a policy denies a row —
 * but they catch the failures a live test would report confusingly: a table
 * silently missing from coverage, a predicate that reads a session variable
 * instead of a transaction-local one, an auth-plane exemption that leaked onto
 * a write policy.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANT_TABLES } from './tenancy-ownership';
import {
  AUTH_PLANE_READABLE_TABLES,
  AUTH_PLANE_ROW_FUNCTION,
  G1_TENANT_PLANE_TABLES,
  POLICY_COMMANDS,
  RLS_EXCLUSIONS,
  RLS_TENANT_TABLES,
  RUNTIME_DENIED_TABLES,
  contextFunctionStatements,
  dropPolicyStatements,
  policyName,
  policyStatements,
  tablePolicyStatements,
} from './tenancy-rls';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');

describe('RLS coverage', () => {
  test('covers the 29 manifest tenant tables plus every G1 tenant-plane table', () => {
    expect(TENANT_TABLES).toHaveLength(29);
    expect(G1_TENANT_PLANE_TABLES).toHaveLength(8);
    expect(RLS_TENANT_TABLES).toHaveLength(37);
    for (const table of TENANT_TABLES) expect(RLS_TENANT_TABLES).toContain(table);
    for (const table of G1_TENANT_PLANE_TABLES) expect(RLS_TENANT_TABLES).toContain(table);
  });

  test('the three tables the prompt names explicitly are covered', () => {
    for (const table of ['tenant_memberships', 'tenant_key_lineage', 'tenant_audit_logs']) {
      expect(RLS_TENANT_TABLES).toContain(table);
    }
  });

  test('every exclusion carries a control-plane justification and is denied to the runtime role', () => {
    expect(RLS_EXCLUSIONS.length).toBeGreaterThan(0);
    for (const exclusion of RLS_EXCLUSIONS) {
      expect(exclusion.justification.length).toBeGreaterThan(60);
      expect(RLS_TENANT_TABLES).not.toContain(exclusion.table);
      expect(RUNTIME_DENIED_TABLES).toContain(exclusion.table);
    }
  });

  test('no table is both covered and excluded', () => {
    const excluded = new Set(RLS_EXCLUSIONS.map((e) => e.table));
    for (const table of RLS_TENANT_TABLES) expect(excluded.has(table)).toBe(false);
  });
});

describe('policy shape', () => {
  test('every table gets ENABLE, FORCE, and all four per-command policies', () => {
    for (const table of RLS_TENANT_TABLES) {
      const statements = tablePolicyStatements(table).join('\n');
      expect(statements).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(statements).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
      for (const command of POLICY_COMMANDS) {
        expect(statements).toContain(`CREATE POLICY "${policyName(table, command)}"`);
      }
    }
  });

  test('INSERT and UPDATE carry WITH CHECK; SELECT and DELETE carry USING', () => {
    const statements = tablePolicyStatements('messages');
    const find = (command: string): string =>
      statements.find((s) => s.startsWith(`CREATE POLICY "${policyName('messages', command as never)}"`)) ?? '';

    expect(find('select')).toContain('USING');
    expect(find('select')).not.toContain('WITH CHECK');
    expect(find('insert')).toContain('WITH CHECK');
    expect(find('delete')).toContain('USING');
    expect(find('delete')).not.toContain('WITH CHECK');
    // UPDATE needs both: USING picks the rows, WITH CHECK stops re-tenanting.
    expect(find('update')).toContain('USING');
    expect(find('update')).toContain('WITH CHECK');
  });

  test('the predicate reads a transaction-local setting, never a session SET', () => {
    const plan = [...contextFunctionStatements(), ...policyStatements()].join('\n');
    expect(plan).toContain("current_setting('app.tenant_id', true)");
    expect(plan).not.toMatch(/^\s*SET\s+app\.tenant_id/m);
    expect(plan).not.toContain('set_config(');
  });

  test('the context function fails closed rather than returning NULL', () => {
    const [contextFn] = contextFunctionStatements();
    expect(contextFn).toContain('RAISE EXCEPTION');
    expect(contextFn).toContain('insufficient_privilege');
    // A NULL return would make the predicate "not true" — an empty result set
    // that reads like success. Every branch must raise or return a uuid.
    expect(contextFn).not.toContain('RETURN NULL');
    expect(contextFn).toContain('SET search_path = pg_catalog');
  });

  test('the auth-plane exemption applies to SELECT only, and only on the two pre-context tables', () => {
    for (const table of AUTH_PLANE_READABLE_TABLES) {
      const statements = tablePolicyStatements(table);
      const select = statements.find((s) => s.startsWith(`CREATE POLICY "${policyName(table, 'select')}"`)) ?? '';
      expect(select).toContain(AUTH_PLANE_ROW_FUNCTION);
      for (const command of ['insert', 'update', 'delete'] as const) {
        const policy = statements.find((s) => s.startsWith(`CREATE POLICY "${policyName(table, command)}"`)) ?? '';
        expect(policy).not.toContain(AUTH_PLANE_ROW_FUNCTION);
      }
    }

    const exempt = new Set(AUTH_PLANE_READABLE_TABLES);
    for (const table of RLS_TENANT_TABLES) {
      if (exempt.has(table)) continue;
      expect(tablePolicyStatements(table).join('\n')).not.toContain(AUTH_PLANE_ROW_FUNCTION);
    }
  });

  test('the auth-plane exemption is a role-membership predicate, never BYPASSRLS', () => {
    const plan = [...contextFunctionStatements(), ...policyStatements()].join('\n');
    expect(plan).not.toContain('BYPASSRLS');
    expect(plan).toContain('pg_has_role');
  });

  test('rollback statements undo exactly what apply installs', () => {
    const drops = dropPolicyStatements().join('\n');
    for (const table of RLS_TENANT_TABLES) {
      expect(drops).toContain(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;`);
      expect(drops).toContain(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`);
    }
  });

  test('an unsafe table identifier is rejected rather than interpolated', () => {
    expect(() => tablePolicyStatements('messages; DROP TABLE users --')).toThrow(/unsafe table identifier/);
  });
});

describe('delivery mechanism', () => {
  test('no enforcement DDL is journaled — a boot must never FORCE RLS on a legacy deployment', () => {
    const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf-8')) as {
      entries: { tag: string }[];
    };
    for (const entry of journal.entries) {
      const sql = readFileSync(join(drizzleDir, `${entry.tag}.sql`), 'utf-8');
      expect(sql).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
      expect(sql).not.toMatch(/CREATE\s+POLICY/i);
      expect(sql).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    }
  });

  test('G3 adds no migration file at all — 0041 and every applied migration are untouched', () => {
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files.at(-1)).toBe('0041_tenant_ownership_columns.sql');
  });
});
