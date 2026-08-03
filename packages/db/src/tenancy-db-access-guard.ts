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
 * THE FIVE CLASSES
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
 *   * `pending-G5-conversion` — sites whose remaining unscoped caller has NO
 *     HTTP request context to take a tenant from: a NATS/eventBus consumer, a
 *     cron or `setInterval` loop, a plugin lifecycle hook, or a storage path
 *     reached only from one of those. Establishing a tenant for these requires
 *     the async/worker context semantics G5 owns (ADR-0008), so they cannot be
 *     closed here. This class is NOT a quieter synonym for "unconverted": a
 *     site belongs here only when the async mechanism is NAMED in its
 *     justification, and like its G4 sibling it exists to shrink, under its own
 *     ceiling.
 *
 * A note on the two `pending-*` classes and dual-caller sites: several services
 * are called BOTH from a route and from a consumer. Converting the route path
 * does not make such a site converted — its worker caller still reaches the
 * ambient pool — so it is classified `pending-G5-conversion`, not
 * `tenant-boundary`. Only a site whose every caller carries a request context
 * earns `tenant-boundary`.
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
import { RLS_EXCLUSIONS, RLS_TENANT_TABLES, type RlsExclusion } from './tenancy-rls';

export type DbAccessClass =
  | 'tenant-boundary'
  | 'control-plane'
  | 'migration-ddl'
  | 'pending-G4-conversion'
  | 'pending-G5-conversion';

export interface DbAccessSite {
  /** Repository-relative path. */
  readonly file: string;
  /** SQL table name, or `*` for a bare pool/singleton acquisition. */
  readonly table: string;
}

export interface RegisteredDbAccess extends DbAccessSite {
  readonly class: DbAccessClass;
  /**
   * Required for `control-plane` and `migration-ddl` (why no tenant context
   * applies) and for `pending-G5-conversion` (which async mechanism owns the
   * remaining unscoped caller).
   */
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

/** Drizzle export name -> SQL table for every RLS-covered table; operator tooling surface. @public */
export const RLS_DRIZZLE_TO_TABLE: ReadonlyMap<string, string> = new Map(
  RLS_TENANT_TABLES.map((table) => [drizzleNameFor(table), table]),
);

/**
 * Bare pool/singleton acquisition. Recorded against table `*`.
 *
 * `createDbHandle` was added by G3 (independent, individually closable pools)
 * and originally escaped this regex — a guard losing coverage to a new
 * primitive is precisely the failure mode it exists to prevent, so it is named
 * explicitly here rather than matched by a loose prefix (G3 review finding L2).
 */
const SINGLETON_CALL = /\b(?:getDb|createDb|createDbHandle|createPostgresClient)\s*\(/g;

/**
 * Verbatim mirror of `RLS_EXCLUSIONS` from `tenancy-rls.ts`.
 *
 * Those three tables carry a `tenant_id` and are deliberately NOT tenant-RLS
 * tables, so the scanner above never sees them and this registry would
 * otherwise be silently incomplete as an answer to "who may touch the
 * database". The mirror is re-exported rather than re-worded, and the guard
 * test asserts deep equality against the source list, so the two cannot drift
 * (G3 review finding L4).
 */
export const MIRRORED_RLS_EXCLUSIONS: readonly RlsExclusion[] = RLS_EXCLUSIONS;

/**
 * Blank out `//` and block comments, preserving offsets and newlines.
 *
 * The raw-SQL pattern below looks for English-shaped SQL (`FROM chats`), and
 * English prose is shaped exactly the same way: "sourced from chats.upsert",
 * "removing reactions from messages", "no name from platform_identities". Eight
 * entries in the registry were comments rather than queries — phantom debt that
 * made the conversion backlog look larger than it was, which is its own kind of
 * dishonesty in a number this group reports on.
 *
 * STRINGS ARE DELIBERATELY NOT STRIPPED. Real raw SQL lives in template
 * literals, so removing strings would trade a precision bug for a recall bug,
 * and a guard that misses a real query is far worse than one that over-reports.
 * String false positives are handled by requiring a word boundary instead.
 *
 * Replacement preserves length so any future line-numbered diagnostic still
 * points at the right place.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

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
  // The leading `\b` is load-bearing: without it, `__fish_seen_subcommand_from
  // instances` in the CLI's shell-completion script matched as `FROM instances`
  // and booked three phantom sites against `packages/cli/src/commands/
  // completions.ts`, a file with no database import at all.
  const rawSql = new RegExp(
    `\\b(?:from|insert\\s+into|update|delete\\s+from)\\s+"?(${RLS_TENANT_TABLES.join('|')})"?\\b`,
    'gi',
  );

  const sites = new Map<string, DbAccessSite>();
  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (SKIP_FILES.has(rel)) continue;
    const source = stripComments(readFileSync(file, 'utf-8'));

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
  // `pending-G5-conversion` is held to the same standard as an exemption class:
  // deferring a site to G5 is a CLAIM that no request context can reach it, and
  // an unjustified claim is how a synchronous site would hide from this group.
  const unjustified = registry.filter(
    (entry) =>
      (entry.class === 'control-plane' || entry.class === 'migration-ddl' || entry.class === 'pending-G5-conversion') &&
      (entry.justification ?? '').trim().length === 0,
  );

  const counts: Record<DbAccessClass, number> = {
    'tenant-boundary': 0,
    'control-plane': 0,
    'migration-ddl': 0,
    'pending-G4-conversion': 0,
    'pending-G5-conversion': 0,
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
    'packages/api/src/tenancy/auth-plane-connection.ts':
      'ADR-0003 isolated auth plane. Opens the auth-plane ROLE\u2019s own pool under enforcement so the credential ' +
      'index and the pre-context membership re-validation are read on an identity that may read them; returns the ' +
      'runtime handle unchanged in legacy mode. Pre-context by definition.',
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
 * Ceiling for the `pending-G4-conversion` class, fixed at the end of G3 and
 * ratcheted down by each G4 leg: 73 at the end of G3, 72 after the leg-1
 * public-surface privacy fix removed the unauthenticated instance-count
 * aggregation from `routes/health.ts`, 24 after leg 2 converted the synchronous
 * service surface, 20 once leg 2's review settled, and 6 after leg 3.
 *
 * Leg 3 removed 14, and it matters HOW, because only five of those were a
 * judgement call:
 *   * 8 were never database access at all. The raw-SQL pattern was reading
 *     comments and had no leading word boundary, so English prose ("sourced
 *     from chats.upsert") and a shell-completion string
 *     ("__fish_seen_subcommand_from instances") scanned as queries. Leg 2 had
 *     already diagnosed these and recorded the fix as "make the scanner
 *     comment-aware, not reclassify"; `stripComments` did that. The same
 *     correction also retired a phantom site that had been counted as
 *     `tenant-boundary`, so the fix cost a converted point as well as removing
 *     debt — which is the evidence that it was a correction and not a shortcut.
 *   * 5 moved to `pending-G5-conversion` on traced evidence that every
 *     remaining caller is a NATS consumer or a cron/interval, with the call
 *     sites named in each justification. In all five cases a SIBLING site in
 *     the same file was already deferred for those same callers.
 *   * 1 (`cli/src/commands/keys.ts`) became `control-plane` — the auth-plane
 *     bootstrap, on the WISH's operator-surface grounds.
 *
 * The 6 that remain are one coherent group, not a miscellany: every one is a
 * site on a table G2 classifies as `unowned` (automations, conversations,
 * dead_letter_events, event_payloads, persons, webhook_sources). Their blocker
 * is the G6 ownership backfill — `tenant_id` stays NULL until G6 decides
 * ownership — so they are NOT convertible by G4 and NOT deferrable to G5
 * either, since several have perfectly good request contexts. Forcing them into
 * a class that reads as "async work" to make this number reach zero would be
 * exactly the dishonesty the class exists to prevent. They stay here, named, as
 * the G4 handoff's open item.
 *
 * The guard fails when the count EXCEEDS this. It does not fail when the count
 * falls: G4's job is to drive it toward zero, and every conversion should be
 * able to land without also editing this constant. When G4 lowers it, lower the
 * ceiling with it so the ratchet keeps its grip.
 */
export const PENDING_G4_CEILING = 7;

/**
 * Ceiling for the `pending-G5-conversion` class.
 *
 * Opened by G4 at 43, in two groups:
 *
 *   * 22 sites whose ONLY caller is asynchronous — a NATS consumer, a
 *     cron/interval loop, or a worker-constructed storage path. G4 never had a
 *     request to convert.
 *   * 21 sites in services G4 DID convert, whose route path now runs inside the
 *     tenant transaction but which are also called from a consumer or the
 *     scheduler. A site is only as converted as its least-scoped caller, so
 *     these keep a pending class rather than being counted as finished. Their
 *     justifications say so explicitly.
 *
 * The class is a ratchet, not an amnesty. It is capped from the moment it is
 * created so that G4 cannot grow it to make its own number look better, and G5
 * drives it to zero.
 *
 * RAISED TO 48 BY LEG 3, and this is the one number in this file that has ever
 * moved in the wrong direction, so it should be read sceptically.
 *
 * Five sites moved here from `pending-G4-conversion`. Each is on a table G2
 * owns properly (agents, chat_participants, instances, chat_follow_up_state),
 * so none is hiding an ownership problem, and each justification names the
 * consumer or cron call sites by file and line rather than asserting
 * "background". Two are async-ONLY (`agent-runner.ts`'s instance lookup has
 * zero HTTP callers; the dispatcher's `agents` reads sit behind
 * `eventBus.subscribe`), and three are dual-caller sites whose route path leg 2
 * converted but whose consumer path still reaches the ambient pool — which this
 * file's own header rule already classifies as G5, not as converted. In every
 * one of the five, a sibling site in the SAME file was already deferred for the
 * same callers; these were simply missed.
 *
 * The honest check on a raised cap is not the cap itself but the TOTAL, since
 * relabelling moves a site between the two pending classes without changing it.
 * `TOTAL_PENDING_CEILING` below is that check, and it went DOWN.
 *
 * LOWERED TO 46 BY G5 LEG A. The two `event-persistence.ts` sites (`chats`,
 * `omni_events`) converted: their consumer handlers now establish a worker
 * tenant scope from the versioned envelope's trusted tenant
 * (tenancy/worker-tenant-context.ts) and run their DB work through
 * `scopedHandle`, so every caller — the only callers are those NATS consumers —
 * now reaches a tenant transaction. They became `tenant-boundary`.
 *
 * LOWERED TO 43 BY G5 LEG B. The three `media-processor.ts` sites (`media_content`,
 * `messages`, `omni_events`) converted: the `message.received` consumer threads
 * its versioned envelope into `processMessageMedia`, whose DB blocks run inside
 * `runConsumerInTenantContext` + `scopedHandle` while the media download/AI work
 * stays outside the transaction. All three were consumer-only sites, so every
 * caller now reaches a tenant transaction; they became `tenant-boundary`.
 *
 * LOWERED TO 41 BY G5 LEG B pt2. The two `sync-worker.ts` sites (`messages` via
 * `buildWhatsAppAnchors`, `omni_groups` via `upsertSyncedGroup`/`onGuild`)
 * converted: the `sync.started` consumer threads its envelope into each processor,
 * which scopes each DISCRETE per-item DB block through `runConsumerInTenantContext`
 * + `scopedHandle` (never the long `fetchHistory`/`fetchGroups` job). Both tables
 * derive their tenant from the `instances` root, so RLS scopes them; consumer-only
 * callers → `tenant-boundary`. (`session-cleaner.ts`'s `agents`/`chat_participants`
 * were NOT converted this leg: both derive their tenant from `owner_id`/`person_id`
 * -> `persons`, and `persons` is G2-`unowned`, so the fail-closed derivation trigger
 * leaves their `tenant_id` NULL until the G6 `persons` backfill — they stay pending,
 * blocked on G6, see the handoff.)
 *
 * LOWERED TO 39 BY G5 LEG B pt3. The three `event-listeners.ts` sites
 * (`instances` connect/disconnect state, `chat_id_mappings` LID batch, `chats`
 * contact-names/unread) converted: each handler runs its DISCRETE DB block
 * through `runConsumerInTenantContext` + `scopedHandle` (per-item scopes for
 * the batch loops, mirroring their previous per-statement transactions). The
 * one access that could not convert — the CROSS-tenant connection gauge —
 * moved to `connection-gauge.ts` and re-registered pending (+1), so the net is
 * 41 - 3 + 1 = 39 with the un-convertible read still visible as debt.
 *
 * LOWERED TO 36 BY G5 LEG C2. Three of the four `agent-dispatcher.ts` sites
 * (`agent_sessions` per-thread markers, `handoff_logs` audit insert,
 * `instances` self-send enumeration + tenant-keyed cache) converted: each
 * discrete DB block runs through `runDispatchDb` → `runInWorkerTenantScope` +
 * `scopedHandle`, keyed by the envelope-derived `DispatchMetadata.
 * trustedTenantId` stamped at the subscription boundary — never a payload
 * claim. The fourth (`agents`) is converted IN CODE but stays pending: its
 * rows are NULL-tenant until the G6 `persons` backfill and session-cleaner
 * still calls it tenant-less (see its entry).
 *
 * LOWERED TO 35, same leg: the `route-resolver.ts` `agent_routes` site
 * converted — `resolve()` scopes its read from the threaded envelope tenant
 * and tenant-keys its LRU cache. Consumer-only (dispatcher) callers.
 *
 * LOWERED TO 30 BY G5 LEG E. Five sites CONVERTED (not relabelled): the
 * follow-up cluster — `follow-up-lifecycle.ts` (`chat_follow_up_state`, `chats`,
 * `instances`) and `follow-up-sweeper.ts` (`chat_follow_up_state`) — plus
 * `event-ops.ts` (`omni_events`). The lifecycle now scopes every discrete DB
 * block from a caller-threaded trusted tenant (hooks/sweeper/dispatcher/
 * session-cleaner/automation-gate/routes all establish it); the sweeper cron
 * enumerates active tenants on the auth-plane connection and runs per-tenant
 * scoped passes; the event replay executor captures its tenant before detaching
 * and scopes each batch read with dequeue-time revalidation.
 * (`follow-up-lifecycle.ts::agents` stays pending on the G6 persons backfill.)
 *
 * LOWERED TO 26 BY G5 LEG G. Four sites CONVERTED, all in one caller graph — the
 * dispatch/session consumers and the job table they drive:
 * `agent-runner.ts::instances` (the lookup every dispatch path starts from),
 * `session-cleaner.ts::chat_participants`, `session-storage.ts::agent_sessions`
 * (deliverable (g)'s store, now scoped from the loaded instance's persisted
 * ownership), and `sync-jobs.ts::sync_jobs` (every worker caller threads:
 * per-tenant cron fan-out, the `sync.started` consumer, the history-push
 * tracker, the post-reconnect backfill).
 *
 * This leg also closed the PRODUCER gap those conversions depended on, which the
 * registry cannot see and which is worth reading here because it changes what
 * every earlier leg's number MEANS. Channel plugins publish from a socket
 * callback with no request scope, so `BaseChannelPlugin.publishEventInternal`
 * stamped no tenant and every real channel event classified `legacy` — the
 * consumers legs A–E converted were correct and UNREACHABLE for live traffic.
 * `tenancy/instance-owner-registry.ts` supplies the ADR-0008 "loaded resource"
 * derivation (the publish's `instanceId` -> the instance row's persisted
 * `tenant_id`), so those envelopes now carry a trusted tenant and the converted
 * consumers actually enter the tenant world.
 *
 * LOWERED TO 20 BY G5 LEG H — the READ-PATH leg. Six sites CONVERTED across the
 * `chats`/`messages`/`persons` services. The blocker they shared was not the
 * services (scope-aware since G4, via the `private get db()` -> `scopedHandle`
 * getter) but their callers, and specifically the LAST big unconverted consumer
 * plus the read halves of three already-converted ones:
 *
 *   * `message-persistence.ts` — the dominant inbound consumer (every message on
 *     every channel) was wholly unconverted. Its five handlers now wrap their
 *     awaited work in `runConsumerInTenantContext`, and each fire-and-forget
 *     write it spawns (the LID upserts, the chat/instance recency bumps, the
 *     new-identity profile fetch) gets its OWN `runTenantWorkDb` scope rather
 *     than inheriting a transaction that is about to commit — the G4 leg-2
 *     use-after-commit trap, which this handler was the largest instance of.
 *   * `agent-dispatcher.ts` — its WRITE blocks were converted in legs A/C2, but
 *     eight READ helpers still called the services bare. Each now runs through
 *     `runDispatchDb`.
 *   * `media-processor.ts` — same shape; the new local `runMediaDb` wraps its
 *     instance/chat/message reads.
 *   * `sync-worker.ts` — the anchor discovery, DM-rename and contact-identity
 *     reads were outside `inSyncWorkerScope`; they are inside it now.
 *
 * A NOTE ON POLLING, because it is the one place this leg could have been got
 * badly wrong. Four of these paths poll for ANOTHER consumer's commit
 * (`resolvePersonId`, `awaitMediaProcessing`, the media chat/message waits).
 * Wrapping such a poll in ONE transaction would be worse than leaving it
 * unscoped: the snapshot can never contain the row being waited for, so the loop
 * would spin to its deadline every time, and the transaction would outlive its
 * work item. Each poll ATTEMPT therefore opens and closes its own short scope.
 *
 * `persons.ts::platform_identities` did NOT convert, and its entry now says why
 * precisely: every async caller is scoped, and the only thing still holding it
 * is `trpc/router.ts` — a second synchronous edge with no tenant boundary at
 * all. That is G4-surface debt wearing a G5 label; the entry carries it as an
 * open question rather than silently reclassifying it.
 *
 * 12 after run15 (was 20). EIGHT sites were CONVERTED by scoping their callers,
 * not relabelled: `instance-monitor.ts::instances` (health sweep + boot
 * reconnect fanned out, single-row paths registry-derived),
 * `batch-jobs.ts::{batch_jobs,media_content,messages}` (the last unscoped
 * caller, `resumeJobs`, fanned out), `agent-replay.ts::{instances,messages}`
 * (the two fire-and-forget event-listener callers detached and threaded),
 * `access.ts::instances` (traced to a single request-only caller) and
 * `media-storage.ts::messages` (the media-processor download's message write).
 * No site moved between the two pending classes and no new pending site was
 * opened.
 *
 * The REMAINING 12 are the honest floor, and none of them is unconverted G5
 * async work:
 *   * 8 G6-GATED — the table's tenant derives through a G2-`unowned` root, so a
 *     scoped read finds nothing until the G6 backfill:
 *     `idempotency.ts::processed_events`, `agent-runner.ts::persons`,
 *     `automations.ts::automation_logs`, the four `agents` sites
 *     (`agent-dispatcher`, `automation-actions`, `session-cleaner`,
 *     `follow-up-lifecycle`) and `turns.ts::turns`. All are converted IN CODE.
 *   * 4 DECISION-HELD — `connection-gauge.ts::instances` (control-plane
 *     reclassification vs a G8A deployment credential), and
 *     `instances.ts::instances`, `persons.ts::platform_identities` and
 *     `access.ts::access_rules`, each held by `trpc/router.ts` alone.
 *     `access.ts::access_rules` joined this group in run15: its two consumer
 *     callers were converted, and the caller trace then found the tRPC edge.
 */
export const PENDING_G5_CEILING = 12;

/**
 * Ceiling on `pending-G4-conversion` + `pending-G5-conversion` combined.
 *
 * This is the number that cannot be gamed by reclassification, and it is the
 * one to read first. Moving a site from G4 to G5 leaves it untouched; only
 * converting a site, or proving it was never database access, lowers this.
 *
 * 63 at the end of leg 2 (20 + 43). 54 after leg 3 (6 + 48): 8 phantom sites
 * retired by the scanner-precision fix and 1 real site closed as the auth-plane
 * bootstrap. The 5 G4→G5 moves changed it by exactly zero, which is the
 * property that makes them checkable rather than merely argued.
 *
 * 52 after G5 leg A (6 + 46): the two `event-persistence.ts` consumer sites were
 * CONVERTED, not relabelled — the only move that lowers this number.
 *
 * 49 after G5 leg B (6 + 43): the three `media-processor.ts` consumer sites were
 * CONVERTED, not relabelled.
 *
 * 47 after G5 leg B pt2 (6 + 41): the two `sync-worker.ts` consumer sites were
 * CONVERTED, not relabelled.
 *
 * 45 after G5 leg B pt3 (6 + 39): the three `event-listeners.ts` consumer sites
 * were CONVERTED; the cross-tenant connection gauge those handlers also called
 * was split into `connection-gauge.ts` and re-registered pending (+1), so the
 * net -2 is real conversion, not relabelling.
 *
 * 42 after G5 leg C2 (6 + 36): three `agent-dispatcher.ts` consumer sites were
 * CONVERTED, not relabelled (`agents` stays pending on the G6 persons
 * backfill).
 *
 * 41 after the same leg's `route-resolver.ts` conversion (6 + 35).
 *
 * 36 after G5 leg E (6 + 30): the follow-up cluster's four sites and
 * `event-ops.ts`'s `omni_events` were CONVERTED, not relabelled.
 *
 * 32 after G5 leg G (6 + 26): the four dispatch/session/job sites were
 * CONVERTED, not relabelled. No site moved between the two pending classes this
 * leg, and no new pending site was opened.
 *
 * 26 after G5 leg H (6 + 20): the six `chats`/`messages`/`persons` service sites
 * were CONVERTED by scoping their callers, not relabelled. No site moved between
 * the two pending classes this leg, and no new pending site was opened.
 *
 * STILL 26 after G5 leg I (6 + 20), and the flat number deserves scepticism, so
 * here is its anatomy: `chats.ts::chats` was CONVERTED (-1) by scoping its last
 * unscoped caller (the automation-engine callbacks, plus the sync-worker and
 * session-cleaner instance reads along the way), and the callbacks' direct
 * `agents` read — which had been hiding under `index.ts`'s control-plane
 * STARTUP entry since G4 — was extracted to `automation-actions.ts` and
 * honestly registered pending (+1) on the same G6 `agents` gate as the
 * dispatcher and session-cleaner sites. Net zero by count; strictly better by
 * honesty: a consumer read no longer wears a bootstrap exemption.
 *
 * STILL 26 after G5 run14 (6 + 20): that leg shipped deliverable (g) and closed
 * the async side of `instances.ts::instances`, but the site is held by
 * `trpc/router.ts` alone, so nothing could be ratcheted honestly.
 *
 * 18 after G5 run15 (6 + 12): eight sites were CONVERTED by scoping their
 * callers — see PENDING_G5_CEILING for the itemisation and for why the
 * remaining 12 are a floor rather than a backlog. No site moved between the two
 * pending classes this run, and no new pending site was opened.
 */
// 18 after the G4/G5 conversion sweep (6 + 12). 19 after the whatsapp-cloud
// channel landed: its template-status webhook adds ONE genuinely new
// pending-G4 site (a bare getDb() in a credential-less webhook path — see its
// registry entry). Nothing was reclassified; the raise is a real new site in
// a new package, not movement between pending classes.
export const TOTAL_PENDING_CEILING = 19;

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
    table: 'instances',
    class: 'control-plane',
    justification:
      'Process startup: migrate-on-boot, schema-drift verification, and the boot banner. WISH "Public and bootstrap surfaces" classifies startup as a control-plane operation with an explicit credential class.',
  },
  {
    file: 'packages/api/src/lib/idempotency.ts',
    table: 'processed_events',
    class: 'pending-G5-conversion',
    justification:
      'Reached only from an eventBus/NATS consumer callback, which has no HTTP request and therefore no credential ' +
      'to derive a tenant from. Establishing tenant context for a consumer requires the async message-context ' +
      'propagation ADR-0008 assigns to G5.',
  },
  {
    // G5-CONVERTED (leg C2). The per-thread init marker (check/mark pair) runs
    // through `scopedHandle` inside a short worker scope keyed by the
    // envelope-derived `DispatchMetadata.trustedTenantId` (`runDispatchDb`).
    // Consumer-only callers; a legacy envelope runs on the ambient pool
    // byte-identically.
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'agent_sessions',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'agents',
    class: 'pending-G5-conversion',
    justification:
      'CONVERTED IN CODE but honestly still pending. Both accesses — the turn-based agent lookup and ' +
      '`applyAgentFkOverrides` — now run through `scopedHandle` inside a short worker scope from the envelope-derived ' +
      'tenant (`runDispatchDb`), and its NATS-consumer callers all thread that tenant (the `session-cleaner` caller ' +
      'threads it too since its own conversion — the earlier session-cleaner.ts:135 no-tenant clause is closed, ' +
      'run13 accuracy fix). What keeps the class: `agents` itself derives its tenant via owner_id -> persons ' +
      '(G2-unowned), so the derivation trigger leaves every row NULL-tenant until the G6 backfill — a scoped read ' +
      'finds nothing yet. Flips to tenant-boundary when G6 lands; the async mechanism is the ADR-0008 consumer ' +
      'context above.',
  },
  {
    // G5-CONVERTED (leg C2). The error-handoff audit insert
    // (`persistErrorHandoffSideEffects`) runs through `scopedHandle` inside a
    // short worker scope keyed by the envelope-derived tenant; the derivation
    // trigger stamps the tenant from the instance, so a scope aimed at a
    // foreign chat is refused by the WITH CHECK. Consumer-only callers.
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'handoff_logs',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg C2). The self-send-guard enumeration
    // (`listActiveOwnerIdentifiers`) runs scoped under the envelope tenant with
    // a TENANT-KEYED cache (a global cache would serve one tenant's owner
    // identifiers to another inside the TTL); the legacy path keeps the global
    // cache and ambient read byte-identically. Consumer-only caller
    // (`shouldProcessMessage` in the message.received consumer).
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    table: 'instances',
    class: 'tenant-boundary',
  },
  {
    // G5 leg I (run13). The automation engine's `call_agent` callback resolves
    // the agent row directly; it lived inline in `index.ts`, where the scanner
    // filed it under that file's `control-plane` STARTUP entry — a consumer
    // read hiding under a bootstrap exemption. Extracted here, it now runs
    // through `scopedHandle` inside a short worker scope for the tenant the
    // engine threads from the consumed envelope (legacy envelopes read the
    // ambient pool byte-identically), and the engine is its only caller.
    // CONVERTED IN CODE but honestly still pending: `agents` derives its
    // tenant via owner_id -> persons (G2-unowned), so the derivation trigger
    // leaves every row NULL-tenant until the G6 backfill — under enforcement a
    // scoped read finds nothing and `call_agent` fails closed ("Agent not
    // found", proven in automation-actions-two-tenant-postgres.test.ts).
    // Flips to tenant-boundary when G6 lands, same gate as the
    // agent-dispatcher and session-cleaner `agents` sites.
    file: 'packages/api/src/plugins/automation-actions.ts',
    table: 'agents',
    class: 'pending-G5-conversion',
    justification:
      'Converted in code (engine-threaded envelope tenant, scopedHandle worker scope, caller-complete) but the ' +
      '`agents` table derives tenant via owner_id -> persons (G2-unowned): rows stay NULL-tenant until the G6 ' +
      'persons backfill, so a scoped read finds nothing under enforcement. Same G6 gate as the dispatcher and ' +
      'session-cleaner `agents` sites; the async mechanism is the ADR-0008 consumer context.',
  },
  {
    // G5-NEW (leg E, deliverable (e)). The voice WebSocket upgrade runs in
    // `Bun.serve`'s raw `fetch`, BEFORE Hono, so it has no request scope; it
    // resolves the session's instance owner itself inside
    // `runInWorkerTenantScope` for the CREDENTIAL's tenant, reading through
    // `scopedHandle`. Under enforcement RLS decides visibility, so a foreign
    // instance never resolves. Deliberately NOT folded into `index.ts`, whose
    // `instances` site is registered `control-plane` for process startup — a
    // tenant-boundary read must not inherit that exemption.
    file: 'packages/api/src/ws/voice-instance-ownership.ts',
    table: 'instances',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg B pt3). The `custom.lid-mapping.batch` consumer runs
    // each mapping insert through `scopedHandle` inside its own per-item
    // worker scope (`runConsumerInTenantContext`), mirroring the per-statement
    // implicit transactions the loop had before. Consumer-only site, so every
    // caller now reaches a tenant transaction; legacy envelopes run on the
    // ambient pool byte-identically.
    file: 'packages/api/src/plugins/event-listeners.ts',
    table: 'chat_id_mappings',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg B pt3) — see the sibling `chat_id_mappings` entry.
    // The contact-names rename (`updateChatName`) and the unread-count sync
    // both run through `scopedHandle` inside the envelope's worker scope.
    file: 'packages/api/src/plugins/event-listeners.ts',
    table: 'chats',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg B pt3) — see the sibling `chat_id_mappings` entry.
    // The connect/disconnect state updates run through `scopedHandle` inside
    // the envelope's worker scope. The one access that could NOT convert — the
    // cross-tenant connection gauge — moved to `connection-gauge.ts` with its
    // own pending registration below, so it cannot hide behind this site.
    file: 'packages/api/src/plugins/event-listeners.ts',
    table: 'instances',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/plugins/connection-gauge.ts',
    table: 'instances',
    class: 'pending-G5-conversion',
    justification:
      'Called fire-and-forget from the connect/disconnect eventBus consumer handlers in event-listeners.ts, from ' +
      'which it was extracted during the ADR-0008 G5 conversion of that file. It is a platform-wide observability ' +
      'aggregate (active instances per channel, NO tenant labels), so the worker tenant scope those consumers now ' +
      'establish can by definition not compute it, and under RLS enforcement the ambient runtime-role read returns ' +
      'nothing — the gauge needs an observability-plane read credential or a per-tenant emission design. OPEN ' +
      'QUESTION for the orchestrator: control-plane reclassification vs. G8A deployment-scope credential; until ' +
      'decided this stays pending rather than silently reclassified.',
  },
  {
    // G5-CONVERTED. Both handlers now wrap their DB work in
    // `runConsumerInTenantContext` (tenancy/worker-tenant-context.ts): a
    // versioned envelope's trusted tenant opens a fresh worker tenant scope, and
    // `scopedHandle(db)` returns that transaction, so this `chats` lookup is
    // RLS-scoped exactly as a converted route service. A legacy envelope runs on
    // the ambient pool byte-identically; a quarantined one never reaches the
    // handler (subscription.ts rejects it first).
    file: 'packages/api/src/plugins/event-persistence.ts',
    table: 'chats',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED — see the sibling `chats` entry above.
    file: 'packages/api/src/plugins/event-persistence.ts',
    table: 'omni_events',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/plugins/instance-monitor.ts',
    table: 'instances',
    class: 'tenant-boundary',
    justification:
      'CONVERTED (run15). Every path in this file is periodic work with no request, credential or envelope, and each ' +
      'now derives its tenant without one. The two WHOLE-TABLE sweeps — the 30s health check and the once-per-boot ' +
      'reconnectWithPool — adopt runForEachActiveTenantRow (the daily-sync/turn-monitor precedent): the discrete ' +
      "listActive READ runs in each ACTIVE tenant's worker scope, while every plugin getStatus/connect (network work) " +
      'runs outside it. The SINGLE-ROW paths (fetchInstanceById, and the markInstanceInactive DEACTIVATION) derive ' +
      'their tenant from the instance-owner registry — persisted instances.tenant_id this process already loaded, ' +
      "never a caller value — through runTenantWorkDb. Callers: the monitor's own timers plus index.ts, which wires " +
      'services.authPlane.db via setAuthPlane and resolves a short-lived auth-plane handle for the boot reconnect ' +
      '(services do not exist yet at that point). No tRPC caller. All four query sites issue on scopedHandle (the ' +
      'class getter over the injected pool, and scopedHandle(db) in reconnectWithPool) — the run16 fix: opening a ' +
      'worker scope is only half the conversion, because set_config(app.tenant_id) is TRANSACTION-local and a query ' +
      'left on the injected pool takes a different connection that never saw the stamp. Flag-off/no-auth-plane is ' +
      'the pre-G5 single ambient scan. Pinned by plugins/__tests__/instance-monitor-worker-scope.test.ts, whose ' +
      'fake transaction yields a DISTINCT handle so a scope-opened/pool-queried site is visible, and which now also ' +
      'drives reconnectWithPool directly (it previously had no executable coverage anywhere); real-RLS evidence for ' +
      'both sweeps is plugins/__tests__/instance-monitor-two-tenant-postgres.test.ts.',
  },
  {
    // G5-CONVERTED (leg B). The `message.received` consumer now passes its
    // versioned envelope into `processMessageMedia`, whose two DB blocks —
    // `persistProcessingResult` (this `media_content` insert + the `messages`
    // content write) and the error-marker `messages` update — run inside
    // `runConsumerInTenantContext`, so `scopedHandle(ctx.db)` returns the worker
    // transaction and this insert is RLS-scoped. The media download + AI work
    // stay OUTSIDE the transaction (no tx across network I/O). A legacy envelope
    // runs on the ambient pool byte-identically; a quarantined one is refused.
    file: 'packages/api/src/plugins/media-processor.ts',
    table: 'media_content',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg B) — see the sibling `media_content` entry above. Both
    // the success content write and the failure marker go through
    // `scopedHandle(ctx.db)` inside the worker tenant scope.
    file: 'packages/api/src/plugins/media-processor.ts',
    table: 'messages',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg B; refined run6/carry-forward #2). The `media_content` FK
    // existence check (`resolveSafeMediaContentEventId`) reads `omni_events`
    // through `scopedHandle(ctx.db)` inside a worker tenant scope
    // (`runConsumerInTenantContext`), so this stays a tenant-boundary. Run6 moved
    // that read into its OWN short worker scope(s) resolved BEFORE the persist
    // scope, so the <=250ms poll no longer holds the persist transaction open
    // across its sleeps — the read remains scoped (a plain ambient read would
    // regress this to pending AND, under RLS, resolve nothing).
    file: 'packages/api/src/plugins/media-processor.ts',
    table: 'omni_events',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/plugins/session-cleaner.ts',
    table: 'agents',
    class: 'pending-G5-conversion',
    justification:
      '`clearAgentSession` (session-cleaner.ts:97) is reached from the `message.received` NATS consumer registered ' +
      'at :305 AND from `routes/v2/chats.ts:1043`. A site is only as scoped as its least-scoped caller, so the ' +
      'route path being converted does not settle it: the durable `session-cleaner` consumer still reaches this ' +
      'query on the ambient pool, which is the async message-context problem ADR-0008 assigns to G5.',
  },
  {
    // G5-CONVERTED (leg G). `resolveCleanupPersonId`'s participant read runs
    // through `scopedHandle` (extracted as `readChatParticipant`) inside the
    // `runTenantWorkDb` block its callers already threaded — the durable
    // `session-cleaner` consumer threads the envelope tenant, the
    // `routes/v2/chats.ts` caller threads nothing and stays on its own request
    // scope. `chat_participants` derives its tenant from the REQUIRED `chat_id`
    // parent, so it is rooted at `instances` and RLS scopes it; it does NOT wait
    // on the G6 `persons` backfill, even though `person_id` is the column read —
    // the column's VALUE is opaque here, only the ROW's visibility matters.
    file: 'packages/api/src/plugins/session-cleaner.ts',
    table: 'chat_participants',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg G). Every discrete DB block (`getSession`'s lookup plus
    // its staleness deletes, `upsertSession`, `deleteSession`) runs through
    // `runTenantWorkDb` + `scopedHandle` under the tenant the store's
    // `resolveTenantId` returns. The agent-dispatcher — its only production
    // caller — now supplies that resolver from the LOADED instance's persisted
    // `tenantId` (the G2 ownership root), never a payload claim, so the store is
    // scoped for the same instance it is already storing sessions for.
    // `agent_sessions` derives its tenant from the REQUIRED `instances` parent,
    // so a write aimed at another tenant's instance is refused by the WITH CHECK
    // (proven in session-cluster-two-tenant-postgres.test.ts). With no resolver
    // — the legacy shape — no scope opens and the query is byte-identical.
    file: 'packages/api/src/plugins/session-storage.ts',
    table: 'agent_sessions',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg B pt2). The `sync.started` consumer threads its versioned
    // envelope into `processMessageSync`, which scopes the anchor read
    // `buildWhatsAppAnchors` (this `messages` site) through
    // `runConsumerInTenantContext` + `scopedHandle` as a discrete per-item DB
    // block — NOT the long `fetchHistory` job it precedes. Its only callers are
    // that consumer, so every caller now reaches a tenant transaction. `messages`
    // derives its tenant from the `instances` root, so RLS scopes it (proven in
    // sync-worker-two-tenant-postgres.test.ts). Legacy envelope → ambient pool,
    // byte-identical.
    file: 'packages/api/src/plugins/sync-worker.ts',
    table: 'messages',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg B pt2). The per-group/per-guild upsert (`upsertSyncedGroup`
    // and the inline Discord `onGuild` block) now runs inside
    // `runConsumerInTenantContext` + `scopedHandle` — one worker tenant scope per
    // work item, never across the `fetchGroups`/`fetchGuilds` job. `omni_groups`
    // derives its tenant from the required `instances` root, so the insert is
    // RLS-stamped/checked (proven in sync-worker-two-tenant-postgres.test.ts).
    file: 'packages/api/src/plugins/sync-worker.ts',
    table: 'omni_groups',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/routes/v2/handoffs.ts',
    table: 'handoff_logs',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/routes/v2/messages.ts',
    table: 'close_contact_logs',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/routes/v2/messages.ts',
    table: 'handoff_logs',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/access.ts',
    table: 'access_rules',
    class: 'pending-G5-conversion',
    justification:
      'ASYNC SIDE COMPLETE (run15); held pending by a SYNCHRONOUS caller. Both consumer callers are now scoped: ' +
      'agent-dispatcher.ts checkAccessWithFallback (all three checkAccess attempts — primary id, Baileys ' +
      'participantAlt, LID->phone resolvedSenderPhone — plus the fire-and-forget requestPairing) and ' +
      'agent-responder.ts processIncomingMessage, each threading its envelope-derived tenant so the ALLOW/DENY read ' +
      "and the pairing transaction run in the message's world and the access.* publishes stay outside the scope. " +
      'Every Hono route path runs inside the request transaction. What remains is trpc/router.ts — list, getById, ' +
      'create and checkAccess — a second synchronous edge with NO tenant boundary of any kind; giving it one is ' +
      'G4-surface work, not the ADR-0008 async-context work assigned to G5. Held for the SAME open decision as ' +
      'services/instances.ts::instances and services/persons.ts::platform_identities: add the withTenantTransaction ' +
      'edge, or retire the unmounted export. Not reclassified unilaterally — an unmounted export is still callable ' +
      "by an out-of-repo consumer. NOTE: run15's prompt listed this site as still-convertible; the caller trace " +
      'found the tRPC edge and it is reported as a decision-held site rather than ratcheted to fit. Async side ' +
      'pinned by services/__tests__/access-worker-scope.test.ts for the SERVICE contract and by ' +
      'plugins/__tests__/agent-dispatcher-access-callsite-scope.test.ts for the CALL SITES — the second was added ' +
      'in run16 because the first, which invokes checkAccess/requestPairing with a literal tenant, stayed green ' +
      'when the threaded argument was deleted from both dispatcher guards (the parameter is optional, so tsc and ' +
      'biome stayed clean too). A caller-threading claim needs a caller-driven probe.',
  },
  {
    file: 'packages/api/src/services/access.ts',
    table: 'instances',
    class: 'tenant-boundary',
    justification:
      "CONVERTED (run15). `instances` is read in this file from exactly ONE place: approvePairingRequest's " +
      'channel-type lookup, used to route the access.pairing_approved subject. Its only caller is ' +
      'routes/v2/instances.ts, mounted on protectedApp behind tenancyMiddleware, so the read runs inside the request ' +
      'tenant transaction. No consumer, no cron and no tRPC procedure reaches it — the sibling access_rules site ' +
      'stays pending precisely because the tRPC router reaches THAT table and not this one (the same per-table ' +
      'distinction that split persons.ts::chat_id_mappings from persons.ts::platform_identities). The generic ' +
      '"called from BOTH a route and a non-request caller" text this entry carried was G3-era boilerplate, not a ' +
      'traced caller. Pinned by services/__tests__/access-worker-scope.test.ts.',
  },
  {
    file: 'packages/api/src/services/agent-replay.ts',
    table: 'instances',
    class: 'tenant-boundary',
    justification:
      'CONVERTED (run15). Two callers. routes/v2/instances.ts drives replayMissedMessages inside the request tenant ' +
      'transaction and threads nothing, so every block stays on that transaction. plugins/event-listeners.ts calls ' +
      'onInstanceConnect / updateLastSeenAt FIRE-AND-FORGET from the instance.connected/disconnected consumers; both ' +
      'now run through runDetachedFromTenantScope (the G4 leg-2 rule) and thread trustedEnvelopeTenant(event) — the ' +
      'producer-stamped envelope tenant, quarantine-refusing, never a payload claim. The tenant is THREADED rather ' +
      'than wrapped because replay publishes one message.received per replayed row and a worker transaction held ' +
      'across a publish would make the event a pre-commit side effect; each DB block (the instance read, each ' +
      'message PAGE, the lastSeenAt write) opens its own short runTenantWorkDb scope. Legacy envelopes thread ' +
      'undefined and every block stays ambient. Pinned by services/__tests__/agent-replay-worker-scope.test.ts for ' +
      'the SERVICE contract and by plugins/__tests__/event-listeners-replay-callsite-scope.test.ts for the CALL ' +
      'SITES (run16: the fire-and-forget is swallowed by a .catch(log), so dropping the threaded tenant left every ' +
      'gate green — the caller-driven probe is what makes this justification checkable).',
  },
  {
    file: 'packages/api/src/services/agent-replay.ts',
    table: 'messages',
    class: 'tenant-boundary',
    justification:
      'CONVERTED (run15). Two callers. routes/v2/instances.ts drives replayMissedMessages inside the request tenant ' +
      'transaction and threads nothing, so every block stays on that transaction. plugins/event-listeners.ts calls ' +
      'onInstanceConnect / updateLastSeenAt FIRE-AND-FORGET from the instance.connected/disconnected consumers; both ' +
      'now run through runDetachedFromTenantScope (the G4 leg-2 rule) and thread trustedEnvelopeTenant(event) — the ' +
      'producer-stamped envelope tenant, quarantine-refusing, never a payload claim. The tenant is THREADED rather ' +
      'than wrapped because replay publishes one message.received per replayed row and a worker transaction held ' +
      'across a publish would make the event a pre-commit side effect; each DB block (the instance read, each ' +
      'message PAGE, the lastSeenAt write) opens its own short runTenantWorkDb scope. Legacy envelopes thread ' +
      'undefined and every block stays ambient. Pinned by services/__tests__/agent-replay-worker-scope.test.ts for ' +
      'the SERVICE contract and by plugins/__tests__/event-listeners-replay-callsite-scope.test.ts for the CALL ' +
      'SITES (run16: the fire-and-forget is swallowed by a .catch(log), so dropping the threaded tenant left every ' +
      'gate green — the caller-driven probe is what makes this justification checkable).',
  },
  {
    // G5-CONVERTED (leg G). `getInstanceWithProvider` — the lookup EVERY dispatch
    // path starts from — now reads through `scopedHandle`, and each of its
    // consumer callers wraps it in a short worker scope from the envelope's
    // trusted tenant: `session-cleaner` via `runTenantWorkDb`, and the four
    // `agent-dispatcher` sites (`shouldProcessMessage`, `shouldProcessReaction`,
    // the debouncer fallback, the `presence.typing` handler) via `runDispatchDb`.
    // Under RLS a forged/foreign instanceId resolves to `null`, which every
    // caller already treats as "skip". The deprecated `agent-responder.ts` copy
    // is dead code (`plugins/index.ts` re-exports `setupAgentResponder` from
    // agent-dispatcher, so this module's version is never wired); with no scope
    // active `scopedHandle` returns the ambient pool, so it stays byte-identical.
    file: 'packages/api/src/services/agent-runner.ts',
    table: 'instances',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/agent-runner.ts',
    table: 'persons',
    class: 'pending-G5-conversion',
    justification:
      'Reached only from an eventBus/NATS consumer callback, which has no HTTP request and therefore no credential ' +
      'to derive a tenant from. Establishing tenant context for a consumer requires the async message-context ' +
      'propagation ADR-0008 assigns to G5.',
  },
  {
    file: 'packages/api/src/services/agent-tasks.ts',
    table: 'agent_tasks',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/agents.ts',
    table: 'agents',
    class: 'tenant-boundary',
  },
  // `packages/api/src/services/agents.ts -> instances` also stood here and was
  // also a comment ("Backfill Agent rows from instances."). It had been counted
  // as `tenant-boundary`, so retiring it LOWERS the converted count by one. That
  // direction matters: the scanner fix is a correction, not a way to make this
  // group's numbers look better, and it was allowed to cost a point.
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
    class: 'pending-G5-conversion',
    justification:
      "Written by the automation engine's execution logger from its NATS consumer callback (and by the route-side " +
      'manual execute). The engine now THREADS the consumed envelope tenant to the logger (run13), but the service ' +
      'deliberately does not scope the write yet: `automation_logs` derives its tenant from the REQUIRED ' +
      '`automation_id` parent and `automations` is G2-unowned (tenant_id NULL until the G6 backfill), so a ' +
      'worker-scoped insert would fail the strict RLS WITH CHECK and destroy the execution log. G6-gated; when ' +
      'the backfill lands, wrap the logger callback in runTenantWorkDb (the ADR-0008 consumer context) — the ' +
      'threading is already in place.',
  },
  {
    file: 'packages/api/src/services/automations.ts',
    table: 'automations',
    class: 'pending-G4-conversion',
    justification:
      'G2 classifies this table as `unowned` (tenancy-ownership.ts): its G0 rule names a parent that is not a ' +
      'column in the live schema, so tenant_id stays NULL until the G6 backfill decides ownership. The route path ' +
      'runs inside the tenant transaction, but under forced RLS the tenant-equality predicate matches no row at ' +
      'all, so the site cannot be called converted. OPEN QUESTION for G6, proven by the unowned-tables block in ' +
      'two-tenant-adversarial-postgres.test.ts.',
  },
  {
    file: 'packages/api/src/services/batch-jobs.ts',
    table: 'batch_jobs',
    class: 'tenant-boundary',
    justification:
      'CONVERTED (run15). The route-facing create/list/get/cancel/estimate paths run inside the request tenant ' +
      'transaction. The fire-and-forget executor stays DETACHED (it outlives the request — the use-after-commit ' +
      "rule) but is no longer unscoped: create captures the job's TRUSTED tenant as a VALUE before detaching " +
      "(currentTenantScope for a request caller, threaded trustedTenantId for the sync-worker's post-sync " +
      'backfill), stamps it on the row, and every discrete DB block inside executeJob runs in its own short ' +
      'runTenantWorkDb scope with downloads, AI calls and publishes outside — plus dequeue-time and ' +
      'pre-side-effect tenant revalidation (RELEASE_SLOS queued_retry_delayed_dlq_check). run15 closed the LAST ' +
      'unscoped caller: resumeJobs, the restart-recovery whole-table scan for status=running, now fans out with ' +
      'runForEachActiveTenantRow and dispatches each job under its OWN persisted tenant_id outside the read scope. ' +
      'No tRPC caller. Flag-off/no-auth-plane is the pre-G5 single ambient scan, pinned by ' +
      'services/__tests__/batch-jobs-resume-worker-scope.test.ts (plus batch-jobs-tenant-scope and ' +
      'batch-jobs-dequeue-revalidation for the executor). The sync-worker threading named above is pinned by ' +
      'plugins/__tests__/sync-worker-media-backfill-scope.test.ts, which drives the real sync.started handler: ' +
      'run16 found that call site passing no tenant at all, so an enqueue from OUTSIDE every per-item scope would ' +
      'have stamped a NULL-tenant row whose detached executor ran the whole media backfill unscoped and skipped ' +
      'the dequeue-time revocation gate (a null tenant is admissible by definition).',
  },
  {
    file: 'packages/api/src/services/batch-jobs.ts',
    table: 'media_content',
    class: 'tenant-boundary',
    justification:
      'CONVERTED (run15). The route-facing create/list/get/cancel/estimate paths run inside the request tenant ' +
      'transaction. The fire-and-forget executor stays DETACHED (it outlives the request — the use-after-commit ' +
      "rule) but is no longer unscoped: create captures the job's TRUSTED tenant as a VALUE before detaching " +
      "(currentTenantScope for a request caller, threaded trustedTenantId for the sync-worker's post-sync " +
      'backfill), stamps it on the row, and every discrete DB block inside executeJob runs in its own short ' +
      'runTenantWorkDb scope with downloads, AI calls and publishes outside — plus dequeue-time and ' +
      'pre-side-effect tenant revalidation (RELEASE_SLOS queued_retry_delayed_dlq_check). run15 closed the LAST ' +
      'unscoped caller: resumeJobs, the restart-recovery whole-table scan for status=running, now fans out with ' +
      'runForEachActiveTenantRow and dispatches each job under its OWN persisted tenant_id outside the read scope. ' +
      'No tRPC caller. Flag-off/no-auth-plane is the pre-G5 single ambient scan, pinned by ' +
      'services/__tests__/batch-jobs-resume-worker-scope.test.ts (plus batch-jobs-tenant-scope and ' +
      'batch-jobs-dequeue-revalidation for the executor). The sync-worker threading named above is pinned by ' +
      'plugins/__tests__/sync-worker-media-backfill-scope.test.ts, which drives the real sync.started handler: ' +
      'run16 found that call site passing no tenant at all, so an enqueue from OUTSIDE every per-item scope would ' +
      'have stamped a NULL-tenant row whose detached executor ran the whole media backfill unscoped and skipped ' +
      'the dequeue-time revocation gate (a null tenant is admissible by definition).',
  },
  {
    file: 'packages/api/src/services/batch-jobs.ts',
    table: 'messages',
    class: 'tenant-boundary',
    justification:
      'CONVERTED (run15). The route-facing create/list/get/cancel/estimate paths run inside the request tenant ' +
      'transaction. The fire-and-forget executor stays DETACHED (it outlives the request — the use-after-commit ' +
      "rule) but is no longer unscoped: create captures the job's TRUSTED tenant as a VALUE before detaching " +
      "(currentTenantScope for a request caller, threaded trustedTenantId for the sync-worker's post-sync " +
      'backfill), stamps it on the row, and every discrete DB block inside executeJob runs in its own short ' +
      'runTenantWorkDb scope with downloads, AI calls and publishes outside — plus dequeue-time and ' +
      'pre-side-effect tenant revalidation (RELEASE_SLOS queued_retry_delayed_dlq_check). run15 closed the LAST ' +
      'unscoped caller: resumeJobs, the restart-recovery whole-table scan for status=running, now fans out with ' +
      'runForEachActiveTenantRow and dispatches each job under its OWN persisted tenant_id outside the read scope. ' +
      'No tRPC caller. Flag-off/no-auth-plane is the pre-G5 single ambient scan, pinned by ' +
      'services/__tests__/batch-jobs-resume-worker-scope.test.ts (plus batch-jobs-tenant-scope and ' +
      'batch-jobs-dequeue-revalidation for the executor). The sync-worker threading named above is pinned by ' +
      'plugins/__tests__/sync-worker-media-backfill-scope.test.ts, which drives the real sync.started handler: ' +
      'run16 found that call site passing no tenant at all, so an enqueue from OUTSIDE every per-item scope would ' +
      'have stamped a NULL-tenant row whose detached executor ran the whole media backfill unscoped and skipped ' +
      'the dequeue-time revocation gate (a null tenant is admissible by definition).',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'chat_id_mappings',
    class: 'tenant-boundary',
    justification:
      'CONVERTED. Every method that touches `chat_id_mappings` (`create`, `findByExternalIdSmart`, ' +
      '`findLidMapping`, `findOrCreate`, `getAllExternalIds`, `upsertLidMapping`) now reaches this file only from ' +
      'a scoped caller: the routes through the request tenant transaction, and the async side through ' +
      '`message-persistence` (converted this leg — its five consumers wrap their awaited work in ' +
      '`runConsumerInTenantContext` and hand each fire-and-forget LID upsert its own `runTenantWorkDb` scope), ' +
      '`agent-dispatcher` (`runDispatchDb` per discrete read block, including the media/identity polls), ' +
      '`media-processor` (`runMediaDb`), `sync-worker` (`inSyncWorkerScope`), `session-cleaner` and ' +
      '`follow-up-hooks` (`runTenantWorkDb`). The one remaining unscoped caller of this FILE — the automation ' +
      'engine callbacks in `index.ts` — calls only `chats.getById`, which touches `chats` and nothing else; that ' +
      'keeps the `chats` site pending, not this one.',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'chat_participants',
    class: 'tenant-boundary',
    justification:
      'CONVERTED. The participant methods (`findOrCreateParticipant`, `recordParticipantActivity`, ' +
      '`addParticipant`, `getParticipants`, `removeParticipant`, `updateParticipantRole`, ' +
      '`linkParticipantToPerson`, and `list` via `enrichDmNames`) are reached from exactly two places: the ' +
      'routes, inside the request tenant transaction, and `message-persistence`, converted this leg. No other ' +
      'worker calls a participant method — verified caller-by-caller across every plugin, the scheduler and ' +
      '`index.ts`.',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'chats',
    class: 'tenant-boundary',
    justification:
      'CONVERTED (leg I, run13). The service was scope-aware since G4 (`scopedHandle` getter); what remained was ' +
      'its last unscoped caller — the automation-engine action callbacks, extracted to ' +
      'plugins/automation-actions.ts, which now wrap their `chats.getById` resolution in `runTenantWorkDb` with ' +
      'the tenant the engine threads from the consumed envelope (including debounce-window carry). Verified ' +
      'caller-by-caller: routes (request transaction), message-persistence/agent-dispatcher/media-processor/' +
      'sync-worker/session-cleaner/follow-up-hooks (worker scopes, legs G-H), and the callbacks (leg I). ' +
      'trpc/router.ts calls NO chats method. Cross-tenant refusal proven on real RLS in ' +
      'automation-actions-two-tenant-postgres.test.ts.',
  },
  {
    file: 'packages/api/src/services/chats.ts',
    table: 'omni_groups',
    class: 'tenant-boundary',
    justification:
      'CONVERTED. `omni_groups` is touched only by the private `enrichGroupNames`, reached only from ' +
      '`ChatService.list`, whose sole caller is `routes/v2/chats.ts` — inside the request tenant transaction. No ' +
      'consumer, cron or fire-and-forget path calls `list`.',
  },
  {
    file: 'packages/api/src/services/conversations.ts',
    table: 'chats',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/conversations.ts',
    table: 'conversations',
    class: 'pending-G4-conversion',
    justification:
      'G2 classifies this table as `unowned` (tenancy-ownership.ts): its G0 rule names a parent that is not a ' +
      'column in the live schema, so tenant_id stays NULL until the G6 backfill decides ownership. The route path ' +
      'runs inside the tenant transaction, but under forced RLS the tenant-equality predicate matches no row at ' +
      'all, so the site cannot be called converted. OPEN QUESTION for G6, proven by the unowned-tables block in ' +
      'two-tenant-adversarial-postgres.test.ts.',
  },
  {
    file: 'packages/api/src/services/dead-letters.ts',
    table: 'dead_letter_events',
    class: 'pending-G4-conversion',
    justification:
      'G2 classifies this table as `unowned` (tenancy-ownership.ts): its G0 rule names a parent that is not a ' +
      'column in the live schema, so tenant_id stays NULL until the G6 backfill decides ownership. The route path ' +
      'runs inside the tenant transaction, but under forced RLS the tenant-equality predicate matches no row at ' +
      'all, so the site cannot be called converted. OPEN QUESTION for G6, proven by the unowned-tables block in ' +
      'two-tenant-adversarial-postgres.test.ts.',
  },
  {
    // G5-CONVERTED. Both paths now reach a tenant transaction. The route-facing
    // `getMetrics`/`startReplay` count run inside the request scope. The
    // background replay executor is STILL request-detached (it outlives the
    // request), but `startReplay` now captures the trusted tenant BEFORE
    // detaching and threads it as a VALUE into `executeReplay`, whose every
    // `omni_events` batch read runs in its OWN short worker scope
    // (`runTenantWorkDb`). It revalidates the tenant is still admissible at
    // dequeue and before each durable side-effect batch. A legacy replay
    // (null tenant) reads ambient byte-identically.
    file: 'packages/api/src/services/event-ops.ts',
    table: 'omni_events',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/events.ts',
    table: 'omni_events',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'agents',
    class: 'pending-G5-conversion',
    justification:
      'CONVERTED IN CODE but honestly still pending, blocked on G6. The `agents` read in `resolveConfig` now runs ' +
      'inside the same `workDb(trustedTenantId, …)` block as its sibling `chats`/`instances` sites (which flipped ' +
      'to tenant-boundary this leg): the ADR-0008 async mechanism — the follow-up eventBus consumer hooks and the ' +
      'follow-up-sweeper cron — threads a trusted tenant into every caller. What keeps the class: `agents` derives ' +
      'its tenant via owner_id -> persons, and `persons` is G2-`unowned`, so the fail-closed derivation trigger ' +
      'leaves every `agents` row NULL-tenant until the G6 persons backfill — a scoped read finds no config row yet. ' +
      'Flips to tenant-boundary when G6 lands.',
  },
  {
    // G5-CONVERTED. Every entry into `FollowUpLifecycleService` now establishes
    // tenant context: `armForOutbound`/`armForInbound`/`disarm`/
    // `touchInboundTimestamp`/`resolveConfig`/`evaluateIdleTimeoutFreshness`
    // each run their discrete DB blocks through `workDb(trustedTenantId, …)` /
    // `repoFor(trustedTenantId)`. The callers thread that trusted tenant: the
    // follow-up hooks (`trustedTenantOf(event)`), the sweeper (per-tenant world),
    // the agent-dispatcher (`runDispatchDb` envelope tenant), the session-cleaner
    // (envelope tenant), the automation-engine idle-timeout gate (envelope
    // tenant), and real routes (their request scope, via `workDb`'s passthrough).
    // Publishes sit BETWEEN scoped blocks, never inside one. Legacy work threads
    // null → ambient byte-identical.
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'chat_follow_up_state',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (see the chat_follow_up_state entry above). The `chats` reads
    // in `resolveConfig`/`isInActiveCloseState` run through the same
    // `workDb(trustedTenantId, …)` blocks; all entry points scope.
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'chats',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (see the chat_follow_up_state entry above). The `instances`
    // read in `resolveConfig` runs through the same scoped block.
    file: 'packages/api/src/services/follow-up-lifecycle.ts',
    table: 'instances',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED. The sweeper is a cron: flag-off it runs one ambient pass
    // byte-identical; flag-on it enumerates active tenants on the auth-plane
    // connection (periodic-tenant-work.ts) and runs one pass per tenant, each
    // claim/fire/disarm DB block in its own short worker scope with an explicit
    // `tenant_id = $tenant` predicate, plus a transitional NULL-tenant pass that
    // is SKIPPED under enforcement (where the mixed state cannot exist). A
    // suspended tenant drops out of the enumeration at the next tick.
    file: 'packages/api/src/services/follow-up-sweeper.ts',
    table: 'chat_follow_up_state',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/instances.ts',
    table: 'instances',
    class: 'pending-G5-conversion',
    justification:
      'ASYNC SIDE COMPLETE (run14); held pending by ONE synchronous caller. Every route path runs inside the ' +
      'request transaction; the async callers were closed across run13 and run14 — the automation-engine ' +
      'callbacks (automation-actions.ts, engine-threaded envelope tenant), the sync-worker channel-type lookup ' +
      '(inSyncWorkerScope), the session-cleaner confirmation send (runTenantWorkDb), the scheduler ' +
      'unread-count-refresh cron (runForEachActiveTenantRow, the daily-sync precedent) and turn-monitor.ts ' +
      '(runForEachActiveTenantRow over getStale, each per-turn `getById` in its own runTenantWorkDb scope). What ' +
      'remains is trpc/router.ts alone: a second synchronous edge with NO tenant boundary of any kind, which ' +
      'reaches list/getById/getByName/create/update/delete here. Giving it one is G4-surface work, not the ' +
      'ADR-0008 async-context work assigned to G5. Held for the SAME open decision as ' +
      'persons.ts::platform_identities — add the withTenantTransaction edge, or retire the unmounted export. ' +
      'Not reclassified unilaterally: an unmounted export is still callable by an out-of-repo consumer.',
  },
  {
    file: 'packages/api/src/services/media-storage.ts',
    table: 'messages',
    class: 'tenant-boundary',
    justification:
      "CONVERTED (run15). This site is ONE query — updateMessageLocalPath's update(messages) — and all three of its " +
      'callers are scoped. routes/v2/messages.ts runs inside the request tenant transaction; services/batch-jobs.ts ' +
      "resolveFilePath already wrapped it in runTenantWorkDb with the job's tenant; and run15 closed the last one, " +
      'plugins/media-processor.ts downloadMediaFromUrl, which threaded its envelope tenant into storeFromUrl (for the ' +
      'tenant-prefixed object key and the egress policy) but left the message write on the ambient handle. It now ' +
      'runs through runMediaDb, so the NETWORK download stays outside any scope and the write lands in the same ' +
      'tenant transaction as the rest of the item. Legacy envelopes write ambient, byte-identically. Pinned by ' +
      'plugins/__tests__/media-storage-worker-scope.test.ts.',
  },
  {
    file: 'packages/api/src/services/messages.ts',
    table: 'chats',
    class: 'tenant-boundary',
    justification:
      'CONVERTED. Every caller of this file is now scoped: the routes through the request tenant transaction, and ' +
      'the four async callers through their own worker scopes — `message-persistence` ' +
      '(`runConsumerInTenantContext`, converted this leg), `agent-dispatcher` (`runDispatchDb`, its read helpers ' +
      'converted this leg), `media-processor` (`runMediaDb`, converted this leg) and `sync-worker` ' +
      "(`inSyncWorkerScope`). The dispatcher and media-processor POLL for message-persistence's commit, so each " +
      'poll ATTEMPT opens and closes its own short scope — one transaction spanning the poll could never observe ' +
      'the row it waits for, and would outlive its work item.',
  },
  {
    file: 'packages/api/src/services/messages.ts',
    table: 'messages',
    class: 'tenant-boundary',
    justification:
      'CONVERTED. Same caller set and same per-attempt scoping as the `chats` site in this file: routes inside the ' +
      'request tenant transaction; `message-persistence`, `agent-dispatcher`, `media-processor` and `sync-worker` ' +
      'each inside their own worker tenant scope, one per discrete DB block.',
  },
  {
    file: 'packages/api/src/services/payload-store.ts',
    table: 'event_payloads',
    class: 'pending-G4-conversion',
    justification:
      'G2 classifies this table as `unowned` (tenancy-ownership.ts): its G0 rule names a parent that is not a ' +
      'column in the live schema, so tenant_id stays NULL until the G6 backfill decides ownership. The route path ' +
      'runs inside the tenant transaction, but under forced RLS the tenant-equality predicate matches no row at ' +
      'all, so the site cannot be called converted. OPEN QUESTION for G6, proven by the unowned-tables block in ' +
      'two-tenant-adversarial-postgres.test.ts.',
  },
  {
    file: 'packages/api/src/services/persons.ts',
    table: 'chat_id_mappings',
    class: 'tenant-boundary',
    justification:
      'CONVERTED. `chat_id_mappings` is reached in this file from `findOrCreateIdentity` (via the private ' +
      '`resolvePhoneFromLid`) and from `update`. `update` is called only by `routes/v2/persons.ts`, inside the ' +
      'request tenant transaction; `findOrCreateIdentity` is called only by `message-persistence` (converted this ' +
      "leg) and `sync-worker`'s contact sync (wrapped in `inSyncWorkerScope` this leg). The tRPC router, which is " +
      'the last unscoped caller of this FILE, calls none of them — it reaches `platform_identities` only, which ' +
      'is why that sibling site stays pending and this one does not.',
  },
  {
    file: 'packages/api/src/services/persons.ts',
    table: 'persons',
    class: 'pending-G4-conversion',
    justification:
      'G2 classifies this table as `unowned` (tenancy-ownership.ts): its G0 rule names a parent that is not a ' +
      'column in the live schema, so tenant_id stays NULL until the G6 backfill decides ownership. The route path ' +
      'runs inside the tenant transaction, but under forced RLS the tenant-equality predicate matches no row at ' +
      'all, so the site cannot be called converted. OPEN QUESTION for G6, proven by the unowned-tables block in ' +
      'two-tenant-adversarial-postgres.test.ts.',
  },
  {
    file: 'packages/api/src/services/persons.ts',
    table: 'platform_identities',
    class: 'pending-G5-conversion',
    justification:
      'ASYNC SIDE CONVERTED; held pending by a SYNCHRONOUS caller, so the class is now an honest overstatement of ' +
      'G5 debt rather than a G5 gap. Every worker caller is scoped: `message-persistence` ' +
      '(`runConsumerInTenantContext`), `agent-dispatcher` (`runDispatchDb` around `resolvePersonId`, ' +
      "`fetchSenderMetadata` and `resolveCustomerContext` — `resolvePersonId` POLLS for message-persistence's " +
      'commit, so each ATTEMPT gets its own short scope), and `sync-worker` (`inSyncWorkerScope` around the ' +
      'contact-sync identity write). What remains is `trpc/router.ts` — `getPresence`, `linkIdentities`, ' +
      '`unlinkIdentity` — which has NO tenant boundary of any kind: it is a second synchronous edge alongside the ' +
      'Hono routes, and giving it one is G4-surface work, not the async-context work ADR-0008 assigns to G5 (that ' +
      'half is done). The router is exported as ' +
      '`@omni/api/trpc` but no handler in this repository mounts it, so it is not currently a live path. OPEN ' +
      'QUESTION for the orchestrator: either give the tRPC edge the same `withTenantTransaction` boundary the ' +
      'Hono edge got in G4, or retire the unmounted surface. Not reclassified unilaterally — an unmounted export ' +
      'is still callable by an out-of-repo consumer, and "nothing mounts it today" is not a boundary.',
  },
  {
    // G5-CONVERTED (leg C2). `resolve()` takes the envelope-derived
    // `trustedTenantId` its dispatcher-consumer callers thread through
    // `DispatchMetadata`; the read runs through `scopedHandle` inside a short
    // worker scope AND the LRU cache key includes the tenant, so a foreign
    // scope's negative entry cannot shadow a tenant's real route. Consumer-only
    // callers; legacy lookups keep the pre-G5 key and ambient read.
    file: 'packages/api/src/services/route-resolver.ts',
    table: 'agent_routes',
    class: 'tenant-boundary',
  },
  {
    file: 'packages/api/src/services/routes.ts',
    table: 'agent_routes',
    class: 'tenant-boundary',
  },
  {
    // G5-CONVERTED (leg G). `SyncJobService` already read through `scopedHandle`;
    // what was missing was a WORLD for its worker callers. Each method now takes
    // a THREADED trusted tenant and wraps its own discrete DB block in
    // `workDb` — threaded rather than caller-wrapped because every mutation also
    // PUBLISHES a `sync.*` event, and a worker transaction held across that
    // publish would make the event a pre-commit side effect. All four worker
    // callers now thread: the daily contacts/groups crons via
    // `runForEachActiveTenantRow` (per-active-tenant scoped `listActive`, so a
    // suspended tenant drops out at the next tick), the `sync.started` consumer
    // and the three history-push tracker subscribers via `trustedSyncTenant`,
    // and `message-persistence`'s post-reconnect backfill via the
    // `instance.connected` envelope. Route callers thread nothing and stay on
    // their request scope. The published envelope carries `created.tenantId` —
    // what the row was actually stamped with — so the downstream consumer
    // derives from persisted ownership.
    file: 'packages/api/src/services/sync-jobs.ts',
    table: 'sync_jobs',
    class: 'tenant-boundary',
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
    class: 'pending-G5-conversion',
    justification:
      'Route paths run inside the request transaction, and two of the four worker callers are now scoped: ' +
      'agent-dispatcher.ts `turns.open` (runDispatchDb, envelope-derived tenant) and turn-monitor.ts — whose ' +
      'whole tick run14 converted to the runForEachActiveTenantRow fan-out with each getStale/incrementNudge/' +
      'close in its own short worker scope. TWO unscoped callers remain, both fire-and-forget and neither in ' +
      "run14's scope: (a) middleware/auth.ts, which starts `getOpenByApiKey().then(recordActivity)` from a " +
      'REQUEST and detaches nothing — its continuations can outlive the request transaction (the G4 leg-2 ' +
      'use-after-commit trap) and it needs runDetachedFromTenantScope plus a worker scope derived from the ' +
      "validated key's tenant; (b) services/agent-heartbeat.ts, a NATS consumer whose heartbeat carries an " +
      'instanceId but is not yet classified through classifyEnvelope. A site is only as scoped as its ' +
      'least-scoped caller, so those two are the ADR-0008 async-context work that remains. BUT CONVERTING ' +
      'THEM DOES NOT FLIP THIS ENTRY: `turns` is ALSO G6-GATED, on exactly the chain that holds the four ' +
      '`agents` sites. It derives from BOTH instance_id and agent_id (tenancy-ownership.ts, required), ' +
      'turns.agent_id is NOT NULL, and `agents` derives via owner_id -> persons (G2-`unowned`), so ' +
      'omni_tenant_ownership_agents leaves every agents row NULL-tenant and omni_tenant_ownership_turns ' +
      'therefore stamps turns.tenant_id NULL for every row. Under enforcement a scoped read returns nothing ' +
      'and turns.open fails the INSERT WITH CHECK (the composite FK (tenant_id, agent_id) -> agents cannot ' +
      'be satisfied either). So this flips to tenant-boundary only once BOTH the async callers are converted ' +
      'AND the G6 persons backfill lands — it is a G6-gated site, not still-convertible G5 work.',
  },
  {
    file: 'packages/api/src/services/webhooks.ts',
    table: 'webhook_sources',
    class: 'pending-G4-conversion',
    justification:
      'G2 classifies this table as `unowned` (tenancy-ownership.ts): its G0 rule names a parent that is not a ' +
      'column in the live schema, so tenant_id stays NULL until the G6 backfill decides ownership. The route path ' +
      'runs inside the tenant transaction, but under forced RLS the tenant-equality predicate matches no row at ' +
      'all, so the site cannot be called converted. OPEN QUESTION for G6, proven by the unowned-tables block in ' +
      'two-tenant-adversarial-postgres.test.ts.',
  },
  {
    file: 'packages/api/src/tenancy/auth-plane-connection.ts',
    table: '*',
    class: 'control-plane',
    justification:
      'ADR-0003 isolated auth plane. Opens the auth-plane role\u2019s own pool under enforcement so the credential index and the pre-context membership re-validation are read on an identity that may read them; returns the runtime handle unchanged in legacy mode. Pre-context by definition.',
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
  // The seven channel/CLI entries that stood here were never database access:
  // table names in doc comments, the discord.js `TextChannel.messages` client
  // API, Baileys `chats.upsert` socket events, and shell-completion word lists.
  // Leg 2 recorded the open question as "retire by making the scanner
  // comment-aware, not by reclassifying"; `stripComments` plus the raw-SQL
  // word-boundary did exactly that, so the sites no longer scan and the guard's
  // own staleness check removed them.
  {
    file: 'packages/channel-whatsapp-business/src/handlers/webhook.ts',
    table: '*',
    class: 'pending-G4-conversion',
    justification:
      'Bare getDb() acquisition (lazy-imported) in the Meta template-status webhook path of the whatsapp-cloud ' +
      'channel. The webhook is authenticated by app-secret HMAC, not by a tenant credential — Meta configures ONE ' +
      'global callback per app, so there is no request credential to derive a tenant from; the affected instance ' +
      'is resolved from the payload (metaTemplateId/wabaId) by the templates service. Converting it means routing ' +
      'the template-status write through the api layer (which owns tenant scoping) instead of a channel-package ' +
      'db handle — the channel-site default class until that conversion lands.',
  },
  {
    file: 'packages/cli/src/commands/keys.ts',
    table: '*',
    class: 'control-plane',
    justification:
      'ADR-0003 auth-plane bootstrap, and the ONE CLI site that earns this class. Leg 2 left the open question ' +
      '"can this command run under a tenant credential at all"; tracing it closes the question as no, by ' +
      'construction. The `createDb()` at keys.ts:169 is reached only from `handleAdminCreate` (:121) and its handle ' +
      'is passed to nothing but `ApiKeyService` (:170), which writes the LEGACY `api_keys` table — credential ' +
      'state, not tenant business data, and deliberately not `auth_credentials`, so the G3 runtime REVOKE does ' +
      'not apply to it and is NOT what protects this site. Two things do. First, this command is what MINTS THE ' +
      'FIRST credential on a fresh deployment, so no tenant credential can exist to run it under and there is ' +
      'nothing for a tenant scope to be derived from. Second, under enforcement the command refuses ' +
      'outright (:143, the Success-Criterion-19 god-key rule), so the enforced world cannot reach the write at ' +
      'all. It is inventoried as operator surface in SURFACE_INVENTORY `cli_admin_bootstrap`, which is the WISH ' +
      'condition for this class. Every other `keys` subcommand goes over HTTP and touches no database.',
  },
  {
    file: 'packages/db/scripts/apply-rls-enforcement.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
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
    file: 'packages/db/scripts/online-ddl.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. The G2 online index phase: invoked explicitly by an operator with an explicit --url (DATABASE_URL is never read), outside the migration transaction, never from a request; the runtime role holds no privilege it needs.',
  },
  {
    file: 'packages/db/src/migrate.ts',
    table: '*',
    class: 'migration-ddl',
    justification:
      'Migration/backfill/schema tooling. Invoked explicitly by an operator under the DDL identity, never from a request; the runtime role holds no privilege it needs.',
  },
];
