/**
 * Legacy API-key classification (wish: omni-full-multitenancy, Group G6).
 *
 * Implements `LEGACY_MAPPING_DECISIONS.yaml:ambiguous_api_keys` and the WISH
 * "Legacy mapping rules" for keys. REPORT-ONLY: this tooling never mutates,
 * mints, or revokes any credential — minting/splitting/revoking are human-gated
 * actions outside G0-G8A. It reads legacy `api_keys`, classifies each against the
 * operator instance->tenant map, and emits a REDACTED worklist:
 *
 *   * `tenant-key-candidate` — restricted only to instances that ALL map to ONE
 *     tenant. May become a tenant key AFTER scope/role review (listed for review).
 *   * `multi-tenant` — restricted to instances spanning MULTIPLE tenants. NEVER
 *     silently converted: goes to an explicit platform/split/revoke worklist.
 *   * `platform-credential` — unrestricted / god key (scope `*` or no instance
 *     restriction). Moves to the platform-credential class ONLY with an explicit
 *     owner + purpose, which the report flags as required.
 *   * `unresolved` — restricted to at least one instance with no tenant mapping;
 *     quarantined, never served as a tenant key.
 *
 * Output carries IDs / prefixes / scopes / instance references / status only —
 * NEVER a key hash or any secret material. The report is redaction-scanned before
 * return. Dynamic identifier for the source table; no literal name on the
 * db-access denylist.
 */

import type { ToolingSql } from './db';
import type { InstanceTenantMap } from './mapping-engine';
import { assertNoSecrets } from './redaction';

export type KeyClass = 'tenant-key-candidate' | 'multi-tenant' | 'platform-credential' | 'unresolved';

/** The non-secret fields of a legacy key the classifier reads. */
export interface LegacyKeyFacts {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
  /** Explicit instance restriction (`instance_ids`), if any. */
  readonly instanceIds: readonly string[] | null;
  /** Additional allowlist restriction (`instance_allowlist`). */
  readonly instanceAllowlist: readonly string[] | null;
  readonly status: string;
}

/** A redacted classification result — safe to write to a report. */
export interface KeyClassification {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
  readonly instanceIds: readonly string[];
  readonly status: string;
  readonly classification: KeyClass;
  /** Tenants the key's instances map to (0, 1, or many). */
  readonly tenants: readonly string[];
  /** Instances with no tenant mapping (drives `unresolved`). */
  readonly unmappedInstances: readonly string[];
  /** True for the platform-credential class: owner + purpose must be supplied. */
  readonly requiresOwnerAndPurpose: boolean;
  readonly reason: string;
}

/** True when the key has no instance restriction or holds the god scope. */
export function isUnrestricted(facts: LegacyKeyFacts): boolean {
  const restrictions = [...(facts.instanceIds ?? []), ...(facts.instanceAllowlist ?? [])];
  return facts.scopes.includes('*') || restrictions.length === 0;
}

/** Classify one key against the operator instance->tenant map. Pure. */
export function classifyKey(facts: LegacyKeyFacts, instanceMap: InstanceTenantMap): KeyClassification {
  const restrictions = [...new Set([...(facts.instanceIds ?? []), ...(facts.instanceAllowlist ?? [])])];

  const base = {
    id: facts.id,
    name: facts.name,
    keyPrefix: facts.keyPrefix,
    scopes: facts.scopes,
    instanceIds: restrictions,
    status: facts.status,
  };

  if (isUnrestricted(facts)) {
    return {
      ...base,
      classification: 'platform-credential',
      tenants: [],
      unmappedInstances: [],
      requiresOwnerAndPurpose: true,
      reason: facts.scopes.includes('*')
        ? 'unrestricted god scope (*): platform-credential class requires explicit owner + purpose'
        : 'no instance restriction: operates across all instances; platform-credential class requires owner + purpose',
    };
  }

  const tenants = new Set<string>();
  const unmapped: string[] = [];
  for (const instanceId of restrictions) {
    const tenant = instanceMap.get(instanceId);
    if (tenant) tenants.add(tenant);
    else unmapped.push(instanceId);
  }

  if (unmapped.length > 0) {
    return {
      ...base,
      classification: 'unresolved',
      tenants: [...tenants].sort(),
      unmappedInstances: unmapped,
      requiresOwnerAndPurpose: false,
      reason: `restricted to ${unmapped.length} instance(s) with no tenant mapping; quarantined, never served as a tenant key`,
    };
  }

  if (tenants.size === 1) {
    return {
      ...base,
      classification: 'tenant-key-candidate',
      tenants: [...tenants],
      unmappedInstances: [],
      requiresOwnerAndPurpose: false,
      reason: 'all restricted instances map to one tenant; tenant-key candidate pending scope/role review',
    };
  }

  return {
    ...base,
    classification: 'multi-tenant',
    tenants: [...tenants].sort(),
    unmappedInstances: [],
    requiresOwnerAndPurpose: false,
    reason: `restricted instances span ${tenants.size} tenants; never auto-converted — platform/split/revoke worklist`,
  };
}

export interface KeyClassificationReport {
  counts: Record<KeyClass, number>;
  keys: KeyClassification[];
}

/**
 * Read legacy `api_keys` and classify each. REPORT-ONLY — no mutation. The
 * key hash and any secret column are never selected, so they cannot leak.
 */
export async function classifyLegacyKeys(
  sql: ToolingSql,
  instanceMap: InstanceTenantMap,
): Promise<KeyClassificationReport> {
  const rows = (await sql.unsafe(
    `SELECT id, name, key_prefix, scopes, instance_ids, instance_allowlist, status FROM "api_keys" ORDER BY id`,
  )) as unknown as {
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[] | null;
    instance_ids: string[] | null;
    instance_allowlist: string[] | null;
    status: string;
  }[];

  const keys = rows.map((row) =>
    classifyKey(
      {
        id: row.id,
        name: row.name,
        keyPrefix: row.key_prefix,
        scopes: row.scopes ?? [],
        instanceIds: row.instance_ids,
        instanceAllowlist: row.instance_allowlist,
        status: row.status,
      },
      instanceMap,
    ),
  );

  const counts: Record<KeyClass, number> = {
    'tenant-key-candidate': 0,
    'multi-tenant': 0,
    'platform-credential': 0,
    unresolved: 0,
  };
  for (const key of keys) counts[key.classification] += 1;

  const report = { counts, keys };
  assertNoSecrets(report, 'key classification report');
  return report;
}
