/**
 * Representative tenant-scoped repository
 * (wish: omni-full-multitenancy, Group G3).
 *
 * SCOPE — read this before adding a method
 * ----------------------------------------
 * G3 owns the BOUNDARY, not the conversion. G4 owns converting the synchronous
 * route surface. This module exists to prove the boundary works end-to-end
 * against real PostgreSQL with RLS forced: `instances` (the ownership root) and
 * `chats` (a derived child) are enough to exercise SELECT, INSERT, UPDATE, and
 * DELETE under policy, cross-tenant denial, and `WITH CHECK` rejection.
 *
 * The remaining ~60 tenant-scoped call sites are NOT converted here. They are
 * inventoried in `tenancy-db-access-guard.ts` under the `pending-G4-conversion`
 * class, where the static guard counts them and refuses to let the number grow.
 *
 * THE SHAPE THAT MATTERS
 * ----------------------
 * Every method takes a `TenantTx` as its first parameter and holds no reference
 * to a `Database`. There is no constructor that captures a pool, no module-level
 * singleton, and no default. A caller cannot invoke any of this without having
 * already been handed a transaction by `withTenantTransaction`, which means it
 * cannot invoke any of it without an authenticated tenant context.
 *
 * Note what the methods do NOT do: none of them filters by `tenant_id`. Under
 * enforcement that filter is the policy's job, and duplicating it in the
 * application would hide a policy regression behind an application predicate.
 * In legacy mode the queries behave exactly as an unscoped query does today —
 * which is what keeps this module inert for a flag-off deployment.
 */

import { type Chat, type Instance, chats, instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import type { TenantTx } from './tenant-transaction';

export interface NewTenantInstance {
  readonly name: string;
  readonly channel: Instance['channel'];
  /**
   * `instances` is the single ownership ROOT (G2): it has no FK-covered tenant
   * parent, so its `tenant_id` is the one tenant id that comes from the
   * authenticated context rather than from a parent row. The boundary passes it
   * explicitly rather than letting a caller supply it.
   */
  readonly tenantId: string;
}

export const TenantInstanceRepository = {
  async list(tx: TenantTx): Promise<Instance[]> {
    return tx.select().from(instances);
  },

  async findById(tx: TenantTx, id: string): Promise<Instance | undefined> {
    const [row] = await tx.select().from(instances).where(eq(instances.id, id)).limit(1);
    return row;
  },

  async create(tx: TenantTx, values: NewTenantInstance): Promise<Instance> {
    const [row] = await tx
      .insert(instances)
      .values({ name: values.name, channel: values.channel, tenantId: values.tenantId })
      .returning();
    if (!row) throw new Error('tenant-repository: instance insert returned no row');
    return row;
  },

  async rename(tx: TenantTx, id: string, name: string): Promise<Instance | undefined> {
    const [row] = await tx.update(instances).set({ name }).where(eq(instances.id, id)).returning();
    return row;
  },

  /**
   * Re-tenanting probe surface. Under enforcement the UPDATE policy's
   * `WITH CHECK` rejects this whenever `tenantId` is not the transaction's
   * tenant — which is every interesting case. It exists as a method so the test
   * can attempt the attack through the boundary rather than around it.
   */
  async setTenant(tx: TenantTx, id: string, tenantId: string): Promise<Instance | undefined> {
    const [row] = await tx.update(instances).set({ tenantId }).where(eq(instances.id, id)).returning();
    return row;
  },

  async remove(tx: TenantTx, id: string): Promise<number> {
    const rows = await tx.delete(instances).where(eq(instances.id, id)).returning({ id: instances.id });
    return rows.length;
  },
};

export const TenantChatRepository = {
  async list(tx: TenantTx): Promise<Chat[]> {
    return tx.select().from(chats);
  },

  async findById(tx: TenantTx, id: string): Promise<Chat | undefined> {
    const [row] = await tx.select().from(chats).where(eq(chats.id, id)).limit(1);
    return row;
  },
};
