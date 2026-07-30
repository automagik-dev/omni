/**
 * `services/media-storage.ts::messages` worker-context boundary (G5; ADR-0008).
 *
 * That registry site is ONE query — `updateMessageLocalPath`'s
 * `update(messages)`. Three callers reach it:
 *
 *   * `routes/v2/messages.ts` (request path — inside the edge tenant transaction);
 *   * `services/batch-jobs.ts` `resolveFilePath` (already `runTenantWorkDb`);
 *   * `plugins/media-processor.ts` `downloadMediaFromUrl` — the CONSUMER path,
 *     which threaded its envelope tenant into `storeFromUrl` (for the egress
 *     broker and the tenant-prefixed object key) but left the message write on
 *     whatever handle `scopedHandle` happened to return. Inside a converted
 *     consumer that is the ambient pool, so the write escaped the tenant
 *     transaction the rest of the item ran in.
 *
 * This file is the enforcement the static guard cannot provide (run12's
 * FIX-FIRST lesson: the guard sees the SERVICE file, never the CALL SITE).
 * It probes the real caller shape — `downloadMediaFromUrl` is invoked by
 * `resolveMediaPath` with the envelope-derived `trustedTenantId` and nothing
 * else — never a hand-built input production cannot produce.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { __test__ } from '../media-processor';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';

/** Worker-scope fake: `transaction` runs the callback, counting openings. */
function fakeScopeDb(counter: { transactions: number }): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      counter.transactions += 1;
      return cb({ execute: async () => [] as unknown });
    },
  } as unknown as Database;
}

type Observed = Array<{ step: string; scope: string | null }>;

function makeCtx(observed: Observed, counter: { transactions: number }) {
  return {
    db: fakeScopeDb(counter),
    mediaStorage: {
      storeFromUrl: async (
        _instanceId: string,
        _messageId: string,
        _url: string,
        _mime: string,
        _ts: Date | undefined,
        _fetchOptions: RequestInit | undefined,
        tenantId: string | undefined,
      ) => {
        observed.push({ step: `storeFromUrl:${tenantId ?? 'none'}`, scope: currentScope() });
        return { localPath: 'tenants/x/obj.ogg', size: 1 };
      },
      updateMessageLocalPath: async () => {
        observed.push({ step: 'updateMessageLocalPath', scope: currentScope() });
      },
    },
    // Slack is the only channel that triggers the instance lookup; keep it out
    // of the probe so the only DB block observed is the one under test.
    services: { instances: { getById: async () => ({}) } },
  } as unknown as Parameters<typeof __test__.downloadMediaFromUrl>[0];
}

function currentScope(): string | null {
  return currentTenantScope()?.tenantId ?? null;
}

describe('media-storage::messages — consumer caller (media-processor)', () => {
  test('the message write runs INSIDE the envelope tenant scope', async () => {
    const observed: Observed = [];
    const counter = { transactions: 0 };
    const ctx = makeCtx(observed, counter);

    const path = await __test__.downloadMediaFromUrl(
      ctx,
      'instance-1',
      'message-1',
      'https://example.invalid/a.ogg',
      'audio/ogg',
      undefined,
      'whatsapp-baileys',
      TENANT_A,
    );

    expect(path).toBe('tenants/x/obj.ogg');
    const write = observed.find((o) => o.step === 'updateMessageLocalPath');
    expect(write).toBeDefined();
    expect(write?.scope).toBe(TENANT_A);
  });

  test('the DOWNLOAD stays outside the scope — a worker transaction never spans network work', async () => {
    const observed: Observed = [];
    const counter = { transactions: 0 };
    const ctx = makeCtx(observed, counter);

    await __test__.downloadMediaFromUrl(
      ctx,
      'instance-1',
      'message-1',
      'https://example.invalid/a.ogg',
      'audio/ogg',
      undefined,
      'whatsapp-baileys',
      TENANT_A,
    );

    const download = observed.find((o) => o.step.startsWith('storeFromUrl:'));
    expect(download?.scope).toBeNull();
    // …and the tenant still reached the storage layer as a threaded VALUE, which
    // is what binds the object key and the egress policy.
    expect(download?.step).toBe(`storeFromUrl:${TENANT_A}`);
    // Exactly one worker transaction: the message write, nothing else.
    expect(counter.transactions).toBe(1);
  });

  test('legacy envelope: no scope, no transaction, byte-identical to pre-G5', async () => {
    const observed: Observed = [];
    const counter = { transactions: 0 };
    const ctx = makeCtx(observed, counter);

    await __test__.downloadMediaFromUrl(
      ctx,
      'instance-1',
      'message-1',
      'https://example.invalid/a.ogg',
      'audio/ogg',
      undefined,
      'whatsapp-baileys',
      undefined,
    );

    expect(counter.transactions).toBe(0);
    expect(observed.every((o) => o.scope === null)).toBe(true);
    expect(observed.map((o) => o.step)).toEqual(['storeFromUrl:none', 'updateMessageLocalPath']);
  });
});
