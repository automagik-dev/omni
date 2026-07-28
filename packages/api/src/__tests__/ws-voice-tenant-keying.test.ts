/**
 * Voice WebSocket tenant keying — G5 deliverable (e)
 * (wish: omni-full-multitenancy; ADR-0008, ADR-0006).
 *
 * `VoiceStreamRegistry` fans audio out to every client whose `params.sessionId`
 * matches. Pre-G5 that is the whole authorization: a client that can NAME a
 * session receives its audio. These probes pin the tenant-keyed behaviour on top
 * of it:
 *
 *   * a session bound to tenant A never delivers a frame to a tenant-B client,
 *     even when both clients named the SAME session id;
 *   * the tenant is never taken from the URL — `parseVoiceStreamParams` has no
 *     path to a tenant, so a caller cannot assert one;
 *   * revocation closes a tenant's live voice sockets;
 *   * DUAL WORLD: an UNBOUND session (flag-off / legacy) fans out by session id
 *     exactly as pre-G5.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { sweepRevokedStreamSubscriptions } from '../tenancy/tenant-stream-subscriptions';
import { VoiceStreamRegistry, parseVoiceStreamParams } from '../ws/voice';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

function client() {
  const frames: (string | ArrayBuffer | Uint8Array)[] = [];
  const closed: string[] = [];
  return {
    frames,
    closed,
    send: (d: string | ArrayBuffer | Uint8Array) => frames.push(d),
    close: (reason: string) => closed.push(reason),
  };
}

describe('session→tenant binding narrows the fan-out', () => {
  test('the SAME session id under two tenants does not cross', () => {
    const reg = new VoiceStreamRegistry();
    const a = client();
    const b = client();
    const wsA = {};
    const wsB = {};

    reg.bindSession('shared-session', TENANT_A);
    reg.add(wsA, {
      params: { sessionId: 'shared-session', apiKey: 'k', format: 'opus' },
      tenantId: TENANT_A,
      revocationEpoch: 1,
      send: a.send,
      close: a.close,
    });
    reg.add(wsB, {
      params: { sessionId: 'shared-session', apiKey: 'k', format: 'opus' },
      tenantId: TENANT_B,
      revocationEpoch: 1,
      send: b.send,
      close: b.close,
    });

    reg.pushAudio('shared-session', 'user-1', new Uint8Array([1, 2, 3]), 'opus');

    expect(a.frames).toHaveLength(1);
    expect(b.frames).toHaveLength(0);
  });

  test('control broadcasts are narrowed by the same binding', () => {
    const reg = new VoiceStreamRegistry();
    const a = client();
    const b = client();

    reg.bindSession('shared-session', TENANT_A);
    reg.add(
      {},
      {
        params: { sessionId: 'shared-session', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_A,
        revocationEpoch: 1,
        send: a.send,
        close: a.close,
      },
    );
    reg.add(
      {},
      {
        params: { sessionId: 'shared-session', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_B,
        revocationEpoch: 1,
        send: b.send,
        close: b.close,
      },
    );

    reg.broadcast('shared-session', { type: 'participant_joined', userId: 'u1' });

    expect(a.frames).toHaveLength(1);
    expect(b.frames).toHaveLength(0);
  });

  test('getClientsForSession is narrowed by the binding too', () => {
    const reg = new VoiceStreamRegistry();
    reg.bindSession('shared-session', TENANT_A);
    reg.add(
      {},
      {
        params: { sessionId: 'shared-session', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_A,
        revocationEpoch: 1,
        send: () => {},
      },
    );
    reg.add(
      {},
      {
        params: { sessionId: 'shared-session', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_B,
        revocationEpoch: 1,
        send: () => {},
      },
    );

    expect(reg.getClientsForSession('shared-session')).toHaveLength(1);
  });

  test('DUAL WORLD: an unbound session fans out by session id, as pre-G5', () => {
    const reg = new VoiceStreamRegistry();
    const one = client();
    const two = client();

    reg.add({}, { params: { sessionId: 'legacy-session', apiKey: 'k', format: 'opus' }, send: one.send });
    reg.add({}, { params: { sessionId: 'legacy-session', apiKey: 'k', format: 'opus' }, send: two.send });

    reg.pushAudio('legacy-session', 'user-1', new Uint8Array([9]), 'opus');

    expect(one.frames).toHaveLength(1);
    expect(two.frames).toHaveLength(1);
  });

  test('unbinding a session restores the legacy resource-only match', () => {
    const reg = new VoiceStreamRegistry();
    const b = client();
    reg.bindSession('sess', TENANT_A);
    reg.add(
      {},
      {
        params: { sessionId: 'sess', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_B,
        revocationEpoch: 1,
        send: b.send,
      },
    );

    reg.pushAudio('sess', 'u', new Uint8Array([1]), 'opus');
    expect(b.frames).toHaveLength(0);

    reg.unbindSession('sess');
    reg.pushAudio('sess', 'u', new Uint8Array([1]), 'opus');
    expect(b.frames).toHaveLength(1);
  });
});

describe('the tenant is never caller-supplied', () => {
  test('a `tenant` query parameter is ignored by the URL parser', () => {
    const url = new URL(
      `ws://localhost/api/v2/voice/stream/sess?api_key=sk&tenant=${TENANT_B}&tenant_id=${TENANT_B}&tenantId=${TENANT_B}`,
    );
    const params = parseVoiceStreamParams(url);
    expect(params).not.toBeNull();
    expect(JSON.stringify(params)).not.toContain(TENANT_B);
  });
});

describe('revocation terminates live voice sockets', () => {
  test('terminateTenant closes only the revoked tenant and drops its clients', () => {
    const reg = new VoiceStreamRegistry();
    const a = client();
    const b = client();
    reg.add(
      {},
      {
        params: { sessionId: 's1', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_A,
        revocationEpoch: 1,
        send: a.send,
        close: a.close,
      },
    );
    reg.add(
      {},
      {
        params: { sessionId: 's2', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_B,
        revocationEpoch: 1,
        send: b.send,
        close: b.close,
      },
    );

    const closed = reg.terminateTenant(TENANT_A, 'tenant_revoked');

    expect(closed).toBe(1);
    expect(a.closed).toEqual(['tenant_revoked']);
    expect(b.closed).toEqual([]);
    expect(reg.size).toBe(1);
  });

  test('a terminated tenant receives no further audio', () => {
    const reg = new VoiceStreamRegistry();
    const a = client();
    reg.bindSession('s1', TENANT_A);
    reg.add(
      {},
      {
        params: { sessionId: 's1', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_A,
        revocationEpoch: 1,
        send: a.send,
        close: a.close,
      },
    );

    reg.terminateTenant(TENANT_A, 'tenant_revoked');
    reg.pushAudio('s1', 'u', new Uint8Array([1]), 'opus');

    expect(a.frames).toHaveLength(0);
  });

  test('the sweep view exposes each live client tenancy binding', () => {
    const reg = new VoiceStreamRegistry();
    reg.add(
      {},
      {
        params: { sessionId: 's1', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_A,
        revocationEpoch: 4,
        send: () => {},
      },
    );
    reg.add({}, { params: { sessionId: 's2', apiKey: 'k', format: 'opus' }, send: () => {} });

    expect(reg.streamRegistry.activeTenantIds()).toEqual([TENANT_A]);
    expect(reg.streamRegistry.size).toBe(2);
  });

  test('the revocation SWEEP closes the socket AND stops it being an audio target', async () => {
    const reg = new VoiceStreamRegistry();
    const a = client();
    const legacy = client();
    reg.bindSession('s1', TENANT_A);
    reg.add(
      {},
      {
        params: { sessionId: 's1', apiKey: 'k', format: 'opus' },
        tenantId: TENANT_A,
        revocationEpoch: 1,
        send: a.send,
        close: a.close,
      },
    );
    reg.add({}, { params: { sessionId: 'legacy-s', apiKey: 'k', format: 'opus' }, send: legacy.send });

    const stats = await sweepRevokedStreamSubscriptions(
      {} as Database,
      reg.streamRegistry,
      { OMNI_MULTITENANCY_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv,
      async () => ({ status: 'suspended', revocationEpoch: 2 }),
    );

    expect(stats.terminated).toBe(1);
    expect(a.closed).toEqual(['tenant_revoked']);

    // The swept socket must no longer receive audio…
    reg.pushAudio('s1', 'u', new Uint8Array([1]), 'opus');
    expect(a.frames).toHaveLength(0);
    // …and the legacy socket must be untouched by the sweep.
    reg.pushAudio('legacy-s', 'u', new Uint8Array([1]), 'opus');
    expect(legacy.frames).toHaveLength(1);
    expect(reg.size).toBe(1);
  });
});
