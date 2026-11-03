/**
 * Paired-agent source grant writer (paired-agents slice 2, follow-up 1).
 *
 * The grant read clause in `services/event-consumers.ts` matches a grant to a row
 * with `coalesce(grant.tenant_id::text, '') = coalesce(row.tenant_id::text, '')`,
 * so a grant's `tenant_id` decides which rows it can ever deliver. The contract
 * (G6 captain ruling): a grant's tenant is its SOURCE's tenant, and a NULL grant
 * is not a wildcard. This module is where that contract is enforced, not left to
 * each caller.
 */

import { type AgentSourceGrantInput, AgentSourceGrantInputSchema, NotFoundError } from '@omni/core';
import { eq } from 'drizzle-orm';
import type { Database } from './client';
import {
  type AgentGrantSourceKind,
  type AgentSourceGrant,
  agentSourceGrants,
  agents,
  connectorEventSubscriptions,
  connectors,
  webhookSources,
} from './schema';

// Both kind lists must stay identical; a drift fails typecheck in either direction.
type KindsMatch<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const kindsMatch: KindsMatch<AgentGrantSourceKind, AgentSourceGrantInput['sourceKind']> = true;
void kindsMatch;

async function sourceTenant(db: Database, kind: AgentGrantSourceKind, sourceId: string) {
  const read = {
    connector: () =>
      db.select({ tenantId: connectors.tenantId }).from(connectors).where(eq(connectors.id, sourceId)).limit(1),
    connector_subscription: () =>
      db
        .select({ tenantId: connectorEventSubscriptions.tenantId })
        .from(connectorEventSubscriptions)
        .where(eq(connectorEventSubscriptions.id, sourceId))
        .limit(1),
    webhook_source: () =>
      db
        .select({ tenantId: webhookSources.tenantId })
        .from(webhookSources)
        .where(eq(webhookSources.id, sourceId))
        .limit(1),
    agent: () => db.select({ tenantId: agents.tenantId }).from(agents).where(eq(agents.id, sourceId)).limit(1),
  } satisfies Record<AgentGrantSourceKind, unknown>;
  return (await read[kind]())[0];
}

/**
 * Insert an active `agent_source_grants` row, stamping `tenant_id` from the source.
 *
 * **This is the only sanctioned writer of `agent_source_grants`. The slice-6 grant
 * writer MUST call it** and must not insert grants any other way. The guard test
 * `packages/api/src/__tests__/agent-source-grant-writer.test.ts` fails on any other
 * insert, and on any update that sets `tenantId`, `sourceId` or `sourceKind`.
 *
 * - The input has no `tenantId`, and `.strict()` rejects one: the tenant always
 *   comes from the source row (connector, connector subscription, webhook source
 *   or agent).
 * - A source that does not exist, or that the caller's tenant scope cannot see
 *   under FORCE RLS, throws `NotFoundError`. No grant is written with a guessed
 *   or NULL tenant.
 * - An untenanted (NULL) source depends on the mode. With tenant enforcement off
 *   (legacy), it gives a NULL grant, which matches only untenanted rows. Under
 *   enforced RLS the policy is `"tenant_id" = omni_current_tenant_id()`, so a NULL
 *   source is invisible in every tenant scope and this throws `NotFoundError`.
 *
 * Caller contract: pass the caller's tenant-scoped handle (in the API:
 * `scopedHandle(db)`), so the source lookup and the insert run under the same RLS
 * scope. The db-access registry's `tenant-boundary` class for this file holds only
 * when the caller does so: this helper cannot scope its own handle, because
 * `scopedHandle` lives in the api package, and it trusts the handle it is given.
 *
 * Authorization (who may grant what) and the grant's state-change event belong
 * to the slice-6 writer that calls this; this function only persists the row.
 */
export async function insertAgentSourceGrant(db: Database, input: AgentSourceGrantInput): Promise<AgentSourceGrant> {
  const grant = AgentSourceGrantInputSchema.parse(input);
  const source = await sourceTenant(db, grant.sourceKind, grant.sourceId);
  if (!source) throw new NotFoundError(`agent grant source (${grant.sourceKind})`, grant.sourceId);
  const [row] = await db
    .insert(agentSourceGrants)
    .values({ ...grant, tenantId: source.tenantId })
    .returning();
  if (!row) throw new Error('agent_source_grants insert returned no row');
  return row;
}
