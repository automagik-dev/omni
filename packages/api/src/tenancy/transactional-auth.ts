/**
 * Transactional actor freshness checks for security-sensitive control-plane
 * writes (wish: omni-full-multitenancy, Group G1; ADR-0003/0005).
 *
 * Request bootstrap establishes an immutable context, but that context is only
 * a snapshot. Every later mutation transaction must lock and revalidate the
 * canonical auth-index row, source platform key, and principal so revocation,
 * scope narrowing, or principal disablement cannot race across the write
 * boundary.
 */

import type { Database } from '@omni/db';
import { authCredentials, platformApiKeys, principals } from '@omni/db';
import { eq } from 'drizzle-orm';
import type { PlatformAuthContext } from './auth-context';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type PlatformMutationActor = Omit<PlatformAuthContext, 'principalId' | 'platformAction'> & {
  readonly principalId: string;
  readonly platformAction: string;
};

export async function platformActorFreshnessFailure(tx: Tx, actor: PlatformMutationActor): Promise<string | null> {
  const [credential] = await tx
    .select()
    .from(authCredentials)
    .where(eq(authCredentials.id, actor.credentialId))
    .limit(1)
    .for('update');
  if (!credential) return 'platform actor credential is missing';
  if (credential.status !== 'active' || credential.revokedAt) return 'platform actor credential is revoked';
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
    return 'platform actor credential is expired';
  }
  if (
    credential.id !== actor.credentialId ||
    credential.credentialClass !== 'platform' ||
    credential.principalId !== actor.principalId ||
    credential.platformApiKeyId !== actor.platformApiKeyId ||
    credential.tenantId !== null ||
    credential.membershipId !== null ||
    credential.tenantKeyLineageId !== null ||
    credential.actorRole !== null ||
    !sameStringArray(credential.scopes, actor.scopes)
  ) {
    return 'platform actor credential binding is invalid';
  }

  const [sourceKey] = await tx
    .select()
    .from(platformApiKeys)
    .where(eq(platformApiKeys.id, actor.platformApiKeyId))
    .limit(1)
    .for('update');
  if (!sourceKey) return 'platform actor source key is missing';
  if (sourceKey.status !== 'active' || sourceKey.revokedAt) return 'platform actor source key is revoked';
  if (sourceKey.expiresAt && sourceKey.expiresAt.getTime() <= Date.now()) {
    return 'platform actor source key is expired';
  }
  if (
    sourceKey.id !== actor.platformApiKeyId ||
    sourceKey.principalId !== actor.principalId ||
    sourceKey.keyHash !== credential.keyHash ||
    sourceKey.keyPrefix !== credential.keyPrefix ||
    !sameStringArray(sourceKey.scopes, credential.scopes) ||
    !sameStringArray(sourceKey.scopes, actor.scopes)
  ) {
    return 'platform actor source key binding is invalid';
  }

  const [principal] = await tx
    .select()
    .from(principals)
    .where(eq(principals.id, actor.principalId))
    .limit(1)
    .for('update');
  if (!principal || principal.id !== actor.principalId) return 'platform actor principal is missing';
  if (principal.status !== 'active') return 'platform actor principal is not active';

  return null;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
