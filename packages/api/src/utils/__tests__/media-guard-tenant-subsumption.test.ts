/**
 * The `OMNI_MEDIA_URL_GUARD=off` escape hatch is subsumed for TENANT contexts
 * (wish: omni-full-multitenancy, Group G5, deliverable (b); ADR-0009).
 *
 * WHY THIS EXISTS
 * ---------------
 * `safe-media-fetch.ts` predates multitenancy. It ships a documented escape
 * hatch — `OMNI_MEDIA_URL_GUARD=off` disables the private-range checks — for
 * single-tenant deployments that intentionally fetch media from an RFC1918 host
 * (a lab MinIO, say). In a single-tenant world that is an operator's own
 * decision about their own network, and G5 must not change it.
 *
 * In a MULTI-tenant world the same switch is a cross-tenant SSRF hole: the URL
 * being fetched came from a tenant-controlled message payload, and one operator
 * flag would let any tenant's payload reach loopback, RFC1918, and the cloud
 * metadata endpoint on the shared host. ADR-0009 is default-deny for
 * tenant-controlled egress, and the G5 brief is explicit — "The
 * `OMNI_MEDIA_URL_GUARD=off` escape hatch is removed/subsumed for tenant
 * contexts".
 *
 * SUBSUMED, NOT REMOVED, and the distinction is the dual-world contract:
 *   * no tenant context (flag-off, legacy) → the hatch works exactly as before,
 *     byte-identical;
 *   * a tenant context → the hatch is IGNORED. Private ranges are denied no
 *     matter what the environment says, because no per-deployment flag may
 *     lower one tenant's isolation from another.
 */

import { describe, expect, test } from 'bun:test';
import { type AddressLookup, UnsafeMediaUrlError, assertSafeMediaUrl } from '../safe-media-fetch';

const TENANT = '11111111-1111-4111-8111-1111111111ed';

const GUARD_OFF = { OMNI_MEDIA_URL_GUARD: 'off' } as NodeJS.ProcessEnv;
const GUARD_DEFAULT = {} as NodeJS.ProcessEnv;

const publicLookup: AddressLookup = async () => [{ address: '93.184.216.34' }];
const privateLookup: AddressLookup = async () => [{ address: '10.1.2.3' }];
const metadataLookup: AddressLookup = async () => [{ address: '169.254.169.254' }];

describe('no tenant context — the escape hatch is untouched (dual world)', () => {
  test('guard off allows a literal private address, exactly as before G5', async () => {
    await expect(
      assertSafeMediaUrl(new URL('http://10.0.0.5/media.jpg'), publicLookup, GUARD_OFF),
    ).resolves.toBeUndefined();
  });

  test('guard off allows a host that RESOLVES private, exactly as before G5', async () => {
    await expect(
      assertSafeMediaUrl(new URL('http://lab.internal/media.jpg'), privateLookup, GUARD_OFF),
    ).resolves.toBeUndefined();
  });

  test('guard off still refuses a non-http scheme — the hatch never covered that', async () => {
    await expect(assertSafeMediaUrl(new URL('file:///etc/passwd'), publicLookup, GUARD_OFF)).rejects.toThrow(
      UnsafeMediaUrlError,
    );
  });
});

describe('tenant context — the escape hatch is subsumed', () => {
  test('a literal private address is refused even with the guard switched off', async () => {
    await expect(
      assertSafeMediaUrl(new URL('http://10.0.0.5/media.jpg'), publicLookup, GUARD_OFF, TENANT),
    ).rejects.toThrow(UnsafeMediaUrlError);
  });

  test('loopback is refused even with the guard switched off', async () => {
    await expect(
      assertSafeMediaUrl(new URL('http://127.0.0.1:9000/media.jpg'), publicLookup, GUARD_OFF, TENANT),
    ).rejects.toThrow(UnsafeMediaUrlError);
  });

  test('cloud metadata is refused even with the guard switched off', async () => {
    await expect(
      assertSafeMediaUrl(new URL('http://metadata.example/x'), metadataLookup, GUARD_OFF, TENANT),
    ).rejects.toThrow(UnsafeMediaUrlError);
  });

  test('a host that RESOLVES private is refused even with the guard switched off (DNS rebinding)', async () => {
    await expect(
      assertSafeMediaUrl(new URL('http://looks-public.example/media.jpg'), privateLookup, GUARD_OFF, TENANT),
    ).rejects.toThrow(UnsafeMediaUrlError);
  });

  test('a genuinely public target still passes — subsumption denies private, not everything', async () => {
    await expect(
      assertSafeMediaUrl(new URL('https://cdn.example/media.jpg'), publicLookup, GUARD_OFF, TENANT),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeMediaUrl(new URL('https://cdn.example/media.jpg'), publicLookup, GUARD_DEFAULT, TENANT),
    ).resolves.toBeUndefined();
  });

  test('with the guard at its DEFAULT, tenant and non-tenant behave identically', async () => {
    // The subsumption only ever removes the hatch; it never adds a rule the
    // enforced default did not already have.
    await expect(assertSafeMediaUrl(new URL('http://10.0.0.5/m.jpg'), publicLookup, GUARD_DEFAULT)).rejects.toThrow(
      UnsafeMediaUrlError,
    );
    await expect(
      assertSafeMediaUrl(new URL('http://10.0.0.5/m.jpg'), publicLookup, GUARD_DEFAULT, TENANT),
    ).rejects.toThrow(UnsafeMediaUrlError);
  });
});
