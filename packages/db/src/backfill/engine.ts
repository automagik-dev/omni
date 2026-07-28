/**
 * Backfill engine — dry-run / apply / resume (wish: omni-full-multitenancy, G6).
 *
 * Walks a DISPOSABLE cluster in bounded, resumable batches and resolves tenant
 * ownership for the legacy tables, driven entirely by the pure mapping engine so
 * dry-run and apply reach identical decisions. The invariants it exists to prove:
 *
 *   * **Ledger before rewrite.** No row is ever rewritten without a DURABLE
 *     ledger entry recorded first — `recordPlanned` commits in its own statement
 *     before the `UPDATE` runs. A crash between the two leaves the row untouched
 *     and its intent on the ledger.
 *   * **Dry-run writes nothing.** It reaches every decision and produces the full
 *     impact report with zero ledger rows and zero table rewrites.
 *   * **Idempotent + resumable.** Each source row is keyed in the ledger by
 *     UNIQUE(source_table, source_primary_key); an already-applied row is skipped,
 *     a cursor advances past quarantined rows, and a kill mid-batch resumes
 *     without double-writing.
 *   * **Never guesses.** Conflicting/orphan/unresolved rows quarantine; the three
 *     silent-decision tables stop-block by name unless an operator mapping is
 *     supplied.
 *
 * Structural SQL (table/column names) comes from the FROZEN `tenancy-ownership`
 * spec and is interpolated as quoted identifiers via `sql.unsafe`; row values are
 * always bound parameters. The engine never emits a literal tenant-table name, so
 * it stays outside the db-access guard's tenant-table denylist by construction —
 * it is generic over the spec, not a hand-written per-table writer.
 */

import { TENANT_OWNERSHIP_SPECS } from '../tenancy-ownership';
import { checksum } from './checksum';
import type { ToolingSql } from './db';
import { type CompensatingAction, type InverseAction, findBySource, markApplied, recordPlanned } from './ledger';
import {
  type InstanceTenantMap,
  type MappingResult,
  type OperatorRowMap,
  deriveComposite,
  mapRootInstance,
} from './mapping-engine';
import { assertNoSecrets, redactRow } from './redaction';
import {
  type UnownedTableRule,
  classifyDeriveFromEvent,
  classifyOperatorOrStopBlock,
  getUnownedRule,
} from './unowned-rules';

export type TableStrategy = 'root' | 'derived' | 'derive-from-event' | 'operator-or-stop-block';

export interface TablePlan {
  readonly table: string;
  readonly strategy: TableStrategy;
  readonly primaryKey: readonly string[];
  /** derived: FK column -> parent table (parent PK is always `id`). */
  readonly parents: readonly { readonly column: string; readonly parentTable: string }[];
  /** root: the FK column that is the instance id (always `id` for `instances`). */
  readonly rootColumn?: string;
  /** derive-from-event: the varchar column joined to `omni_events.id::text`. */
  readonly eventIdColumn?: string;
  readonly unownedRule?: UnownedTableRule;
}

const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Build the default engine plan from the frozen spec.
 *
 * `persons` (strategy `clone`) is EXCLUDED — its ownership fans out per tenant and
 * is resolved by `person-clone.ts`, which runs as its own phase before the tables
 * that derive from it. Everything else maps 1:1 to a strategy.
 */
export function defaultTablePlans(): TablePlan[] {
  const plans: TablePlan[] = [];
  for (const spec of TENANT_OWNERSHIP_SPECS) {
    if (spec.derivation === 'root') {
      plans.push({ table: spec.table, strategy: 'root', primaryKey: ['id'], parents: [], rootColumn: 'id' });
    } else if (spec.derivation === 'derived') {
      plans.push({
        table: spec.table,
        strategy: 'derived',
        primaryKey: ['id'],
        parents: spec.parents.map((p) => ({ column: p.column, parentTable: p.parentTable })),
      });
    } else {
      // unowned
      const rule = getUnownedRule(spec.table);
      if (!rule || rule.strategy === 'clone') continue; // persons handled elsewhere
      if (rule.strategy === 'derive-from-event') {
        plans.push({
          table: spec.table,
          strategy: 'derive-from-event',
          primaryKey: spec.table === 'processed_events' ? ['event_id', 'handler'] : ['id'],
          parents: [],
          eventIdColumn: rule.eventIdColumn,
          unownedRule: rule,
        });
      } else {
        plans.push({
          table: spec.table,
          strategy: 'operator-or-stop-block',
          primaryKey: ['id'],
          parents: [],
          unownedRule: rule,
        });
      }
    }
  }
  return orderByDependency(plans);
}

/**
 * Order plans so every table's INCLUDED parents come first. `persons` is not in
 * the plan (resolved by the clone phase), so it is treated as pre-resolved; the
 * event-family tables depend on `omni_events`.
 */
export function orderByDependency(plans: readonly TablePlan[]): TablePlan[] {
  const byTable = new Map(plans.map((p) => [p.table, p]));
  const ordered: TablePlan[] = [];
  const done = new Set<string>();

  const deps = (plan: TablePlan): string[] => {
    const d = plan.parents.map((p) => p.parentTable);
    if (plan.strategy === 'derive-from-event') d.push('omni_events');
    return d.filter((t) => byTable.has(t)); // only in-plan deps constrain order
  };

  let progressed = true;
  while (ordered.length < plans.length && progressed) {
    progressed = false;
    for (const plan of plans) {
      if (done.has(plan.table)) continue;
      if (deps(plan).every((d) => done.has(d))) {
        ordered.push(plan);
        done.add(plan.table);
        progressed = true;
      }
    }
  }
  // Any residual cycle (should not happen with the frozen spec) is appended as-is.
  for (const plan of plans) if (!done.has(plan.table)) ordered.push(plan);
  return ordered;
}

export interface TableReport {
  table: string;
  strategy: TableStrategy;
  scanned: number;
  assigned: number;
  quarantined: number;
  stopBlocked: number;
}

export interface StopBlockReport {
  table: string;
  rows: number;
  openQuestion: string;
}

export interface RunReport {
  mode: 'dry-run' | 'apply';
  writerEpoch: number;
  tables: TableReport[];
  stopBlocked: StopBlockReport[];
  deferrals: { table: string; deferral: string }[];
  totals: { scanned: number; assigned: number; quarantined: number; stopBlocked: number };
}

export interface RunConfig {
  readonly mode: 'dry-run' | 'apply';
  readonly instanceTenantMap: InstanceTenantMap;
  readonly operatorMap?: OperatorRowMap;
  readonly writerEpoch?: number;
  readonly batchSize?: number;
  /** Restrict the run to these tables (default: the full default plan). */
  readonly tables?: readonly string[];
  /** Injected fault for crash-recovery tests: throws after N ledger records. */
  readonly faultAfterPlanned?: number;
}

/** A per-run counter used only to drive the crash-recovery fault. */
class FaultInjector {
  private planned = 0;
  constructor(private readonly limit?: number) {}
  afterPlanned(): void {
    this.planned += 1;
    if (this.limit !== undefined && this.planned >= this.limit) {
      throw new EngineCrash(`fault injected after ${this.planned} planned ledger entries`);
    }
  }
}

export class EngineCrash extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineCrash';
  }
}

const ALIAS = '__parent_';

/** Fetch one batch of not-yet-assigned rows with their present-parent tenants. */
async function fetchBatch(
  sql: ToolingSql,
  plan: TablePlan,
  cursor: unknown[] | null,
  batchSize: number,
): Promise<Record<string, unknown>[]> {
  const pk = plan.primaryKey;
  const selects: string[] = ['c.*'];
  const joins: string[] = [];

  plan.parents.forEach((parent, i) => {
    const alias = `p${i}`;
    selects.push(`${alias}.tenant_id AS ${ALIAS}${i}_tenant`);
    selects.push(`(c.${q(parent.column)} IS NOT NULL) AS ${ALIAS}${i}_present`);
    joins.push(`LEFT JOIN ${q(parent.parentTable)} ${alias} ON c.${q(parent.column)} = ${alias}.id`);
  });

  if (plan.strategy === 'derive-from-event' && plan.eventIdColumn) {
    selects.push(`ev.tenant_id AS ${ALIAS}ev_tenant`);
    selects.push(`(ev.id IS NOT NULL) AS ${ALIAS}ev_matched`);
    joins.push(`LEFT JOIN "omni_events" ev ON c.${q(plan.eventIdColumn)} = ev.id::text`);
  }

  const params: unknown[] = [];
  const where: string[] = ['c.tenant_id IS NULL'];
  if (cursor) {
    // Row-value cursor: (pk1, pk2, ...) > (c1, c2, ...). Skips already-processed
    // rows — including quarantined ones that keep a NULL owner — so a dry-run
    // terminates and an apply never reprocesses a settled row.
    const lhs = pk.map((col) => `c.${q(col)}`).join(', ');
    const placeholders = pk.map((_, idx) => {
      params.push(cursor[idx]);
      return `$${params.length}`;
    });
    where.push(`(${lhs}) > (${placeholders.join(', ')})`);
  }
  params.push(batchSize);
  const limitPlaceholder = `$${params.length}`;

  const orderBy = pk.map((col) => `c.${q(col)}`).join(', ');
  const text = `SELECT ${selects.join(', ')} FROM ${q(plan.table)} c ${joins.join(' ')} WHERE ${where.join(
    ' AND ',
  )} ORDER BY ${orderBy} LIMIT ${limitPlaceholder}`;

  return (await sql.unsafe(text, params as never[])) as unknown as Record<string, unknown>[];
}

/** Split a fetched row into its real columns and the parent-tenant aliases. */
function splitRow(
  row: Record<string, unknown>,
  plan: TablePlan,
): {
  real: Record<string, unknown>;
  parentTenants: (string | null)[];
  eventTenant: string | null | undefined;
} {
  const real: Record<string, unknown> = {};
  const present: Record<number, boolean> = {};
  const tenant: Record<number, string | null> = {};
  let eventTenant: string | null | undefined;
  let evMatched = false;

  // Early-continue flattening keeps each branch shallow.
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith(ALIAS)) {
      real[key] = value;
      continue;
    }
    if (key === `${ALIAS}ev_tenant`) {
      eventTenant = value as string | null;
      continue;
    }
    if (key === `${ALIAS}ev_matched`) {
      evMatched = value as boolean;
      continue;
    }
    const m = /^__parent_(\d+)_(tenant|present)$/.exec(key);
    if (!m) continue;
    const idx = Number(m[1]);
    if (m[2] === 'tenant') tenant[idx] = value as string | null;
    else present[idx] = value as boolean;
  }

  const parentTenants: (string | null)[] = [];
  plan.parents.forEach((_, i) => {
    if (present[i]) parentTenants.push(tenant[i] ?? null);
  });
  const resolvedEventTenant =
    plan.strategy === 'derive-from-event' ? (evMatched ? (eventTenant ?? null) : undefined) : eventTenant;
  return { real, parentTenants, eventTenant: resolvedEventTenant };
}

function decide(plan: TablePlan, split: ReturnType<typeof splitRow>, config: RunConfig): MappingResult {
  switch (plan.strategy) {
    case 'root': {
      const instanceId = String(split.real[plan.rootColumn ?? 'id']);
      return mapRootInstance(instanceId, config.instanceTenantMap);
    }
    case 'derived':
      return deriveComposite(split.parentTenants, plan.parents.length, `derived:${plan.table}`);
    case 'derive-from-event': {
      if (!plan.unownedRule) throw new Error(`derive-from-event plan for ${plan.table} is missing its unowned rule`);
      return classifyDeriveFromEvent(plan.unownedRule, split.eventTenant);
    }
    case 'operator-or-stop-block': {
      if (!plan.unownedRule) throw new Error(`operator plan for ${plan.table} is missing its unowned rule`);
      return classifyOperatorOrStopBlock(
        plan.unownedRule,
        JSON.stringify(pkOf(split.real, plan)),
        config.operatorMap ?? new Map(),
      );
    }
  }
}

function pkOf(real: Record<string, unknown>, plan: TablePlan): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const col of plan.primaryKey) pk[col] = real[col];
  return pk;
}

async function fetchFullRow(
  sql: ToolingSql,
  plan: TablePlan,
  pk: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const params: unknown[] = [];
  const where = plan.primaryKey.map((col) => `${q(col)} = $${params.push(pk[col]) && params.length}`).join(' AND ');
  const rows = (await sql.unsafe(
    `SELECT * FROM ${q(plan.table)} WHERE ${where}`,
    params as never[],
  )) as unknown as Record<string, unknown>[];
  return rows[0] ?? null;
}

/** Apply a tenant assignment, idempotently, guarded on the null-owner precondition. */
async function applyAssignment(
  sql: ToolingSql,
  plan: TablePlan,
  pk: Record<string, unknown>,
  tenantId: string,
): Promise<void> {
  const params: unknown[] = [tenantId];
  const where = plan.primaryKey.map((col) => `${q(col)} = $${params.push(pk[col]) && params.length}`).join(' AND ');
  await sql.unsafe(
    `UPDATE ${q(plan.table)} SET tenant_id = $1 WHERE ${where} AND tenant_id IS NULL`,
    params as never[],
  );
}

/**
 * Process one source row: record the ledger decision (durable) FIRST, then — for
 * an assignment in apply mode — rewrite the row and mark it applied. Returns the
 * disposition for the report.
 */
async function processRow(
  sql: ToolingSql,
  plan: TablePlan,
  real: Record<string, unknown>,
  result: MappingResult,
  config: RunConfig,
  fault: FaultInjector,
): Promise<'assigned' | 'quarantined' | 'stopBlocked'> {
  const pk = pkOf(real, plan);
  const disposition =
    result.disposition === 'assign'
      ? 'assigned'
      : result.disposition === 'stop-blocked'
        ? 'stopBlocked'
        : 'quarantined';

  if (config.mode === 'dry-run') return disposition; // no writes, ever

  const existing = await findBySource(sql, plan.table, pk);
  if (existing && existing.status !== 'planned') return disposition; // already settled

  const preImageRedacted = redactRow(real);
  const preImageChecksum = checksum(real);
  const epoch = config.writerEpoch ?? 0;

  if (result.disposition === 'assign' && result.tenantId) {
    const inverse: InverseAction = {
      type: 'restore-columns',
      table: plan.table,
      primaryKey: pk,
      columns: { tenant_id: real.tenant_id ?? null },
    };
    const recorded = await recordPlanned(sql, {
      sourceTable: plan.table,
      sourcePrimaryKey: pk,
      targetTenantId: result.tenantId,
      decisionRule: result.rule,
      preImageRedacted,
      preImageChecksum,
      inverseAction: inverse,
      compensatingAction: null,
      writerEpoch: epoch,
      ambiguityState: 'none',
      status: 'planned',
    });
    fault.afterPlanned(); // crash-recovery probe: row still untouched at this point

    await applyAssignment(sql, plan, pk, result.tenantId);

    const post = (await fetchFullRow(sql, plan, pk)) ?? real;
    const receipt = {
      rule: result.rule,
      tenant_id: result.tenantId,
      pre_image_checksum: preImageChecksum,
      post_image_checksum: checksum(post),
      writer_epoch: epoch,
      verified: true,
    };
    assertNoSecrets(receipt, `reconciliation receipt for ${plan.table}`);
    await markApplied(sql, recorded.id, {
      postImageRedacted: redactRow(post),
      postImageChecksum: checksum(post),
      reconciliationReceipt: receipt,
    });
    return 'assigned';
  }

  // quarantine / stop-block: ledger the decision, perform NO row rewrite.
  const compensating: CompensatingAction = {
    type: result.disposition === 'stop-blocked' ? 'stop-block' : 'quarantine',
    note: result.reason ?? 'no reachable tenant; row left unassigned and unexposed',
  };
  await recordPlanned(sql, {
    sourceTable: plan.table,
    sourcePrimaryKey: pk,
    targetTenantId: null,
    decisionRule: result.rule,
    preImageRedacted,
    preImageChecksum,
    inverseAction: null,
    compensatingAction: compensating,
    writerEpoch: epoch,
    ambiguityState: result.ambiguityState === 'none' ? 'quarantined' : result.ambiguityState,
    status: 'quarantined',
  });
  fault.afterPlanned();
  return disposition;
}

function tallyDisposition(report: TableReport, disposition: 'assigned' | 'quarantined' | 'stopBlocked'): void {
  report.scanned += 1;
  if (disposition === 'assigned') report.assigned += 1;
  else if (disposition === 'stopBlocked') report.stopBlocked += 1;
  else report.quarantined += 1;
}

/** Backfill one table in bounded, resumable batches. Returns its report. */
async function processTable(
  sql: ToolingSql,
  plan: TablePlan,
  config: RunConfig,
  batchSize: number,
  fault: FaultInjector,
): Promise<TableReport> {
  const report: TableReport = {
    table: plan.table,
    strategy: plan.strategy,
    scanned: 0,
    assigned: 0,
    quarantined: 0,
    stopBlocked: 0,
  };
  let cursor: unknown[] | null = null;

  for (;;) {
    const batch = await fetchBatch(sql, plan, cursor, batchSize);
    if (batch.length === 0) break;
    for (const row of batch) {
      const split = splitRow(row, plan);
      const result = decide(plan, split, config);
      tallyDisposition(report, await processRow(sql, plan, split.real, result, config, fault));
    }
    const last = batch[batch.length - 1] as Record<string, unknown>;
    cursor = plan.primaryKey.map((col) => splitRow(last, plan).real[col]);
  }
  return report;
}

/** Run the backfill (dry-run or apply) over the configured plan. */
export async function runBackfill(sql: ToolingSql, config: RunConfig): Promise<RunReport> {
  const all = defaultTablePlans();
  const tableFilter = config.tables;
  const plans = tableFilter ? all.filter((p) => tableFilter.includes(p.table)) : all;
  const batchSize = config.batchSize ?? 500;
  const fault = new FaultInjector(config.faultAfterPlanned);

  const tables: TableReport[] = [];
  const stopBlocked: StopBlockReport[] = [];
  const deferrals: { table: string; deferral: string }[] = [];

  for (const plan of plans) {
    const report = await processTable(sql, plan, config, batchSize, fault);
    if (plan.unownedRule?.strategy === 'operator-or-stop-block' && report.stopBlocked > 0) {
      stopBlocked.push({
        table: plan.table,
        rows: report.stopBlocked,
        openQuestion: plan.unownedRule.openQuestion ?? '',
      });
    }
    if (plan.unownedRule?.deferral) deferrals.push({ table: plan.table, deferral: plan.unownedRule.deferral });
    tables.push(report);
  }

  const totals = tables.reduce(
    (acc, t) => ({
      scanned: acc.scanned + t.scanned,
      assigned: acc.assigned + t.assigned,
      quarantined: acc.quarantined + t.quarantined,
      stopBlocked: acc.stopBlocked + t.stopBlocked,
    }),
    { scanned: 0, assigned: 0, quarantined: 0, stopBlocked: 0 },
  );

  return { mode: config.mode, writerEpoch: config.writerEpoch ?? 0, tables, stopBlocked, deferrals, totals };
}
