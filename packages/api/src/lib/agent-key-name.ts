/**
 * Naming for auto-provisioned agent API keys
 * (wish: omni-full-multitenancy, Group G4).
 *
 * THE PROBLEM
 * -----------
 * When an agent is assigned to an instance the API auto-provisions a scoped key
 * addressed by NAME — historically `agent:<agentName>` — and finds it again with
 * `ApiKeyService.findByName`, a name-only predicate over `api_keys`.
 *
 * `api_keys` is a legacy deployment-wide table: no `tenant_id` column and no
 * RLS. So that name is a single global namespace, and under multitenancy it is
 * a cross-tenant write. Tenant B assigning an agent it happens to have named
 * `support` finds tenant A's `agent:support` row and appends B's instanceId to
 * it — grafting reach into B's instance onto a credential A holds and rotates.
 * Nothing below this layer catches it, because there is no tenant boundary on
 * the table to catch it with.
 *
 * THE NAMING RULE
 * ---------------
 * A tenant's keys are qualified with the tenant id, so two tenants' agents of
 * the same name resolve to different rows. A legacy request — no tenant context
 * — keeps the bare `agent:<name>` byte-for-byte, which is required rather than
 * merely tidy: that name is the lookup key for every key already provisioned on
 * every existing deployment, and changing it would orphan them all.
 */

/** The name a key provisioned under this tenant (or none) is stored as. */
export function agentKeyName(agentName: string, tenantId: string | null | undefined): string {
  return tenantId ? `agent:${tenantId}:${agentName}` : `agent:${agentName}`;
}

/**
 * Names to try, in order, when RESOLVING an agent's key.
 *
 * Provisioning writes exactly one name; resolution has to tolerate two, because
 * a tenant-owned instance may still be served by a key provisioned before this
 * qualification existed. The qualified name is tried first so that once the
 * tenant-owned key exists it always wins, and the bare name is a fallback that
 * quietly retires as keys are re-provisioned.
 *
 * For an untenanted instance the list is the single legacy name, so a
 * flag-off deployment performs the same single lookup it always has.
 */
export function agentKeyNameCandidates(agentName: string, tenantId: string | null | undefined): string[] {
  return tenantId
    ? [agentKeyName(agentName, tenantId), agentKeyName(agentName, null)]
    : [agentKeyName(agentName, null)];
}
