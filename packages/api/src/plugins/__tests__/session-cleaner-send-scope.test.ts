/**
 * Session-cleaner confirmation-send instance read scope (wish:
 * omni-full-multitenancy, Group G5; ADR-0008).
 *
 * `runTrashEmojiCleanup` scopes every cleanup DB block with the envelope
 * tenant — but the confirmation/error `sendMessage` helper it calls at the end
 * read `instances` BARE, so a tenant-world cleanup still hit the ambient pool
 * for that one lookup. That kept `services/instances.ts::instances` held by
 * this caller (a site is only as scoped as its least-scoped caller — the
 * run12 lesson).
 *
 * Probes drive the REAL `runTrashEmojiCleanup` consumer path into its error
 * send (the first cleanup read throws a non-skippable error), asserting the
 * helper's instance read observes the envelope tenant's worker scope in the
 * tenant world and no scope in the legacy world.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { runTrashEmojiCleanup } from '../session-cleaner';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

function fakeDb(): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({
        execute: async () => [] as unknown,
      }),
  } as unknown as Database;
}

function harness() {
  const instanceScopes: (string | null)[] = [];
  const services = {
    agentRunner: {
      // The FIRST cleanup read: throw a non-skippable error so the handler
      // falls through to the error-message send — the path under test.
      getInstanceWithProvider: mock(async () => {
        throw new Error('probe: cleanup failed before any session work');
      }),
    },
    instances: {
      getById: mock(async () => {
        instanceScopes.push(currentTenantScope()?.tenantId ?? null);
        // No plugin is registered for this channel in the test process, so the
        // send helper stops after this read — exactly the read under probe.
        return { id: 'inst-1', channel: 'probe-channel' };
      }),
    },
  } as never;
  return { services, instanceScopes };
}

function trashEvent(metadata: Record<string, unknown>) {
  return {
    id: `evt-${crypto.randomUUID()}`,
    type: 'message.received',
    payload: { chatId: 'chat-ext-1', from: 'user-1', content: { type: 'text', text: '🗑️' } },
    metadata: { correlationId: 'corr-1', instanceId: 'inst-1', ...metadata },
    timestamp: Date.now(),
  } as never;
}

describe('session-cleaner send helper scopes its instance read (G5, ADR-0008)', () => {
  test('tenant envelope: the send-side instance read runs inside the worker tenant scope', async () => {
    const h = harness();
    await runTrashEmojiCleanup(h.services, fakeDb(), trashEvent({ envelopeVersion: 1, tenantId: TENANT_A }));
    expect(h.instanceScopes).toEqual([TENANT_A]);
  });

  test('legacy envelope: the send-side instance read stays unscoped — byte-identical', async () => {
    const h = harness();
    await runTrashEmojiCleanup(h.services, fakeDb(), trashEvent({}));
    expect(h.instanceScopes).toEqual([null]);
  });
});
