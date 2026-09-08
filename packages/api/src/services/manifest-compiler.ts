/**
 * Manifest compiler (RFC #925 G4b, issue #986).
 *
 * Compiles an agent's declarative event manifest (`agents.event_manifest`,
 * stored by G4a/#985) into MANAGED routing automations: one automation per
 * `accepts` entry, triggering on the entry's event type, narrowed by the
 * entry's `filter` translated into automation conditions (dot-path field →
 * `eq`, AND — the exact matcher semantics the manifest schema's JSDoc
 * references), and dispatching a `call_agent` action to the declaring agent.
 *
 * Compiled rows carry `managed_by_agent_id` (migration 0063): the manifest is
 * the source of truth and the `automations` table is the compiled plan, not
 * the source of truth. Manual CRUD of managed rows is rejected by
 * `AutomationService`; this service is the ONLY writer, and it writes through
 * the raw scoped handle (the internal path) rather than the service CRUD.
 *
 * Reconciliation mirrors the automation engine's subscription reconciler
 * (engine.ts `doReconcileSubscriptions`): diff desired vs existing, create the
 * missing, converge the drifted, delete the no-longer-declared. Recompiling an
 * unchanged manifest is a strict no-op — no row churn, no events.
 */

import { createHash } from 'node:crypto';
import type { AgentEventManifest, AutomationAction, AutomationCondition, EventBus } from '@omni/core';
import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type Automation, automations } from '@omni/db';
import { eq } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';
import type { AutomationService } from './automations';

const logger = createLogger('api:manifest-compiler');

/** The agent identity the compiler needs (a subset of the `agents` row). */
export interface CompiledAgentRef {
  id: string;
  name: string;
}

/**
 * The desired shape of one compiled automation — exactly the columns the
 * reconciler owns. Everything outside this shape (id, timestamps, tenant) is
 * left to the database.
 */
export interface DesiredCompiledAutomation {
  name: string;
  description: string;
  triggerEventType: string;
  triggerConditions: AutomationCondition[] | null;
  conditionLogic: 'and';
  actions: AutomationAction[];
  debounce: null;
  enabled: boolean;
  priority: number;
  transactionalEmissions: boolean;
  managedByAgentId: string;
}

/** The reconciliation outcome, also the payload of the compiled event. */
export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
}

/** Automations `name` is varchar(255); compiled names must always fit. */
const MAX_AUTOMATION_NAME_LENGTH = 255;

/**
 * JSON.stringify with objects' keys sorted recursively, so semantically equal
 * filters always serialize identically (hash input + drift comparison).
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Translate a manifest `filter` into automation conditions: each key is a
 * dot-notation payload path matched with `eq`, combined with AND — the
 * matcher semantics documented on `ManifestAcceptsEntrySchema`. Keys are
 * sorted so the compiled conditions are deterministic. An absent or empty
 * filter compiles to NULL (unconditional trigger).
 */
export function filterToConditions(filter: Record<string, unknown> | undefined): AutomationCondition[] | null {
  if (!filter) return null;
  const fields = Object.keys(filter).sort();
  if (fields.length === 0) return null;
  return fields.map((field) => ({ field, operator: 'eq' as const, value: filter[field] }));
}

/**
 * Deterministic name for one compiled automation:
 * `manifest:{agentId}:{event}#{hash12}` where the hash covers event + filter.
 * The hash makes two entries for the same event with different filters
 * distinct, and the name is the reconciliation key — stable across recompiles
 * of the same declaration. The event segment is truncated if (and only if) the
 * name would overflow the varchar(255) column; identity stays in the hash.
 */
export function compiledAutomationName(
  agentId: string,
  entry: { event: string; filter?: Record<string, unknown> },
): string {
  const digest = createHash('sha256')
    .update(stableStringify({ event: entry.event, filter: entry.filter ?? null }))
    .digest('hex')
    .slice(0, 12);
  const prefix = `manifest:${agentId}:`;
  const suffix = `#${digest}`;
  const room = MAX_AUTOMATION_NAME_LENGTH - prefix.length - suffix.length;
  const event = entry.event.length > room ? entry.event.slice(0, room) : entry.event;
  return `${prefix}${event}${suffix}`;
}

/**
 * Compile a manifest into the DESIRED set of managed automations for an
 * agent — one per `accepts` entry, deduplicated by compiled name (two
 * identical declarations collapse to one row). A null manifest compiles to
 * the empty set (reconciliation then deletes every compiled row).
 */
export function compileManifest(
  agent: CompiledAgentRef,
  manifest: AgentEventManifest | null,
): DesiredCompiledAutomation[] {
  const desired = new Map<string, DesiredCompiledAutomation>();
  for (const entry of manifest?.accepts ?? []) {
    const name = compiledAutomationName(agent.id, entry);
    desired.set(name, {
      name,
      description: `Compiled from the event manifest of agent ${agent.id} (RFC #925 G4b). Do not edit by hand — apply the agent's manifest instead (omni agents manifest apply).`,
      triggerEventType: entry.event,
      triggerConditions: filterToConditions(entry.filter),
      conditionLogic: 'and',
      // Minimal event→agent dispatch config: the runtime derives instance,
      // chat, sender, and message content from the triggering event's payload
      // (see extractAgentCallContext in @omni/core automations/actions.ts).
      actions: [{ type: 'call_agent', config: { agentId: agent.id } }],
      debounce: null,
      enabled: true,
      priority: 0,
      transactionalEmissions: false,
      managedByAgentId: agent.id,
    });
  }
  return [...desired.values()];
}

/** The columns the reconciler owns, projected from an existing row. */
function ownedShape(row: DesiredCompiledAutomation | Automation): Record<string, unknown> {
  return {
    name: row.name,
    description: row.description ?? null,
    triggerEventType: row.triggerEventType,
    triggerConditions: row.triggerConditions ?? null,
    // The DB column defaults to 'and' and allows NULL; both mean AND.
    conditionLogic: row.conditionLogic ?? 'and',
    actions: row.actions,
    debounce: row.debounce ?? null,
    enabled: row.enabled,
    priority: row.priority,
    transactionalEmissions: row.transactionalEmissions ?? false,
  };
}

/** Deep equality over the reconciler-owned columns. */
function isConverged(desired: DesiredCompiledAutomation, existing: Automation): boolean {
  return stableStringify(ownedShape(desired)) === stableStringify(ownedShape(existing));
}

export interface CompiledDiff {
  toCreate: DesiredCompiledAutomation[];
  toUpdate: Array<{ id: string; desired: DesiredCompiledAutomation }>;
  toDelete: Array<{ id: string; name: string }>;
}

/**
 * Diff the desired set against the agent's existing compiled rows, keyed by
 * the deterministic name. Pure — exercised directly by unit tests.
 */
export function diffCompiledAutomations(desired: DesiredCompiledAutomation[], existing: Automation[]): CompiledDiff {
  const existingByName = new Map(existing.map((row) => [row.name, row]));
  const desiredNames = new Set(desired.map((row) => row.name));

  const toCreate: CompiledDiff['toCreate'] = [];
  const toUpdate: CompiledDiff['toUpdate'] = [];
  for (const want of desired) {
    const have = existingByName.get(want.name);
    if (!have) {
      toCreate.push(want);
    } else if (!isConverged(want, have)) {
      toUpdate.push({ id: have.id, desired: want });
    }
  }

  const toDelete = existing.filter((row) => !desiredNames.has(row.name)).map((row) => ({ id: row.id, name: row.name }));

  return { toCreate, toUpdate, toDelete };
}

export class ManifestCompilerService {
  /**
   * The handle every query uses — the request's tenant-stamped transaction
   * inside a tenant scope, the ambient pool otherwise (same contract as every
   * other service; see `tenancy/tenant-scope.ts`).
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(
    private readonly pool: Database,
    private readonly eventBus: EventBus | null,
    /**
     * The compiler bypasses AutomationService CRUD (managed rows reject it)
     * but still needs `reloadEngine()` so a converged plan is picked up by
     * the running engine, exactly as hand-made CRUD does.
     */
    private readonly automations: AutomationService,
  ) {}

  /**
   * Converge the agent's compiled automations onto its manifest: create the
   * missing, update the drifted, delete the no-longer-declared. Idempotent —
   * an unchanged manifest produces zero writes, no engine reload, and no
   * event. Publishes `system.agent.manifest.compiled` when the plan changed.
   *
   * Pass `manifest: null` to tear the compiled plan down (agent deletion).
   */
  async reconcileAgent(agent: CompiledAgentRef, manifest: AgentEventManifest | null): Promise<ReconcileResult> {
    const desired = compileManifest(agent, manifest);
    const existing = await this.db.select().from(automations).where(eq(automations.managedByAgentId, agent.id));
    const { toCreate, toUpdate, toDelete } = diffCompiledAutomations(desired, existing);

    const result: ReconcileResult = {
      created: toCreate.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
    };
    if (result.created === 0 && result.updated === 0 && result.deleted === 0) {
      return result;
    }

    for (const row of toCreate) {
      await this.db.insert(automations).values(row);
    }
    for (const { id, desired: want } of toUpdate) {
      await this.db
        .update(automations)
        .set({ ...want, updatedAt: new Date() })
        .where(eq(automations.id, id));
    }
    for (const { id } of toDelete) {
      await this.db.delete(automations).where(eq(automations.id, id));
    }

    await this.automations.reloadEngine();

    logger.info('Reconciled compiled automations from agent manifest', { agentId: agent.id, ...result });

    if (this.eventBus) {
      await this.eventBus.publishGeneric('system.agent.manifest.compiled', {
        agentId: agent.id,
        name: agent.name,
        ...result,
      });
    }

    return result;
  }
}
