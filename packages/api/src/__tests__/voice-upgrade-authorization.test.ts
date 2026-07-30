/**
 * Voice WebSocket upgrade authorization — G5 deliverable (e)
 * (wish: omni-full-multitenancy; ADR-0008, ADR-0003).
 *
 * Pre-G5 the upgrade authorized a connection by asking "does ANY loaded plugin
 * hold a session with this id?" — a resource-UUID-only check across every
 * tenant's instances. These probes pin the tenant-authorized replacement:
 *
 *   * the tenant comes from the CREDENTIAL, never from the URL;
 *   * the session's instance must be owned by that same tenant;
 *   * an unknown session, an unresolvable credential, or an unowned instance is
 *     refused — fail-closed, never "allow because we could not tell";
 *   * DUAL WORLD: flag-off returns the pre-G5 decision with NO tenant, and
 *     performs no credential-tenant or ownership lookup at all.
 */

import { describe, expect, test } from 'bun:test';
import { authorizeVoiceUpgrade } from '../ws/voice-upgrade-authorization';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const FLAG_ON = { OMNI_MULTITENANCY_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv;
const FLAG_OFF = {} as unknown as NodeJS.ProcessEnv;

function deps(overrides: Record<string, unknown> = {}) {
  const calls = { credential: 0, ownership: 0 };
  return {
    calls,
    deps: {
      resolveCredentialTenant: async () => {
        calls.credential += 1;
        return { tenantId: TENANT_A, revocationEpoch: 3 };
      },
      resolveSessionInstanceId: () => 'instance-1',
      resolveInstanceTenantId: async () => {
        calls.ownership += 1;
        return TENANT_A;
      },
      ...overrides,
    },
  };
}

describe('flag-on: tenant-authorized upgrade', () => {
  test('a tenant may open its OWN session, carrying the credential epoch', async () => {
    const { deps: d } = deps();
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 's1' }, d, FLAG_ON);
    expect(result).toEqual({ ok: true, tenantId: TENANT_A, revocationEpoch: 3 });
  });

  test('naming another tenant session is refused — knowledge is not authority', async () => {
    const { deps: d } = deps({ resolveInstanceTenantId: async () => TENANT_B });
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 's1' }, d, FLAG_ON);
    expect(result).toEqual({ ok: false, reason: 'cross_tenant_resource' });
  });

  test('an unresolvable credential is refused before any ownership lookup', async () => {
    const { deps: d, calls } = deps({ resolveCredentialTenant: async () => null });
    const result = await authorizeVoiceUpgrade({ apiKey: 'bad', sessionId: 's1' }, d, FLAG_ON);
    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(calls.ownership).toBe(0);
  });

  test('an unknown session is refused', async () => {
    const { deps: d } = deps({ resolveSessionInstanceId: () => null });
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 'ghost' }, d, FLAG_ON);
    expect(result).toEqual({ ok: false, reason: 'session_not_found' });
  });

  test('fail-closed: an instance with no resolvable owner is refused', async () => {
    const { deps: d } = deps({ resolveInstanceTenantId: async () => null });
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 's1' }, d, FLAG_ON);
    expect(result).toEqual({ ok: false, reason: 'unowned_resource' });
  });

  test('fail-closed: an ownership lookup that throws refuses, never allows', async () => {
    const { deps: d } = deps({
      resolveInstanceTenantId: async () => {
        throw new Error('rls denied');
      },
    });
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 's1' }, d, FLAG_ON);
    expect(result).toEqual({ ok: false, reason: 'unowned_resource' });
  });

  test('fail-closed: a credential lookup that throws refuses, never allows', async () => {
    const { deps: d } = deps({
      resolveCredentialTenant: async () => {
        throw new Error('auth plane down');
      },
    });
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 's1' }, d, FLAG_ON);
    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
  });
});

describe('DUAL WORLD: flag-off is the pre-G5 decision', () => {
  test('an existing session is admitted with NO tenant and no tenancy lookups', async () => {
    const { deps: d, calls } = deps();
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 's1' }, d, FLAG_OFF);
    expect(result).toEqual({ ok: true, tenantId: null, revocationEpoch: 0 });
    expect(calls.credential).toBe(0);
    expect(calls.ownership).toBe(0);
  });

  test('an unknown session is still refused, exactly as pre-G5', async () => {
    const { deps: d } = deps({ resolveSessionInstanceId: () => null });
    const result = await authorizeVoiceUpgrade({ apiKey: 'k', sessionId: 'ghost' }, d, FLAG_OFF);
    expect(result).toEqual({ ok: false, reason: 'session_not_found' });
  });
});
