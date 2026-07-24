/**
 * Presigned-URL revocation ceilings, proven with a SYNTHETIC epoch/clock
 * (wish: omni-full-multitenancy, Group G5, deliverable (c); ADR-0008, ADR-0006;
 * RELEASE_SLOS `revocation`).
 *
 * Two normative numbers from `RELEASE_SLOS.yaml`, and nothing about production
 * timing is claimed — both are driven from injected state:
 *
 *   * `presigned_url_ttl_seconds_max: 60` — a tenant-bound URL's lifetime is
 *     clamped, so it self-expires inside the revocation-propagation window even
 *     if nothing revokes it explicitly. Already enforced when the tenant prefix
 *     binding landed; pinned here as the other half of the pair.
 *   * `presigned_url_issue_or_refresh_after_revocation_max: 0` — once the tenant
 *     is revoked, a presign must be REFUSED. A clamped TTL alone does not
 *     satisfy this: without a gate, a revoked tenant could keep minting fresh
 *     60-second URLs indefinitely, and every one of them would be "within the
 *     ceiling" while the ceiling as written is ZERO issuances.
 *
 * The gate is the same trusted, non-caller-controlled read the other
 * revocation-sensitive executors use (`periodic-tenant-work.ts`
 * `isTenantWorkAdmissible` — the tenant's own `status` on the auth plane). It is
 * injected here as a synthetic admissibility function so the epoch transition is
 * a step in the test, not a wall-clock wait.
 */

import { describe, expect, test } from 'bun:test';
import type { MediaStorageBackend } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { MediaStorageService, PRESIGNED_URL_TTL_CEILING_SECONDS } from '../media-storage';

const TENANT_A = '11111111-1111-4111-8111-11111111ce1a';
const TENANT_B = '22222222-2222-4222-8222-22222222ce2b';

/** Records the TTL each presign was actually issued with. */
function makeBackend(): { backend: MediaStorageBackend; ttls: (number | undefined)[] } {
  const ttls: (number | undefined)[] = [];
  const backend = {
    mode: 'remote',
    write: async () => '',
    read: async () => Buffer.alloc(0),
    delete: async () => {},
    exists: async () => true,
    presignedUrl: async (reference: string, ttlSeconds?: number) => {
      ttls.push(ttlSeconds);
      return `https://example.invalid/${reference}?ttl=${ttlSeconds ?? 'default'}`;
    },
  } as unknown as MediaStorageBackend;
  return { backend, ttls };
}

function makeService(backend: MediaStorageBackend): MediaStorageService {
  return new MediaStorageService({} as unknown as Database, '/tmp/omni-presign-probe', backend);
}

const keyFor = (tenantId: string) => `tenants/${tenantId}/instances/inst-1/2026-07/msg-1.jpg`;

describe('presigned URL TTL ceiling (RELEASE_SLOS presigned_url_ttl_seconds_max)', () => {
  test('a tenant-bound presign is clamped to the ceiling even when asked for longer', async () => {
    const { backend, ttls } = makeBackend();
    const service = makeService(backend);
    // An admissible tenant — this block is about the TTL, not the gate.
    service.setTenantAdmissibilityCheck(async () => true);

    await service.presignedUrl(keyFor(TENANT_A), 3600, TENANT_A);
    expect(ttls.at(-1)).toBe(PRESIGNED_URL_TTL_CEILING_SECONDS);
    expect(PRESIGNED_URL_TTL_CEILING_SECONDS).toBeLessThanOrEqual(60);

    // A shorter request is honoured — the ceiling is a maximum, not a default
    // that overrides a caller asking for less exposure.
    await service.presignedUrl(keyFor(TENANT_A), 5, TENANT_A);
    expect(ttls.at(-1)).toBe(5);
  });

  test('a legacy (no-tenant) presign is byte-identical: no clamp, no gate', async () => {
    const { backend, ttls } = makeBackend();
    const service = makeService(backend);

    await service.presignedUrl('inst-1/2026-07/msg-1.jpg', 3600);
    expect(ttls.at(-1)).toBe(3600);
  });
});

describe('presign after revocation (RELEASE_SLOS presigned_url_issue_or_refresh_after_revocation_max: 0)', () => {
  test('a revoked tenant cannot issue a NEW presign, and cannot refresh an old one', async () => {
    const { backend, ttls } = makeBackend();
    const service = makeService(backend);

    // Synthetic epoch: the tenant is admissible until the test revokes it. No
    // wall clock, no production timing claim.
    let revoked = false;
    service.setTenantAdmissibilityCheck(async (tenantId) => tenantId === TENANT_A && !revoked);

    // Before revocation: issuance works.
    await service.presignedUrl(keyFor(TENANT_A), 30, TENANT_A);
    expect(ttls.length).toBe(1);

    // The epoch advances — the tenant is suspended/archived.
    revoked = true;

    // Issue AND refresh are both refused, and neither reaches the backend, so
    // the count of post-revocation issuances is exactly zero.
    await expect(service.presignedUrl(keyFor(TENANT_A), 30, TENANT_A)).rejects.toThrow(/revoked|not admissible/i);
    await expect(service.presignedUrl(keyFor(TENANT_A), 5, TENANT_A)).rejects.toThrow(/revoked|not admissible/i);
    expect(ttls.length).toBe(1);
  });

  test('a tenant that was never admissible is refused from the first call', async () => {
    const { backend, ttls } = makeBackend();
    const service = makeService(backend);
    service.setTenantAdmissibilityCheck(async () => false);

    await expect(service.presignedUrl(keyFor(TENANT_B), 30, TENANT_B)).rejects.toThrow(/revoked|not admissible/i);
    expect(ttls.length).toBe(0);
  });

  test('the prefix binding is checked too — a revoked tenant cannot reach another tenant’s object', async () => {
    const { backend, ttls } = makeBackend();
    const service = makeService(backend);
    service.setTenantAdmissibilityCheck(async () => true);

    await expect(service.presignedUrl(keyFor(TENANT_B), 30, TENANT_A)).rejects.toThrow(
      /outside the requesting tenant/i,
    );
    expect(ttls.length).toBe(0);
  });

  test('with NO check wired, a tenant presign FAILS CLOSED rather than minting unguarded URLs', async () => {
    // The multitenancy world always wires the check (services/index.ts). Its
    // absence under a tenant-context presign is a misconfiguration, and the same
    // fail-closed stance `batch-jobs.ts` takes for a tenant job with no auth
    // plane applies here: refuse, do not mint.
    const { backend, ttls } = makeBackend();
    const service = makeService(backend);

    await expect(service.presignedUrl(keyFor(TENANT_A), 30, TENANT_A)).rejects.toThrow(/revocation check/i);
    expect(ttls.length).toBe(0);
  });

  test('the legacy path never consults the check and never fails closed', async () => {
    // Flag-off has no tenants to revoke, so the pre-G5 presign must keep working
    // with no admissibility wiring at all.
    const { backend, ttls } = makeBackend();
    const service = makeService(backend);

    await service.presignedUrl('inst-1/2026-07/msg-1.jpg');
    expect(ttls.length).toBe(1);
  });
});
