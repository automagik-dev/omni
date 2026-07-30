/**
 * Mapping rules engine (wish: omni-full-multitenancy, Group G6).
 *
 * Implements the WISH "Legacy mapping rules" and `LEGACY_MAPPING_DECISIONS.yaml`
 * LITERALLY, as pure functions over already-fetched ownership facts:
 *
 *   * Every current instance receives ONE explicitly approved tenant mapping
 *     (the `instance -> tenant` input). An instance with no mapping is never
 *     guessed — it quarantines.
 *   * Descendants derive tenant from COMPOSITE ownership paths and are reconciled
 *     against ALL reachable parents: every present FK-covered parent must resolve
 *     to a tenant and they must agree. Conflicting parents quarantine; a row with
 *     no reachable tenant parent quarantines as an orphan; a row whose reachable
 *     parent is itself unresolved quarantines rather than being assigned on
 *     partial evidence.
 *   * Nothing is ever silently defaulted to a platform/global tenant.
 *
 * This module is deliberately DB-free: the engine that walks the cluster
 * (`engine.ts`) fetches each row's parent tenant ids and the operator inputs,
 * then calls these functions. That keeps every ownership decision unit-testable
 * without a server and identical between dry-run and apply.
 *
 * The SEVEN parentless `unowned` tables are handled in `unowned-rules.ts`, which
 * composes the primitives here. "Implemented here" for those tables means those
 * NEW G6 modules — never an edit to the read-only `tenancy-ownership.ts`.
 */

/** A single ownership decision the engine will act on (or refuse to). */
export type MappingDisposition = 'assign' | 'quarantine' | 'stop-blocked';

export interface MappingResult {
  readonly disposition: MappingDisposition;
  /** Set only when `disposition === 'assign'`. */
  readonly tenantId: string | null;
  /** Ledger `ambiguity_state`. `none` only for an assignment. */
  readonly ambiguityState: 'none' | 'ambiguous' | 'quarantined';
  /** Human-readable `decision_rule`, recorded verbatim in the ledger. */
  readonly rule: string;
  /** Populated for quarantine/stop-block; never contains row values. */
  readonly reason?: string;
}

/**
 * Explicit, operator-approved `instance id -> tenant id` mappings — the one
 * sanctioned root input. Keys are instance UUIDs; values are tenant UUIDs.
 */
export type InstanceTenantMap = ReadonlyMap<string, string>;

/**
 * Sanctioned per-table / per-row operator ownership input for tables the
 * decision table is SILENT on. Outer key is the SQL table, inner key is the
 * row's primary-key JSON (canonical form), value is the tenant UUID.
 */
export type OperatorRowMap = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** A present FK-covered parent's resolved tenant, or `null` if not yet known. */
export type ParentTenant = string | null;

/**
 * Composite-ownership derivation over the parents PRESENT on a row.
 *
 * `presentParents` holds one entry per FK-covered parent column that was NON-NULL
 * on the child: the value is that parent row's tenant id, or `null` when the
 * parent exists but its own tenant is not yet resolved. Absent (null-FK) parents
 * are simply not included. `totalParentColumns` is how many parent columns the
 * table has, so "no reachable parent at all" is distinguishable from "one
 * reachable parent that is unresolved".
 */
export function deriveComposite(
  presentParents: readonly ParentTenant[],
  totalParentColumns: number,
  ruleLabel: string,
): MappingResult {
  const resolved = presentParents.filter((tenant): tenant is string => tenant !== null);
  const distinct = [...new Set(resolved)];
  const unresolvedCount = presentParents.length - resolved.length;

  // Conflicting parents are never silently merged — the sharpest failure mode.
  if (distinct.length > 1) {
    return {
      disposition: 'quarantine',
      tenantId: null,
      ambiguityState: 'ambiguous',
      rule: ruleLabel,
      reason: `conflicting parents resolve to ${distinct.length} tenants`,
    };
  }

  // A reachable parent that is itself unresolved means the composite path is not
  // fully reconciled; assigning on partial evidence is exactly the guess the
  // decision table forbids.
  if (unresolvedCount > 0) {
    return {
      disposition: 'quarantine',
      tenantId: null,
      ambiguityState: 'quarantined',
      rule: ruleLabel,
      reason: `${unresolvedCount} reachable parent(s) not yet resolved`,
    };
  }

  if (distinct.length === 1) {
    return { disposition: 'assign', tenantId: distinct[0] as string, ambiguityState: 'none', rule: ruleLabel };
  }

  // No present parent at all: an orphan with no ownership path.
  return {
    disposition: 'quarantine',
    tenantId: null,
    ambiguityState: 'quarantined',
    rule: ruleLabel,
    reason: totalParentColumns > 0 ? 'no reachable tenant parent (orphan)' : 'table has no ownership parent',
  };
}

/**
 * Root-table mapping: the tenant comes ONLY from the explicit operator
 * `instance -> tenant` input. An instance with no mapping quarantines; it is
 * never assigned a guessed tenant.
 */
export function mapRootInstance(instanceId: string, mappings: InstanceTenantMap): MappingResult {
  const tenantId = mappings.get(instanceId);
  if (tenantId) {
    return {
      disposition: 'assign',
      tenantId,
      ambiguityState: 'none',
      rule: 'root: explicit operator instance->tenant mapping',
    };
  }
  return {
    disposition: 'quarantine',
    tenantId: null,
    ambiguityState: 'quarantined',
    rule: 'root: explicit operator instance->tenant mapping',
    reason: 'instance has no approved tenant mapping',
  };
}

/**
 * Look up a sanctioned per-row operator mapping for a silent-decision table.
 * Returns `null` when the operator supplied none for this row.
 */
export function operatorTenantFor(
  table: string,
  primaryKeyCanonical: string,
  operatorMap: OperatorRowMap,
): string | null {
  return operatorMap.get(table)?.get(primaryKeyCanonical) ?? null;
}
