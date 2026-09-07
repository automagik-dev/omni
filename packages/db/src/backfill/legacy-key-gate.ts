/**
 * Legacy god-key gate for the platform-credential bootstrap (issue #980).
 *
 * A thin, REPORT-ONLY composition over the G6 legacy-key classifier: before an
 * operator mints the first PLATFORM-class credential, any legacy `api_keys`
 * rows that classify as `platform-credential` (unrestricted / god scope `*`)
 * are surfaced as a worklist that requires an EXPLICIT operator decision. This
 * module never mutates, mints, converts, or revokes anything — exactly like
 * `key-classification.ts` it wraps.
 *
 * Tooling-only, like every module in this directory: imported by direct path
 * from `scripts/bootstrap-platform-credential.ts` and tests, never barrelled
 * through `@omni/db` and never imported by runtime code
 * (see `runtime-isolation.test.ts`).
 */

import type { ToolingSql } from './db';
import { type KeyClass, type KeyClassification, classifyLegacyKeys } from './key-classification';
import type { InstanceTenantMap } from './mapping-engine';
import { assertNoSecrets } from './redaction';

export interface LegacyKeyGateReport {
  /** Total legacy `api_keys` rows inspected. */
  totalLegacyKeys: number;
  /** Classification counts across all legacy keys. */
  counts: Record<KeyClass, number>;
  /**
   * ACTIVE keys classified `platform-credential` (god scope `*` or no instance
   * restriction). Each requires an explicit owner + purpose decision before it
   * may ever move classes — the bootstrap NEVER converts one automatically.
   */
  godKeyWorklist: KeyClassification[];
  /**
   * True when active god keys exist: the bootstrap entrypoint stops and
   * requires the operator to explicitly acknowledge the worklist before
   * proceeding (proceeding still converts nothing).
   */
  requiresExplicitDecision: boolean;
}

/**
 * Classify legacy keys and extract the god-key worklist. Pass the operator
 * instance->tenant map when one exists; the default empty map is safe for the
 * god-key gate because unrestricted/god keys classify `platform-credential`
 * regardless of any mapping.
 */
export async function auditLegacyKeysForBootstrap(
  sql: ToolingSql,
  instanceMap: InstanceTenantMap = new Map(),
): Promise<LegacyKeyGateReport> {
  const classification = await classifyLegacyKeys(sql, instanceMap);
  const godKeyWorklist = classification.keys.filter(
    (key) => key.classification === 'platform-credential' && key.status === 'active',
  );
  const report: LegacyKeyGateReport = {
    totalLegacyKeys: classification.keys.length,
    counts: classification.counts,
    godKeyWorklist,
    requiresExplicitDecision: godKeyWorklist.length > 0,
  };
  assertNoSecrets(report, 'legacy key gate report');
  return report;
}
