/**
 * Pre-context tenant resolution for the public connector ingress
 * (connectors-first-slice-clickup, finding F3).
 *
 * `POST /api/v2/connectors/events/:subscriptionId` carries no Omni credential,
 * so it has no tenant context. The subscription row IS the persisted owner of
 * the delivery: its `tenant_id` is the tenant every subsequent read/write must
 * run under. Reading that one row before a context exists is the same shape as
 * `auth-bootstrap.ts` reading the credential index, and it uses the same
 * mechanism — a NOLOGIN marker role admitted by a narrow SELECT policy, with
 * one SECURITY DEFINER function whose SQL is fixed to the requested id.
 *
 * WHAT THE LOOKUP MAY RETURN
 * --------------------------
 * Exactly one value: the tenant id, or NULL. It does not return the secret,
 * the connector, filters or counters; those are read a second time inside the
 * tenant-stamped transaction the caller opens. A wrong/unknown/paused-out
 * subscription returns NULL, which the caller collapses into the same 401 as a
 * bad signature.
 *
 * WHY THE DATABASE, NOT A CACHE
 * -----------------------------
 * The channel plugins can resolve an instance from an in-memory map because
 * the map is populated by instance reads the API already performs. A
 * subscription may be created and receive a delivery before any operator read,
 * and a restart empties any cache — so a delivery must be resolvable from
 * persisted state alone. The lookup is indexed by primary key.
 *
 * DUAL WORLD
 * ----------
 * Legacy deployments have no enforcement, no marker role and no lookup
 * function. `connectorIngressLookupActive` reports that from the catalog (not
 * an environment flag, so it cannot disagree with the applied schema) and the
 * caller keeps its pre-F3 unscoped read byte-for-byte. The probe is cached per
 * pool: enforcement is applied by an explicit operator act, not mid-run.
 */

import type { Database } from '@omni/db';
import { sql } from 'drizzle-orm';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Path-segment shape only: a valid-shaped id that does not exist resolves null. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const activeCache = new WeakMap<Database, Promise<boolean>>();

/** Is the enforcement-time connector-ingress lookup installed on this database? */
export async function connectorIngressLookupActive(db: Database): Promise<boolean> {
  const cached = activeCache.get(db);
  if (cached) return cached;

  // A few service unit tests inject a narrow fake handle with only the query
  // builder methods. Those tests describe the legacy world by construction, so
  // "no raw execute" means "no enforcement lookup installed" rather than an
  // error. A real pool always exposes execute.
  if (typeof (db as { execute?: unknown }).execute !== 'function') return false;

  const probe = (async () => {
    const rows = (await db.execute(sql`
      SELECT to_regprocedure('public.omni_connector_ingress_tenant(uuid)') IS NOT NULL AS present
    `)) as unknown as { present: boolean }[];
    return Boolean(rows[0]?.present);
  })();
  activeCache.set(db, probe);
  try {
    return await probe;
  } catch (error) {
    // A failed probe must not be remembered as a permanent "legacy" answer.
    activeCache.delete(db);
    throw error;
  }
}

/**
 * Resolve the tenant of one subscription through the enforcement-time lookup.
 *
 * The caller must have checked {@link connectorIngressLookupActive}; this is
 * intentionally not a fallback path, so an enforcement outage can never
 * silently degrade into an unscoped read.
 */
export async function resolveConnectorIngressTenant(db: Database, subscriptionId: string): Promise<string | null> {
  // The function's parameter is uuid; a malformed path segment must be the
  // uniform 401, not a database cast error (500).
  if (typeof subscriptionId !== 'string' || !UUID_SHAPE.test(subscriptionId)) return null;

  const rows = (await db.execute(sql`
    SELECT public.omni_connector_ingress_tenant(${subscriptionId}::uuid) AS tenant_id
  `)) as unknown as { tenant_id: string | null }[];
  const tenantId = rows[0]?.tenant_id ?? null;
  return typeof tenantId === 'string' && UUID.test(tenantId) ? tenantId : null;
}
