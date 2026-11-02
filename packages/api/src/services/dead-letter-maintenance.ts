/** Scoped scheduled cleanup; retry/claim logic remains in DeadLetterService. */
import { type Database, resolveEnforcementMode } from '@omni/db';
import { isMultitenancyEnabled } from '../tenancy/feature-flag';
import { enumerateActiveWorkTenants } from '../tenancy/periodic-tenant-work';
import { currentTenantScope } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';
import type { DeadLetterService } from './dead-letters';

export async function cleanupDeadLettersForTenants(
  pool: Database,
  authPlaneDb: Database | null,
  service: Pick<DeadLetterService, 'cleanupExpired'>,
): Promise<number> {
  if (!isMultitenancyEnabled() || resolveEnforcementMode() !== 'enforced' || currentTenantScope())
    return service.cleanupExpired();
  if (!authPlaneDb) throw new Error('Dead-letter cleanup requires tenant discovery');
  let deleted = 0;
  const errors: unknown[] = [];
  for (const tenantId of await enumerateActiveWorkTenants(authPlaneDb)) {
    try {
      deleted += await runInWorkerTenantScope(pool, tenantId, () => service.cleanupExpired());
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Dead-letter tenant cleanup failed');
  return deleted;
}
