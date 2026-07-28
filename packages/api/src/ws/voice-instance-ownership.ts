/**
 * The voice upgrade's ownership read — G5 deliverable (e)
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0003).
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * The db-access guard keys sites by (file, table), and `packages/api/src/index.ts`
 * is already registered `control-plane` for `instances` — the process-startup
 * read. Putting this query there would have let a TENANT-BOUNDARY read inherit a
 * control-plane exemption it does not deserve, and the guard would never have
 * booked it. Splitting it out gives the read its own honest `tenant-boundary`
 * registration.
 *
 * WHAT IT DOES
 * ------------
 * Resolves an instance's PERSISTED owner — `instances` is THE ownership root
 * (G0/G2 `tenancy-ownership.ts`) — for the voice WebSocket upgrade, which runs
 * in `Bun.serve`'s raw `fetch` before Hono and therefore has no request scope of
 * its own.
 *
 * The read runs inside `runInWorkerTenantScope` for the CREDENTIAL's tenant, so:
 *
 *   * it is detached from any inherited ALS scope (the G4 leg-2 trap) and its
 *     transaction closes before the socket is registered — it never outlives the
 *     work item;
 *   * under enforcement, RLS itself decides visibility. An instance belonging to
 *     another tenant simply does not resolve, so the caller's comparison is
 *     defence in depth rather than the only barrier.
 *
 * Returning `null` means "not owned by this tenant, or not visible" — never
 * "owned"; the caller (`authorizeVoiceUpgrade`) treats it as a refusal.
 */

import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

export async function resolveInstanceTenantId(
  db: Database,
  instanceId: string,
  trustedTenantId: string,
): Promise<string | null> {
  return runInWorkerTenantScope(db, trustedTenantId, async () => {
    const [row] = await scopedHandle(db)
      .select({ tenantId: instances.tenantId })
      .from(instances)
      .where(eq(instances.id, instanceId))
      .limit(1);
    return row?.tenantId ?? null;
  });
}
