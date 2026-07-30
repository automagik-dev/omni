/**
 * Redacted tenant audit/trace field tests
 * (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * The load-bearing probe is the redaction one: given an operation whose
 * surrounding metadata carries secrets, the emitted audit/trace record must
 * carry the tenant id and the actor credential id and NO secret. That is the
 * WISH's "audit logs/traces include tenant ID and actor credential ID" plus
 * "plaintext never appears in ... logs".
 */

import { describe, expect, test } from 'bun:test';
import {
  buildTenantAuditFields,
  buildTenantAuditRecord,
  redactSecrets,
  tenantTraceAttributes,
} from '../tenant-observability';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'cred_01HZY8ABCDEF';
const REQUEST = 'req_abc123';

describe('buildTenantAuditFields', () => {
  test('carries the full tenant id and actor credential id (audit surfaces are access-controlled)', () => {
    const fields = buildTenantAuditFields({ tenantId: TENANT, actorCredentialId: ACTOR, requestId: REQUEST });
    expect(fields.tenantId).toBe(TENANT);
    expect(fields.actorCredentialId).toBe(ACTOR);
    expect(fields.requestId).toBe(REQUEST);
  });

  test('requestId is optional (not every audit point has an edge request id)', () => {
    const fields = buildTenantAuditFields({ tenantId: TENANT, actorCredentialId: ACTOR });
    expect(fields.requestId).toBeUndefined();
  });

  test('rejects a malformed tenant id — a bad tenant must not reach an audit sink silently', () => {
    expect(() => buildTenantAuditFields({ tenantId: 'not-a-uuid', actorCredentialId: ACTOR })).toThrow();
    expect(() => buildTenantAuditFields({ tenantId: '', actorCredentialId: ACTOR })).toThrow();
  });

  test('rejects an empty actor credential id', () => {
    expect(() => buildTenantAuditFields({ tenantId: TENANT, actorCredentialId: '' })).toThrow();
  });

  test('copies only the named identifier fields, so a secret alongside them cannot ride through', () => {
    const fields = buildTenantAuditFields({
      tenantId: TENANT,
      actorCredentialId: ACTOR,
      // deliberately over-supplied to prove a secret sibling does not pass through
      apiSecret: 'omni_sk_shouldnotsurvive',
    } as unknown as Parameters<typeof buildTenantAuditFields>[0]);
    expect(Object.keys(fields).sort()).toEqual(['actorCredentialId', 'tenantId']);
    expect(JSON.stringify(fields)).not.toContain('omni_sk_');
  });
});

describe('redactSecrets', () => {
  test('scrubs secret-shaped keys but keeps tenant id, actor credential id, and request id', () => {
    const scrubbed = redactSecrets({
      tenantId: TENANT,
      actorCredentialId: ACTOR,
      requestId: REQUEST,
      apiSecret: 'omni_sk_live_deadbeef',
      authorization: 'Bearer abc.def.ghi',
      webhookSecret: 's3cr3t',
      keyHash: 'abcd1234',
      password: 'hunter2',
      instanceId: 'inst-9',
    });
    // Identifiers survive.
    expect(scrubbed.tenantId).toBe(TENANT);
    expect(scrubbed.actorCredentialId).toBe(ACTOR);
    expect(scrubbed.requestId).toBe(REQUEST);
    expect(scrubbed.instanceId).toBe('inst-9');
    // Secrets are gone entirely (not masked-in-place with the value still readable).
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain('omni_sk_');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('s3cr3t');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('abcd1234');
    expect('apiSecret' in scrubbed).toBe(false);
    expect('password' in scrubbed).toBe(false);
  });

  test('scrubs a secret-shaped value even under a non-obvious key (omni_sk_ prefix)', () => {
    const scrubbed = redactSecrets({ note: 'omni_sk_live_leaked', ok: 'plain' });
    expect(JSON.stringify(scrubbed)).not.toContain('omni_sk_');
    expect(scrubbed.ok).toBe('plain');
  });

  test('does not scrub the actor credential id despite the word "credential"', () => {
    const scrubbed = redactSecrets({ actorCredentialId: ACTOR });
    expect(scrubbed.actorCredentialId).toBe(ACTOR);
  });

  test('scrubs the broadened secret-shaped keys (bare token/key, session_key, credentials, jwt, refresh_token)', () => {
    const scrubbed = redactSecrets({
      token: 'abc.def.ghi',
      key: 'some-opaque-key-material',
      session_key: 'sess-value',
      credentials: 'user:pass',
      jwt: 'header.payload.signature',
      refresh_token: 'rt-value',
      ok: 'plain',
    });
    expect('token' in scrubbed).toBe(false);
    expect('key' in scrubbed).toBe(false);
    expect('session_key' in scrubbed).toBe(false);
    expect('credentials' in scrubbed).toBe(false);
    expect('jwt' in scrubbed).toBe(false);
    expect('refresh_token' in scrubbed).toBe(false);
    expect(scrubbed.ok).toBe('plain');
  });

  test('scrubs a raw JWT value under an innocuous key (three base64url segments)', () => {
    const rawJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const scrubbed = redactSecrets({ note: rawJwt, ok: 'plain' });
    expect('note' in scrubbed).toBe(false);
    expect(JSON.stringify(scrubbed)).not.toContain('eyJ');
    expect(scrubbed.ok).toBe('plain');
  });

  test('scrubs a raw third-party sk- token value under an innocuous key', () => {
    const scrubbed = redactSecrets({ note: 'sk-proj-9f8e7d6c5b4a3210deadbeef01', ok: 'plain' });
    expect('note' in scrubbed).toBe(false);
    expect(JSON.stringify(scrubbed)).not.toContain('sk-proj-');
    expect(scrubbed.ok).toBe('plain');
  });

  test('identity fields ALWAYS survive — including UUID-valued ids — despite the broadened denylist', () => {
    const tenantUuid = '22222222-2222-4222-8222-222222222222';
    const actorUuid = '33333333-3333-4333-8333-333333333333';
    const scrubbed = redactSecrets({
      tenantId: tenantUuid,
      actorCredentialId: actorUuid,
      requestId: REQUEST,
      instanceId: 'inst-9',
    });
    expect(scrubbed.tenantId).toBe(tenantUuid);
    expect(scrubbed.actorCredentialId).toBe(actorUuid);
    expect(scrubbed.requestId).toBe(REQUEST);
    expect(scrubbed.instanceId).toBe('inst-9');
  });

  test('a bare UUID value under a non-identity key is NOT redacted (structured, not secret material)', () => {
    const scrubbed = redactSecrets({ correlationRef: TENANT });
    expect(scrubbed.correlationRef).toBe(TENANT);
  });

  test('still catches omni_sk_ and PEM private-key values under innocuous keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
    const scrubbed = redactSecrets({ a: 'omni_sk_live_x', b: pem, ok: 'plain' });
    expect('a' in scrubbed).toBe(false);
    expect('b' in scrubbed).toBe(false);
    expect(scrubbed.ok).toBe('plain');
  });
});

describe('buildTenantAuditRecord', () => {
  test('REDACTION PROBE: tenant id + actor credential id present, secrets absent', () => {
    const record = buildTenantAuditRecord(
      { tenantId: TENANT, actorCredentialId: ACTOR, requestId: REQUEST },
      { apiSecret: 'omni_sk_live_x', authorization: 'Bearer y', action: 'agent.dispatch' },
    );
    expect(record.tenantId).toBe(TENANT);
    expect(record.actorCredentialId).toBe(ACTOR);
    expect(record.requestId).toBe(REQUEST);
    expect(record.action).toBe('agent.dispatch');
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('omni_sk_');
    expect(serialized).not.toContain('Bearer');
  });

  test('the identity fields win over any same-named key in the extra metadata bag', () => {
    const record = buildTenantAuditRecord(
      { tenantId: TENANT, actorCredentialId: ACTOR },
      // hostile bag trying to spoof the tenant id through the extra-metadata channel
      { tenantId: '99999999-9999-4999-8999-999999999999' },
    );
    expect(record.tenantId).toBe(TENANT);
  });

  test('a dotted-key identity spoof cannot coexist with the validated identity', () => {
    const record = buildTenantAuditRecord(
      { tenantId: TENANT, actorCredentialId: ACTOR, requestId: REQUEST },
      // hostile bag using OTEL-style dotted identity keys to smuggle a fake tenant
      {
        'tenant.id': '99999999-9999-4999-8999-999999999999',
        'actor.credential_id': 'cred_FAKE',
        'request.id': 'req_FAKE',
      },
    );
    // The dotted spoof keys are stripped; only the validated camelCase identity remains.
    expect(record['tenant.id']).toBeUndefined();
    expect(record['actor.credential_id']).toBeUndefined();
    expect(record['request.id']).toBeUndefined();
    expect(record.tenantId).toBe(TENANT);
    expect(JSON.stringify(record)).not.toContain('99999999-9999-4999-8999-999999999999');
    expect(JSON.stringify(record)).not.toContain('cred_FAKE');
  });
});

describe('tenantTraceAttributes', () => {
  test('produces OTEL-style attribute keys carrying tenant + actor + request id', () => {
    const attrs = tenantTraceAttributes(
      buildTenantAuditFields({ tenantId: TENANT, actorCredentialId: ACTOR, requestId: REQUEST }),
    );
    expect(attrs['tenant.id']).toBe(TENANT);
    expect(attrs['actor.credential_id']).toBe(ACTOR);
    expect(attrs['request.id']).toBe(REQUEST);
  });

  test('omits request.id when there is no edge request id', () => {
    const attrs = tenantTraceAttributes(buildTenantAuditFields({ tenantId: TENANT, actorCredentialId: ACTOR }));
    expect('request.id' in attrs).toBe(false);
  });
});
