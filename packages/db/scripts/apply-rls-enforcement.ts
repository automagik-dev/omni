#!/usr/bin/env bun
/**
 * Explicit RLS-enforcement activation (wish: omni-full-multitenancy, Group G3).
 *
 * This is the ONLY way the enforcement DDL ever reaches a database. It is not
 * in `drizzle/meta/_journal.json`, so `applyMigrations()` — which runs on every
 * API boot — cannot activate it by accident. That separation is the whole
 * point: the wish's state machine puts `FORCE ROW LEVEL SECURITY` at state 5,
 * after backfill and reconciliation prove zero unresolved ownership, and a
 * boot-time migration would put it at state 1 on every existing deployment.
 *
 * Usage:
 *   bun run scripts/apply-rls-enforcement.ts --url <postgres-url> [--roles] [--check]
 *
 *   --url    REQUIRED. The target database. There is no default and
 *            `DATABASE_URL` is never read: activating a security boundary
 *            against "whatever was in the environment" is not an accident worth
 *            enabling.
 *   --roles  Also provision the DDL / runtime / auth-plane split. Requires a
 *            superuser (provisioner) connection and three passwords supplied as
 *            OMNI_DDL_PASSWORD / OMNI_RUNTIME_PASSWORD / OMNI_AUTH_PLANE_PASSWORD.
 *   --check  Report the current enforcement state and exit without changing
 *            anything.
 *   --legacy-role <name>
 *            Repeatable. Strip every privilege the pre-cutover scoped role
 *            (`pgserve_omni_<fp>_role`, provisioned by
 *            `packages/cli/src/lib/role-cutover.ts`) still holds. Ownership of
 *            its objects moves to the DDL role automatically; its blanket
 *            `GRANT ... ON ALL TABLES` does NOT, and until it is revoked that
 *            role can still read `auth_credentials`. Only meaningful with
 *            `--roles`.
 *
 * PRECONDITIONS the operator is responsible for (this script does NOT verify
 * them, and cannot):
 *   1. every tenant-owned row has a non-null `tenant_id` (G6 reconciliation);
 *   2. no pre-tenant binary can still start (mixed-version states 1-4);
 *   3. a verified backup exists.
 *
 * Against a database that still holds NULL-owner rows, activation makes those
 * rows invisible to everyone. That is correct fail-closed behaviour and a
 * catastrophic surprise if it was not intended.
 */

import { applyTenancyRoles, applyTenantRlsEnforcement, createDbHandle, readEnforcementState } from '../src/index';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Every `--<name> <value>` occurrence, so `--legacy-role` can be repeated. */
function options(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}`) {
      const value = process.argv[index + 1];
      if (value && !value.startsWith('--')) values.push(value);
    }
  });
  return values;
}

const url = option('url');
if (!url) {
  process.stderr.write(
    'apply-rls-enforcement: --url <postgres-url> is required.\n' +
      'DATABASE_URL is deliberately NOT consulted — name the target explicitly.\n',
  );
  process.exit(2);
}

const handle = createDbHandle({ url, maxConnections: 2 });

try {
  const before = await readEnforcementState(handle.db);
  process.stdout.write(`current state: ${before.state}\n`);
  if (before.state === 'partial') {
    process.stdout.write(
      `  WARNING: ${before.missing.length} table(s) not forced, ` +
        `${before.missingPolicies.length} missing policies — some tables are protected and some are not.\n`,
    );
  }

  if (flag('check')) {
    process.exit(before.state === 'partial' ? 1 : 0);
  }

  const report = await applyTenantRlsEnforcement(handle.db);
  process.stdout.write(
    `applied ${report.statements} statements across ${report.tables.length} tables; state: ${report.state.state}\n`,
  );

  // Enforcement FIRST: the role plan grants EXECUTE on the policy helper
  // functions, which have to exist before they can be granted on.
  if (flag('roles')) {
    const passwords = {
      ddl: process.env.OMNI_DDL_PASSWORD ?? '',
      runtime: process.env.OMNI_RUNTIME_PASSWORD ?? '',
      authPlane: process.env.OMNI_AUTH_PLANE_PASSWORD ?? '',
    };
    for (const [name, value] of Object.entries(passwords)) {
      if (!value) {
        process.stderr.write(`apply-rls-enforcement: --roles needs a password for the ${name} identity\n`);
        process.exit(2);
      }
    }
    const database = new URL(url).pathname.replace(/^\//, '');
    // The pre-cutover scoped role keeps its blanket GRANTs until it is named
    // here — ownership moves to the DDL role automatically, privilege does not.
    const legacyRoles = options('legacy-role');
    const count = await applyTenancyRoles(handle.db, passwords, undefined, database, legacyRoles);
    if (legacyRoles.length > 0) {
      process.stdout.write(`revoked legacy role privileges: ${legacyRoles.join(', ')}\n`);
    }
    process.stdout.write(`provisioned role split: ${count} statements\n`);
  }
  process.exit(report.state.state === 'enforced' ? 0 : 1);
} finally {
  await handle.close();
}
