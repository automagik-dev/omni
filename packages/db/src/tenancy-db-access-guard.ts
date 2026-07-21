/**
 * Architectural guard against database access outside the tenant boundary
 * (wish: omni-full-multitenancy, Group G3).
 *
 * WHAT IT ENFORCES
 * ----------------
 * Two things a code review reliably misses:
 *
 *   1. **Singleton acquisition.** `getDb()` / `createDb()` / `createPostgresClient()`
 *      hand out a pool handle with no tenant context attached. Every such call
 *      site is a place where a query can be issued outside
 *      `withTenantTransaction`.
 *   2. **Tenant-table access.** Any Drizzle `select().from(t)`, `insert(t)`,
 *      `update(t)`, or `delete(t)` against one of the 37 tenant tables, and any
 *      raw SQL equivalent.
 *
 * Every discovered site must appear in `REGISTERED_DB_ACCESS` with an explicit
 * class. An unregistered site is a FAILURE, not a warning — the guard is the
 * reason a new unscoped writer cannot land silently, which is the same stance
 * `tenancy-writer-coverage.ts` takes for G2 and the same ratchet mechanic.
 *
 * THE FOUR CLASSES
 * ----------------
 *   * `tenant-boundary` — reached only through `withTenantTransaction`. The
 *     target state for every tenant-scoped site.
 *   * `control-plane` — platform/auth-plane/lifecycle code that legitimately
 *     runs without a tenant context (ADR-0003, ADR-0005). Under enforcement
 *     these are additionally unreachable by the runtime role's grants.
 *   * `migration-ddl` — migration, backfill, and schema tooling. Runs under the
 *     DDL identity, never in a request.
 *   * `pending-G4-conversion` — tenant-scoped sites G3 deliberately did NOT
 *     convert, because G4 owns route-wide conversion. This class EXISTS TO
 *     SHRINK. `PENDING_G4_CEILING` is the count at the end of G3 and the test
 *     fails if it grows, so G4 can only ratchet it down.
 *
 * WHY A DENYLIST OF SITES RATHER THAN A LINT RULE
 * -----------------------------------------------
 * A lint rule would have to decide, statically, whether a given `db` identifier
 * is a pool or a transaction handle — and in this codebase services receive
 * `Database` by constructor injection, so that decision is not local. An
 * explicit inventory is less clever and strictly more honest: it says exactly
 * how many unconverted call sites remain, and that number is checked on every
 * test run.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RLS_TENANT_TABLES } from './tenancy-rls';

export type DbAccessClass = 'tenant-boundary' | 'control-plane' | 'migration-ddl' | 'pending-G4-conversion';

export interface DbAccessSite {
  /** Repository-relative path. */
  readonly file: string;
  /** SQL table name, or `*` for a bare pool/singleton acquisition. */
  readonly table: string;
}

export interface RegisteredDbAccess extends DbAccessSite {
  readonly class: DbAccessClass;
  /** Required for `control-plane` and `migration-ddl`: why no tenant context applies. */
  readonly justification?: string;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '__tests__', 'coverage']);

/**
 * Contract modules that mention table names and query verbs as DATA rather than
 * as queries: the ownership spec, the generated-SQL builders, and this guard's
 * own regex sources. Scanning them finds only their own vocabulary.
 *
 * `client.ts` is the definition of `createDb`/`getDb` themselves — the thing
 * every other site is measured against, not a site.
 */
const SKIP_FILES = new Set([
  'packages/db/src/client.ts',
  'packages/db/src/tenancy-ownership.ts',
  'packages/db/src/tenancy-rls.ts',
  'packages/db/src/tenancy-roles.ts',
  'packages/db/src/tenancy-startup.ts',
  'packages/db/src/tenancy-writer-coverage.ts',
  'packages/db/src/tenancy-db-access-guard.ts',
  'packages/db/scripts/generate-tenant-ownership-sql.ts',
  'packages/db/scripts/check-writer-coverage.ts',
  'packages/db/scripts/check-db-access.ts',
]);

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/') || /\.(test|spec)\.ts$/.test(path);
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !isTestFile(full)) out.push(full);
  }
}

/** Drizzle export name -> SQL table, for every RLS-covered table. */
function drizzleNameFor(table: string): string {
  // schema.ts uses lowerCamelCase of the snake_case table name throughout.
  return table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export const RLS_DRIZZLE_TO_TABLE: ReadonlyMap<string, string> = new Map(
  RLS_TENANT_TABLES.map((table) => [drizzleNameFor(table), table]),
);

/** Bare pool/singleton acquisition. Recorded against table `*`. */
const SINGLETON_CALL = /\b(?:getDb|createDb|createPostgresClient)\s*\(/g;

/**
 * Scan `packagesDir` for database access sites.
 *
 * Keyed by (file, table) rather than by line, so unrelated edits above a call
 * site do not churn the registry.
 */
export function scanDbAccessSites(packagesDir: string, repoRoot: string): DbAccessSite[] {
  const files: string[] = [];
  walk(packagesDir, files);

  const drizzleNames = [...RLS_DRIZZLE_TO_TABLE.keys()];
  const builder = new RegExp(`\\.(?:from|insert|update|delete)\\(\\s*(${drizzleNames.join('|')})\\s*[),]`, 'g');
  const rawSql = new RegExp(
    `(?:from|insert\\s+into|update|delete\\s+from)\\s+"?(${RLS_TENANT_TABLES.join('|')})"?\\b`,
    'gi',
  );

  const sites = new Map<string, DbAccessSite>();
  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (SKIP_FILES.has(rel)) continue;
    const source = readFileSync(file, 'utf-8');

    for (const match of source.matchAll(builder)) {
      const table = RLS_DRIZZLE_TO_TABLE.get(match[1] as string);
      if (table) sites.set(`${rel}::${table}`, { file: rel, table });
    }
    for (const match of source.matchAll(rawSql)) {
      const table = (match[1] as string).toLowerCase();
      if (RLS_TENANT_TABLES.includes(table)) sites.set(`${rel}::${table}`, { file: rel, table });
    }
    if (SINGLETON_CALL.test(source)) sites.set(`${rel}::*`, { file: rel, table: '*' });
    SINGLETON_CALL.lastIndex = 0;
  }

  return [...sites.values()].sort((a, b) => `${a.file}${a.table}`.localeCompare(`${b.file}${b.table}`));
}

export interface DbAccessGuardReport {
  /** Sites found by the scan that the registry does not list. Any entry fails the build. */
  readonly unregistered: DbAccessSite[];
  /** Registry entries whose site no longer exists. Any entry fails the build. */
  readonly stale: RegisteredDbAccess[];
  /** Registered `control-plane`/`migration-ddl` entries with no justification. */
  readonly unjustified: RegisteredDbAccess[];
  readonly counts: Record<DbAccessClass, number>;
}

export function evaluateDbAccessGuard(
  scanned: readonly DbAccessSite[],
  registry: readonly RegisteredDbAccess[] = REGISTERED_DB_ACCESS,
): DbAccessGuardReport {
  const key = (site: DbAccessSite): string => `${site.file}::${site.table}`;
  const registered = new Map(registry.map((entry) => [key(entry), entry]));
  const found = new Set(scanned.map(key));

  const unregistered = scanned.filter((site) => !registered.has(key(site)));
  const stale = registry.filter((entry) => !found.has(key(entry)));
  const unjustified = registry.filter(
    (entry) =>
      (entry.class === 'control-plane' || entry.class === 'migration-ddl') &&
      (entry.justification ?? '').trim().length === 0,
  );

  const counts: Record<DbAccessClass, number> = {
    'tenant-boundary': 0,
    'control-plane': 0,
    'migration-ddl': 0,
    'pending-G4-conversion': 0,
  };
  for (const entry of registry) counts[entry.class] += 1;

  return { unregistered, stale, unjustified, counts };
}

/**
 * Classification the generator applies to a site it has never seen.
 *
 * Only two exemption classes are granted automatically, and both are decided by
 * WHERE the file lives rather than by what it does — a location is a fact, an
 * intent is a claim:
 *
 *   * `migration-ddl` — the `scripts/` directories and the migration/schema
 *     modules. These run under the DDL identity from an operator's shell, never
 *     inside a request, and the runtime role cannot execute them at all in
 *     enforcement mode.
 *   * `control-plane` — the ADR-0003 auth plane, the ADR-0005 platform
 *     lifecycle services, and process startup. These run BEFORE a tenant
 *     context exists, which is the definition of the class.
 *
 * Everything else defaults to `pending-G4-conversion`, including the CLI and
 * the channel plugins. That is deliberate: an operator CLI writing tenant rows
 * outside the boundary is real debt, and calling it "control-plane" because it
 * is convenient would be exactly the silent exemption this guard exists to
 * prevent.
 */
export function defaultClassFor(site: DbAccessSite): { class: DbAccessClass; justification?: string } {
  if (
    site.file.includes('/scripts/') ||
    site.file === 'packages/db/src/migrate.ts' ||
    site.file === 'packages/db/src/online-ddl.ts' ||
    site.file === 'packages/db/src/verify-schema.ts'
  ) {
    return {
      class: 'migration-ddl',
      justification:
        'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never ' +
        'from a request; the runtime role holds no privilege it needs.',
    };
  }

  const CONTROL_PLANE: Record<string, string> = {
    'packages/api/src/services/auth-bootstrap.ts':
      'ADR-0003 isolated auth plane. Runs BEFORE a tenant context exists — it is what establishes one. Under ' +
      'enforcement it connects as the auth-plane role, which is the only identity granted SELECT on the ' +
      'credential index.',
    'packages/api/src/services/tenant-control-plane.ts':
      'ADR-0005 platform tenant lifecycle (create/suspend/archive, membership attach/detach). Operates on the ' +
      'control plane itself, not on tenant business data.',
    'packages/api/src/services/tenant-keys.ts':
      'ADR-0003 child-key creation. Crosses into the auth plane through a transactionally enforced service ' +
      'boundary with actor freshness re-validated under row locks (transactional-auth.ts).',
    'packages/api/src/tenancy/request-auth.ts':
      'ADR-0003 auth-plane membership re-validation at tenant-selection time. Pre-context by definition.',
    'packages/api/src/index.ts':
      'Process startup: migrate-on-boot, schema-drift verification, and the boot banner. WISH "Public and ' +
      'bootstrap surfaces" classifies startup as a control-plane operation with an explicit credential class.',
  };
  const justification = CONTROL_PLANE[site.file];
  if (justification) return { class: 'control-plane', justification };

  if (site.file === 'packages/api/src/tenancy/tenant-repository.ts') {
    return { class: 'tenant-boundary' };
  }
  if (site.file === 'packages/api/src/tenancy/platform-target-tenant.ts') {
    return { class: 'tenant-boundary' };
  }

  return { class: 'pending-G4-conversion' };
}

/**
 * Ceiling for the `pending-G4-conversion` class, fixed at the end of G3.
 *
 * The guard fails when the count EXCEEDS this. It does not fail when the count
 * falls: G4's job is to drive it toward zero, and every conversion should be
 * able to land without also editing this constant. When G4 lowers it, lower the
 * ceiling with it so the ratchet keeps its grip.
 */
export const PENDING_G4_CEILING = 73;

/**
 * Committed inventory of every database access site in the repository.
 *
 * Generated by `bun run packages/db/scripts/check-db-access.ts --write` and
 * classified by hand. Adding a site without classifying it is a test failure —
 * that is the entire point.
 */
export const REGISTERED_DB_ACCESS: readonly RegisteredDbAccess[] = [
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: 'access_rules',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: 'agent_routes',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: 'chat_participants',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: 'messages',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: 'omni_events',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: 'persons',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/fix-person-duplicates.ts',
    table: 'platform_identities',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/migrate-events-to-messages.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/migrate-events-to-messages.ts',
    table: 'chat_participants',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/migrate-events-to-messages.ts',
    table: 'chats',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/migrate-events-to-messages.ts',
    table: 'messages',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/scripts/migrate-events-to-messages.ts',
    table: 'omni_events',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/api/src/index.ts',
    table: '*',
    class: 'control-plane',
    justification:
      'Process startup: migrate-on-boot, schema-drift verification, and the boot banner. WISH "Public and bootstrap surfaces" classifies startup as a control-plane operation with an explicit credential class.',
  },
  {
    file: 'packages/api/src/index.ts',
    table: 'agents',
    class: 'control-plane',
    justification:
      'Process startup: migrate-on-boot, schema-drift verification, and the boot banner. WISH "Public and bootstrap surfaces" classifies startup as a control-plane operation with an explicit credential class.',
  },
  {
    file: 'packages/api/src/index.ts',
    table: 'instances',
    class: 'control-plane',
    justification:
      'Process startup: migrate-on-boot, schema-drift verification, and the boot banner. WISH "Public and bootstrap surfaces" classifies startup as a control-plane operation with an explicit credential class.',
  },
  {
    file: 'packages/api/src/lib/idempotency.ts',
    table: 'processed_events',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'agent_sessions',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'agents',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'handoff_logs',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/event-listeners.ts',
    table: 'chat_id_mappings',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/event-listeners.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/event-listeners.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/event-persistence.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/event-persistence.ts',
    table: 'omni_events',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/instance-monitor.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/media-processor.ts',
    table: 'media_content',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/media-processor.ts',
    table: 'messages',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/media-processor.ts',
    table: 'omni_events',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/session-cleaner.ts',
    table: 'agents',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/session-cleaner.ts',
    table: 'chat_participants',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/session-storage.ts',
    table: 'agent_sessions',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/sync-worker.ts',
    table: 'messages',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/plugins/sync-worker.ts',
    table: 'omni_groups',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/routes/health.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/routes/v2/handoffs.ts',
    table: 'handoff_logs',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/routes/v2/instances.ts',
    table: 'platform_identities',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/routes/v2/messages.ts',
    table: 'close_contact_logs',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/routes/v2/messages.ts',
    table: 'handoff_logs',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/access.ts',
    table: 'access_rules',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/access.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/agent-replay.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/agent-replay.ts',
    table: 'messages',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/agent-runner.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/agent-runner.ts',
    table: 'persons',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/agent-tasks.ts',
    table: 'agent_tasks',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/agents.ts',
    table: 'agents',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/agents.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/auth-bootstrap.ts',
    table: 'tenant_key_lineage',
    class: 'control-plane',
    justification:
      'ADR-0003 isolated auth plane. Runs BEFORE a tenant context exists — it is what establishes one. Under enforcement it connects as the auth-plane role, which is the only identity granted SELECT on the credential index.',
  },
  {
    file: 'packages/api/src/services/auth-bootstrap.ts',
    table: 'tenant_memberships',
    class: 'control-plane',
    justification:
      'ADR-0003 isolated auth plane. Runs BEFORE a tenant context exists — it is what establishes one. Under enforcement it connects as the auth-plane role, which is the only identity granted SELECT on the credential index.',
  },
  {
    file: 'packages/api/src/services/automations.ts',
    table: 'automation_logs',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/automations.ts',
    table: 'automations',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/batch-jobs.ts',
    table: 'batch_jobs',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/batch-jobs.ts',
    table: 'media_content',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/batch-jobs.ts',
    table: 'messages',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'chat_id_mappings',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'chat_participants',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'omni_groups',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/conversations.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/conversations.ts',
    table: 'conversations',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/dead-letters.ts',
    table: 'dead_letter_events',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/event-ops.ts',
    table: 'omni_events',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/events.ts',
    table: 'omni_events',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'agents',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'chat_follow_up_state',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/follow-up-sweeper.ts',
    table: 'chat_follow_up_state',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/instances.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/media-storage.ts',
    table: 'messages',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/messages.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/messages.ts',
    table: 'messages',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/payload-store.ts',
    table: 'event_payloads',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/persons.ts',
    table: 'chat_id_mappings',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/persons.ts',
    table: 'persons',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/persons.ts',
    table: 'platform_identities',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/route-resolver.ts',
    table: 'agent_routes',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/routes.ts',
    table: 'agent_routes',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/sync-jobs.ts',
    table: 'sync_jobs',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/tenant-control-plane.ts',
    table: 'tenant_memberships',
    class: 'control-plane',
    justification:
      'ADR-0005 platform tenant lifecycle (create/suspend/archive, membership attach/detach). Operates on the control plane itself, not on tenant business data.',
  },
  {
    file: 'packages/api/src/services/tenant-keys.ts',
    table: 'tenant_audit_logs',
    class: 'control-plane',
    justification:
      'ADR-0003 child-key creation. Crosses into the auth plane through a transactionally enforced service boundary with actor freshness re-validated under row locks (transactional-auth.ts).',
  },
  {
    file: 'packages/api/src/services/tenant-keys.ts',
    table: 'tenant_key_lineage',
    class: 'control-plane',
    justification:
      'ADR-0003 child-key creation. Crosses into the auth plane through a transactionally enforced service boundary with actor freshness re-validated under row locks (transactional-auth.ts).',
  },
  {
    file: 'packages/api/src/services/tenant-keys.ts',
    table: 'tenant_memberships',
    class: 'control-plane',
    justification:
      'ADR-0003 child-key creation. Crosses into the auth plane through a transactionally enforced service boundary with actor freshness re-validated under row locks (transactional-auth.ts).',
  },
  {
    file: 'packages/api/src/services/turns.ts',
    table: 'turns',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/services/webhooks.ts',
    table: 'webhook_sources',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/api/src/tenancy/platform-target-tenant.ts',
    table: 'tenant_audit_logs',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/tenancy/request-auth.ts',
    table: 'tenant_memberships',
    class: 'control-plane',
    justification: 'ADR-0003 auth-plane membership re-validation at tenant-selection time. Pre-context by definition.',
  },
  {
    file: 'packages/api/src/tenancy/tenant-repository.ts',
    table: 'chats',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/tenancy/tenant-repository.ts',
    table: 'instances',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/channel-a2a/src/agent-card.ts',
    table: 'agents',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/channel-discord/src/senders/reaction.ts',
    table: 'messages',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/channel-whatsapp/src/plugin.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/cli/src/commands/channels.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/cli/src/commands/completions.ts',
    table: 'chats',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/cli/src/commands/completions.ts',
    table: 'instances',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/cli/src/commands/completions.ts',
    table: 'persons',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/cli/src/commands/keys.ts',
    table: '*',
    class: 'pending-G4-conversion',
  },
  {
    file: 'packages/db/scripts/backfill-chat-names.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-chat-names.ts',
    table: 'chat_participants',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-chat-names.ts',
    table: 'chats',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-conversations.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-conversations.ts',
    table: 'chats',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-conversations.ts',
    table: 'conversations',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-participant-identities.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-participant-identities.ts',
    table: 'chat_participants',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-participant-identities.ts',
    table: 'chats',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/backfill-participant-identities.ts',
    table: 'platform_identities',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/consolidate-lid-chats.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/consolidate-lid-chats.ts',
    table: 'agent_routes',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/consolidate-lid-chats.ts',
    table: 'chat_participants',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/consolidate-lid-chats.ts',
    table: 'chats',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/scripts/consolidate-lid-chats.ts',
    table: 'messages',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/src/migrate.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
];
