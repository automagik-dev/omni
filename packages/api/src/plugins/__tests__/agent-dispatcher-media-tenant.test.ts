/**
 * Tenant-bound presigning at agent dispatch (wish: omni-full-multitenancy, G5
 * leg D; ADR-0008).
 *
 * The dispatcher consumes `message.received` envelopes. When the envelope is
 * TENANT world (versioned + trusted producer-stamped tenant), every presign it
 * mints for the agent must carry that trusted tenant so `MediaStorageService`
 * can bind tenant + object + expiry. When the envelope is LEGACY world, the
 * presign call is byte-identical to pre-G5 (no tenant argument at all).
 *
 * The tenant travels producer → envelope → `DispatchMetadata.trustedTenantId`
 * (stamped by the subscription handler from `classifyEnvelope`, NEVER from the
 * caller-facing payload) → the media-resolution helpers under test here.
 */

import { describe, expect, it } from 'bun:test';
import type { EventMetadata } from '@omni/core';
import type { MediaStorageService } from '../../services/media-storage';
import { __test__ } from '../agent-dispatcher';

const { resolveDispatchMediaPath, extractMediaFiles, trustedDispatchTenant } = __test__;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_KEY = `tenants/${TENANT_A}/instances/inst-1/2026-07/img-1.png`;
const LEGACY_KEY = 'inst-1/2026-07/img-1.png';

/** Remote-mode MediaStorageService stub recording every presign call. */
function stubMediaStorage(opts?: { presignError?: boolean }) {
  const calls: Array<{ ref: string; ttl: number | undefined; tenant: string | undefined }> = [];
  const stub = {
    getStorageMode: () => 'remote' as const,
    presignedUrl: async (ref: string, ttl?: number, tenant?: string) => {
      calls.push({ ref, ttl, tenant });
      if (opts?.presignError) throw new Error('media-storage: refusing to presign');
      return `https://s3.example/${ref}`;
    },
  } as unknown as MediaStorageService;
  return { stub, calls };
}

type BufferedLike = Parameters<typeof extractMediaFiles>[0][number];
function bufferedMessage(opts: { mediaLocalPath?: string; trustedTenantId?: string }): BufferedLike {
  return {
    payload: {
      externalId: 'ext-1',
      chatId: 'chat-1',
      from: 'user-1',
      content: { type: 'image', mimeType: 'image/png', mediaUrl: '/api/v2/media/x.png' },
      rawPayload: opts.mediaLocalPath ? { mediaLocalPath: opts.mediaLocalPath } : undefined,
    },
    metadata: { instanceId: 'inst-1', traceId: 'trace-1', trustedTenantId: opts.trustedTenantId },
    timestamp: Date.now(),
  } as unknown as BufferedLike;
}

describe('trustedDispatchTenant (envelope → dispatch tenant derivation)', () => {
  it('derives the trusted tenant from a versioned tenant envelope', () => {
    const metadata = { envelopeVersion: 1, tenantId: TENANT_A } as unknown as EventMetadata;
    expect(trustedDispatchTenant(metadata)).toBe(TENANT_A);
  });

  it('legacy envelope (no version, no tenant) derives undefined — byte-identical world', () => {
    expect(trustedDispatchTenant({} as EventMetadata)).toBeUndefined();
  });

  it('refuses a quarantined envelope instead of falling back to global processing', () => {
    // Defence in depth: the subscription layer terms quarantined envelopes
    // before handlers run; if one slips through, deriving "no tenant" would
    // process it globally — exactly the fallback ADR-0008 forbids.
    const forged = { tenantId: TENANT_A } as unknown as EventMetadata; // tenant claim, no version
    expect(() => trustedDispatchTenant(forged)).toThrow(/quarantin/i);
    const unknownVersion = { envelopeVersion: 999, tenantId: TENANT_A } as unknown as EventMetadata;
    expect(() => trustedDispatchTenant(unknownVersion)).toThrow(/quarantin/i);
  });
});

describe('resolveDispatchMediaPath tenant binding (remote mode)', () => {
  it('threads the trusted tenant into the presign call', async () => {
    const { stub, calls } = stubMediaStorage();
    const url = await resolveDispatchMediaPath(stub, TENANT_KEY, TENANT_A);
    expect(url).toBe(`https://s3.example/${TENANT_KEY}`);
    expect(calls).toEqual([{ ref: TENANT_KEY, ttl: undefined, tenant: TENANT_A }]);
  });

  it('legacy world presigns with NO tenant argument (byte-identical to pre-G5)', async () => {
    const { stub, calls } = stubMediaStorage();
    await resolveDispatchMediaPath(stub, LEGACY_KEY);
    expect(calls).toEqual([{ ref: LEGACY_KEY, ttl: undefined, tenant: undefined }]);
  });

  it('returns null (no URL) when the tenant-bound presign is refused', async () => {
    // e.g. a legacy-keyed object under a tenant context: fail closed, degrade
    // gracefully — the dispatch continues without a media URL rather than
    // minting an unbound one.
    const { stub } = stubMediaStorage({ presignError: true });
    expect(await resolveDispatchMediaPath(stub, LEGACY_KEY, TENANT_A)).toBeNull();
  });
});

describe('extractMediaFiles tenant binding (remote mode)', () => {
  it('presigns each message with its own envelope-derived trusted tenant', async () => {
    const { stub, calls } = stubMediaStorage();
    const files = await extractMediaFiles(
      [bufferedMessage({ mediaLocalPath: TENANT_KEY, trustedTenantId: TENANT_A })],
      true,
      stub,
      null,
    );
    expect(files).toEqual([{ url: `https://s3.example/${TENANT_KEY}`, mimeType: 'image/png' }]);
    expect(calls).toEqual([{ ref: TENANT_KEY, ttl: undefined, tenant: TENANT_A }]);
  });

  it('legacy message presigns with NO tenant argument (byte-identical)', async () => {
    const { stub, calls } = stubMediaStorage();
    await extractMediaFiles([bufferedMessage({ mediaLocalPath: LEGACY_KEY })], true, stub, null);
    expect(calls).toEqual([{ ref: LEGACY_KEY, ttl: undefined, tenant: undefined }]);
  });

  it('drops the file (no URL) when the tenant-bound presign is refused', async () => {
    const { stub } = stubMediaStorage({ presignError: true });
    const files = await extractMediaFiles(
      [bufferedMessage({ mediaLocalPath: LEGACY_KEY, trustedTenantId: TENANT_A })],
      true,
      stub,
      null,
    );
    expect(files).toEqual([]);
  });
});
