/**
 * Ownership rules for the SEVEN parentless `unowned` tables
 * (wish: omni-full-multitenancy, Group G6).
 *
 * `tenancy-ownership.ts` is READ-ONLY for G6: it declares seven tables with
 * `derivation: 'unowned'` — `persons`, `conversations`, `dead_letter_events`,
 * `event_payloads`, `webhook_sources`, `automations`, `processed_events` — and
 * defers their ownership to "the G6 backfill". This module is that resolution,
 * implemented HERE (a new G6 module), never by editing the frozen spec.
 *
 * Per `LEGACY_MAPPING_DECISIONS.yaml` and the WISH "Legacy mapping rules", each
 * unowned table gets EXACTLY the rule the live schema can express:
 *
 *   * `persons` — `global_persons_and_identities` clone rule (ADR-0002). Resolved
 *     by `person-clone.ts`; declared here as strategy `clone`.
 *   * `dead_letter_events`, `event_payloads`, `processed_events` — the
 *     `events_jobs_backlogs` pattern: derive tenant from the OWNING event by
 *     joining the row's varchar `event_id` to `omni_events`. `processed_events`
 *     additionally carries a G0 rule ("tenant in the idempotency/primary key")
 *     that needs a PRIMARY KEY rewrite; that rewrite is OUT of G6 (no schema
 *     changes), so tenant is assigned via the owning event and the PK-rewrite is
 *     recorded as a NAMED DEFERRAL.
 *   * `automations`, `conversations`, `webhook_sources` — the decision table is
 *     SILENT and the live schema has NO parent column to derive from. G6 does not
 *     invent ownership: unless an explicit operator mapping input is supplied,
 *     their rows quarantine and the table is reported STOP-BLOCKED BY NAME with
 *     the exact open question.
 */

import { TENANT_OWNERSHIP_SPECS } from '../tenancy-ownership';
import { type MappingResult, type OperatorRowMap, deriveComposite, operatorTenantFor } from './mapping-engine';

export type UnownedStrategy = 'clone' | 'derive-from-event' | 'operator-or-stop-block';

export interface UnownedTableRule {
  readonly table: string;
  readonly strategy: UnownedStrategy;
  /** derive-from-event: the varchar column on this table holding the event id. */
  readonly eventIdColumn?: string;
  /**
   * derive-from-event: how `eventIdColumn` joins to the owning event. The NATS
   * event id is a UUID-shaped string, so it matches `omni_events.id::text`.
   */
  readonly eventJoin?: { readonly parentTable: 'omni_events'; readonly parentColumn: 'id'; readonly castText: true };
  /** A named deferral this rule cannot perform within the G6 (no-schema) boundary. */
  readonly deferral?: string;
  /** Where the rule comes from in the frozen G0 inputs. */
  readonly decisionSource: string;
  /** For operator-or-stop-block tables: the exact open question, reported by name. */
  readonly openQuestion?: string;
}

/**
 * The rules, one per unowned table. Asserted in the tests to be EXACTLY the set
 * of `derivation: 'unowned'` tables in `tenancy-ownership.ts`, so this cannot
 * drift from the frozen spec.
 */
export const UNOWNED_TABLE_RULES: readonly UnownedTableRule[] = [
  {
    table: 'persons',
    strategy: 'clone',
    decisionSource: 'LEGACY_MAPPING_DECISIONS.yaml:global_persons_and_identities (tenant_clone); ADR-0002',
  },
  {
    table: 'dead_letter_events',
    strategy: 'derive-from-event',
    eventIdColumn: 'event_id',
    eventJoin: { parentTable: 'omni_events', parentColumn: 'id', castText: true },
    decisionSource: 'LEGACY_MAPPING_DECISIONS.yaml:events_jobs_backlogs (derive_or_quarantine)',
  },
  {
    table: 'event_payloads',
    strategy: 'derive-from-event',
    eventIdColumn: 'event_id',
    eventJoin: { parentTable: 'omni_events', parentColumn: 'id', castText: true },
    decisionSource: 'LEGACY_MAPPING_DECISIONS.yaml:events_jobs_backlogs (derive_or_quarantine)',
  },
  {
    table: 'processed_events',
    strategy: 'derive-from-event',
    eventIdColumn: 'event_id',
    eventJoin: { parentTable: 'omni_events', parentColumn: 'id', castText: true },
    deferral:
      'G0 rule requires tenant in the (event_id, handler) PRIMARY KEY. A primary-key rewrite is a destructive ALTER ' +
      'and is OUT of the G6 no-schema-change boundary; G6 assigns tenant via the owning event and defers the ' +
      'PK-rewrite to the constraint-enforcement group (G8+).',
    decisionSource:
      'LEGACY_MAPPING_DECISIONS.yaml:events_jobs_backlogs (derive_or_quarantine); tenancy-ownership.ts processed_events G0 rule',
  },
  {
    table: 'automations',
    strategy: 'operator-or-stop-block',
    decisionSource: 'LEGACY_MAPPING_DECISIONS.yaml is SILENT on automations',
    openQuestion:
      'automations has no instance_id/creator column in the live schema and the decision table names no rule for it. ' +
      'Which tenant owns each legacy automation? Requires an explicit operator per-row mapping input or a G0 rule.',
  },
  {
    table: 'conversations',
    strategy: 'operator-or-stop-block',
    decisionSource: 'LEGACY_MAPPING_DECISIONS.yaml is SILENT on conversations',
    openQuestion:
      'conversations has no instance_id/chat column in the live schema (only id/title/summary/state) and the decision ' +
      'table names no rule for it. Which tenant owns each legacy conversation? Requires an explicit operator per-row ' +
      'mapping input or a G0 rule.',
  },
  {
    table: 'webhook_sources',
    strategy: 'operator-or-stop-block',
    decisionSource: 'LEGACY_MAPPING_DECISIONS.yaml is SILENT on webhook_sources',
    openQuestion:
      'webhook_sources has no instance_id column in the live schema and the decision table names no rule for it. ' +
      'Which tenant owns each legacy webhook source? Requires an explicit operator per-row mapping input or a G0 rule.',
  },
];

/** The frozen set of `unowned` tables, derived from the read-only spec. */
export const UNOWNED_TABLES_FROM_SPEC: readonly string[] = TENANT_OWNERSHIP_SPECS.filter(
  (spec) => spec.derivation === 'unowned',
).map((spec) => spec.table);

export function getUnownedRule(table: string): UnownedTableRule | undefined {
  return UNOWNED_TABLE_RULES.find((rule) => rule.table === table);
}

/** Tables that are stop-blocked absent an operator mapping. */
export const STOP_BLOCKED_TABLES: readonly string[] = UNOWNED_TABLE_RULES.filter(
  (rule) => rule.strategy === 'operator-or-stop-block',
).map((rule) => rule.table);

/**
 * Derive-from-event classification for one row.
 *
 * `owningEventTenant` is the tenant of the joined `omni_events` row: a string
 * when the event is resolved, `null` when the event exists but its own tenant is
 * not yet assigned, and `undefined` when NO event matched the row's `event_id`.
 */
export function classifyDeriveFromEvent(
  rule: UnownedTableRule,
  owningEventTenant: string | null | undefined,
): MappingResult {
  const ruleLabel = `unowned:${rule.table} derive-from-owning-event (${rule.eventIdColumn} -> omni_events.id)`;
  if (owningEventTenant === undefined) {
    return {
      disposition: 'quarantine',
      tenantId: null,
      ambiguityState: 'quarantined',
      rule: ruleLabel,
      reason: `no owning omni_events row matches ${rule.eventIdColumn}`,
    };
  }
  // One reachable "parent": the owning event. deriveComposite handles the
  // resolved / unresolved cases identically to any other derived table.
  return deriveComposite([owningEventTenant], 1, ruleLabel);
}

/**
 * Operator-or-stop-block classification for one row of a silent-decision table.
 * Uses the operator mapping when present; otherwise STOP-BLOCKS by name.
 */
export function classifyOperatorOrStopBlock(
  rule: UnownedTableRule,
  primaryKeyCanonical: string,
  operatorMap: OperatorRowMap,
): MappingResult {
  const tenantId = operatorTenantFor(rule.table, primaryKeyCanonical, operatorMap);
  if (tenantId) {
    return {
      disposition: 'assign',
      tenantId,
      ambiguityState: 'none',
      rule: `unowned:${rule.table} explicit operator per-row mapping`,
    };
  }
  return {
    disposition: 'stop-blocked',
    tenantId: null,
    ambiguityState: 'quarantined',
    rule: `unowned:${rule.table} SILENT in decision table; no operator mapping supplied`,
    reason: rule.openQuestion,
  };
}
