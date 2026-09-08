/**
 * Writer coverage for the 29 G2 tenant tables
 * (wish: omni-full-multitenancy, Group G2).
 *
 * G2 requires that EVERY writer to a tenant-owned table is inventoried and that
 * none is silently exempt from ownership propagation. This module is the
 * machine-checkable half of that requirement: it scans the repository for write
 * sites and reconciles them against the committed registry below.
 *
 * `tenancy-writer-coverage.test.ts` fails when:
 *   * a write site exists that the registry does not list (a NEW writer landed
 *     without an ownership decision), or
 *   * the registry lists a write site that no longer exists (stale entry), or
 *   * a registered writer's table has no ownership-propagation mechanism.
 *
 * HOW EVERY WRITER IS COVERED
 * ---------------------------
 * Propagation lives in the database, not in the 168 call sites. Migration 0041
 * installs a BEFORE INSERT trigger on all 28 non-root tenant tables:
 *
 *   * `derived` tables resolve ownership from their FK-covered parents;
 *   * `unowned` tables force `tenant_id` to NULL, because G0 authorises no
 *     ownership source for them in G2;
 *   * `instances`, the single ownership root, has no trigger — its tenant id
 *     comes from an auth-plane context through `tenancy-dual-write.ts`.
 *
 * So coverage is STRUCTURAL: a writer cannot opt out, and a writer added
 * tomorrow is covered the moment it inserts. The registry exists so that the
 * inventory stays honest and a new write site is a reviewed event rather than a
 * silent one.
 *
 * Registry entries are keyed by (file, table) rather than by line number so that
 * unrelated edits do not churn them.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TENANT_OWNERSHIP_SPECS, getOwnershipSpec } from './tenancy-ownership';

/** Drizzle export name -> SQL table name, for the 29 tenant tables. @public */
export const DRIZZLE_TO_TABLE: ReadonlyMap<string, string> = new Map(
  TENANT_OWNERSHIP_SPECS.map((s) => [s.drizzle, s.table]),
);

export interface WriteSite {
  /** Repository-relative path. */
  readonly file: string;
  /** SQL table name. */
  readonly table: string;
}

export type WriterCoverage =
  /** Ownership derived in-database from FK-covered parents (0041 trigger). */
  | 'db-derived'
  /** Ownership forced NULL in-database: G0 authorises no source for this table in G2. */
  | 'db-unowned'
  /** Ownership root: trusted auth-plane context via tenancy-dual-write.ts. */
  | 'trusted-root';

export interface RegisteredWriter extends WriteSite {
  readonly coverage: WriterCoverage;
}

/** Directories excluded from the scan. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '__tests__', 'coverage']);

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

/**
 * Scan `packagesDir` for Drizzle writes to any of the 29 tenant tables.
 *
 * Matches `.insert(<table>` and `.update(<table>` — the only two write verbs the
 * Drizzle query builder exposes, and the two the G2 writer inventory found in
 * use. Raw SQL writes are matched separately so a future one cannot slip past.
 */
export function scanWriteSites(packagesDir: string, repoRoot: string): WriteSite[] {
  const files: string[] = [];
  walk(packagesDir, files);

  const sites = new Map<string, WriteSite>();
  const drizzleNames = [...DRIZZLE_TO_TABLE.keys()];
  const builder = new RegExp(`\\.(?:insert|update)\\(\\s*(${drizzleNames.join('|')})\\s*[),]`, 'g');
  const rawSql = new RegExp(
    `(?:insert\\s+into|update)\\s+"?(${TENANT_OWNERSHIP_SPECS.map((s) => s.table).join('|')})"?\\b`,
    'gi',
  );

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const rel = relative(repoRoot, file);

    for (const match of source.matchAll(builder)) {
      const table = DRIZZLE_TO_TABLE.get(match[1] as string);
      if (table) sites.set(`${rel}::${table}`, { file: rel, table });
    }
    for (const match of source.matchAll(rawSql)) {
      const table = (match[1] as string).toLowerCase();
      if (getOwnershipSpec(table)) sites.set(`${rel}::${table}`, { file: rel, table });
    }
  }

  return [...sites.values()].sort((a, b) => `${a.file}${a.table}`.localeCompare(`${b.file}${b.table}`));
}

/** Coverage mechanism implied by a table's ownership class. */
export function coverageFor(table: string): WriterCoverage {
  const spec = getOwnershipSpec(table);
  if (!spec) throw new Error(`${table} is not a G2 tenant table`);
  if (spec.derivation === 'root') return 'trusted-root';
  return spec.derivation === 'derived' ? 'db-derived' : 'db-unowned';
}

/**
 * Committed inventory of every non-test write site against the 29 tenant tables.
 *
 * Generated by `bun run scripts/check-writer-coverage.ts --write` and reviewed by
 * hand. Adding a write site to a tenant table WITHOUT updating this list is a
 * test failure, by design: it forces the ownership question to be answered.
 */
export const REGISTERED_WRITERS: readonly RegisteredWriter[] = [
  { file: 'packages/api/scripts/fix-person-duplicates.ts', table: 'access_rules', coverage: 'db-derived' },
  { file: 'packages/api/scripts/fix-person-duplicates.ts', table: 'agent_routes', coverage: 'db-derived' },
  { file: 'packages/api/scripts/fix-person-duplicates.ts', table: 'chat_participants', coverage: 'db-derived' },
  { file: 'packages/api/scripts/fix-person-duplicates.ts', table: 'messages', coverage: 'db-derived' },
  { file: 'packages/api/scripts/fix-person-duplicates.ts', table: 'omni_events', coverage: 'db-derived' },
  { file: 'packages/api/scripts/fix-person-duplicates.ts', table: 'persons', coverage: 'db-unowned' },
  { file: 'packages/api/scripts/fix-person-duplicates.ts', table: 'platform_identities', coverage: 'db-derived' },
  { file: 'packages/api/scripts/migrate-events-to-messages.ts', table: 'chat_participants', coverage: 'db-derived' },
  { file: 'packages/api/scripts/migrate-events-to-messages.ts', table: 'chats', coverage: 'db-derived' },
  { file: 'packages/api/scripts/migrate-events-to-messages.ts', table: 'messages', coverage: 'db-derived' },
  {
    file: 'packages/api/scripts/reconcile-identity-fragmentation.ts',
    table: 'chat_participants',
    coverage: 'db-derived',
  },
  { file: 'packages/api/scripts/reconcile-identity-fragmentation.ts', table: 'messages', coverage: 'db-derived' },
  { file: 'packages/api/scripts/reconcile-identity-fragmentation.ts', table: 'omni_events', coverage: 'db-derived' },
  { file: 'packages/api/scripts/reconcile-identity-fragmentation.ts', table: 'persons', coverage: 'db-unowned' },
  {
    file: 'packages/api/scripts/reconcile-identity-fragmentation.ts',
    table: 'platform_identities',
    coverage: 'db-derived',
  },
  { file: 'packages/api/src/lib/idempotency.ts', table: 'processed_events', coverage: 'db-unowned' },
  { file: 'packages/api/src/plugins/agent-dispatcher.ts', table: 'agent_sessions', coverage: 'db-derived' },
  // #958: emit_event idempotency claim — the journal row IS the claim.
  { file: 'packages/api/src/plugins/automation-actions.ts', table: 'omni_events', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/agent-dispatcher.ts', table: 'handoff_logs', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/event-listeners.ts', table: 'chat_id_mappings', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/event-listeners.ts', table: 'chats', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/event-listeners.ts', table: 'instances', coverage: 'trusted-root' },
  { file: 'packages/api/src/plugins/event-persistence.ts', table: 'omni_events', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/instance-monitor.ts', table: 'instances', coverage: 'trusted-root' },
  { file: 'packages/api/src/plugins/media-processor.ts', table: 'media_content', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/media-processor.ts', table: 'messages', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/session-storage.ts', table: 'agent_sessions', coverage: 'db-derived' },
  { file: 'packages/api/src/plugins/sync-worker.ts', table: 'omni_groups', coverage: 'db-derived' },
  { file: 'packages/api/src/routes/v2/messages.ts', table: 'close_contact_logs', coverage: 'db-derived' },
  { file: 'packages/api/src/routes/v2/messages.ts', table: 'handoff_logs', coverage: 'db-derived' },
  { file: 'packages/api/src/services/access.ts', table: 'access_rules', coverage: 'db-derived' },
  { file: 'packages/api/src/services/agent-replay.ts', table: 'instances', coverage: 'trusted-root' },
  { file: 'packages/api/src/services/agent-tasks.ts', table: 'agent_tasks', coverage: 'db-derived' },
  { file: 'packages/api/src/services/agents.ts', table: 'agents', coverage: 'db-derived' },
  { file: 'packages/api/src/services/automations.ts', table: 'automation_logs', coverage: 'db-derived' },
  { file: 'packages/api/src/services/automations.ts', table: 'automations', coverage: 'db-unowned' },
  { file: 'packages/api/src/services/batch-jobs.ts', table: 'batch_jobs', coverage: 'db-derived' },
  { file: 'packages/api/src/services/batch-jobs.ts', table: 'media_content', coverage: 'db-derived' },
  { file: 'packages/api/src/services/batch-jobs.ts', table: 'messages', coverage: 'db-derived' },
  { file: 'packages/api/src/services/chats.ts', table: 'chat_id_mappings', coverage: 'db-derived' },
  { file: 'packages/api/src/services/chats.ts', table: 'chat_participants', coverage: 'db-derived' },
  { file: 'packages/api/src/services/chats.ts', table: 'chats', coverage: 'db-derived' },
  { file: 'packages/api/src/services/conversations.ts', table: 'conversations', coverage: 'db-unowned' },
  { file: 'packages/api/src/services/dead-letters.ts', table: 'dead_letter_events', coverage: 'db-unowned' },
  { file: 'packages/api/src/services/follow-up-lifecycle.ts', table: 'chat_follow_up_state', coverage: 'db-derived' },
  { file: 'packages/api/src/services/follow-up-sweeper.ts', table: 'chat_follow_up_state', coverage: 'db-derived' },
  { file: 'packages/api/src/services/instances.ts', table: 'instances', coverage: 'trusted-root' },
  { file: 'packages/api/src/services/media-storage.ts', table: 'messages', coverage: 'db-derived' },
  { file: 'packages/api/src/services/messages.ts', table: 'chats', coverage: 'db-derived' },
  { file: 'packages/api/src/services/messages.ts', table: 'messages', coverage: 'db-derived' },
  { file: 'packages/api/src/services/payload-store.ts', table: 'event_payloads', coverage: 'db-unowned' },
  { file: 'packages/api/src/services/persons.ts', table: 'persons', coverage: 'db-unowned' },
  { file: 'packages/api/src/services/persons.ts', table: 'platform_identities', coverage: 'db-derived' },
  { file: 'packages/api/src/services/routes.ts', table: 'agent_routes', coverage: 'db-derived' },
  { file: 'packages/api/src/services/sync-jobs.ts', table: 'sync_jobs', coverage: 'db-derived' },
  { file: 'packages/api/src/services/turns.ts', table: 'turns', coverage: 'db-derived' },
  // #958: webhook ingress idempotency claim — the journal row IS the claim.
  { file: 'packages/api/src/services/webhooks.ts', table: 'omni_events', coverage: 'db-derived' },
  { file: 'packages/api/src/services/webhooks.ts', table: 'webhook_sources', coverage: 'db-unowned' },
  { file: 'packages/api/src/tenancy/tenant-repository.ts', table: 'instances', coverage: 'trusted-root' },
  { file: 'packages/db/scripts/backfill-chat-names.ts', table: 'chats', coverage: 'db-derived' },
  { file: 'packages/db/scripts/backfill-conversations.ts', table: 'chats', coverage: 'db-derived' },
  { file: 'packages/db/scripts/backfill-conversations.ts', table: 'conversations', coverage: 'db-unowned' },
  {
    file: 'packages/db/scripts/backfill-participant-identities.ts',
    table: 'chat_participants',
    coverage: 'db-derived',
  },
  { file: 'packages/db/scripts/consolidate-lid-chats.ts', table: 'agent_routes', coverage: 'db-derived' },
  { file: 'packages/db/scripts/consolidate-lid-chats.ts', table: 'chat_participants', coverage: 'db-derived' },
  { file: 'packages/db/scripts/consolidate-lid-chats.ts', table: 'chats', coverage: 'db-derived' },
  { file: 'packages/db/scripts/consolidate-lid-chats.ts', table: 'messages', coverage: 'db-derived' },
];
