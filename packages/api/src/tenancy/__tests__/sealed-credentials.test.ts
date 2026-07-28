/**
 * The tenant-bound credential-FIELD codec (G5 deliverable (g); ADR-0008).
 *
 * `tenant-secret-box` seals a secret into a structured envelope. Most of the
 * remaining credential surfaces store their secret in a `text` COLUMN
 * (`instances.discord_bot_token`, `agent_providers.api_key`,
 * `plugin_storage.value`, `global_settings.value`), so they need the envelope
 * flattened into a string and, critically, a TRANSITIONAL read that still
 * accepts the legacy plaintext already sitting in those columns.
 *
 * What these tests pin:
 *   * DUAL WORLD — no tenant, or no master key, means the value passes through
 *     UNCHANGED in both directions. That is the byte-identical legacy contract;
 *     the codec must not even reshape the string.
 *   * SEALED — with tenant + key the stored string contains no plaintext and the
 *     owning tenant reads it back exactly.
 *   * CROSS-TENANT REFUSAL — tenant B opening tenant A's sealed field fails
 *     CLOSED to null, never to the ciphertext and never to a throw.
 *   * TRANSITIONAL READ — a legacy plaintext column value survives a read even
 *     while sealing is enabled (that is what makes the rollout incremental).
 *   * NO PLAINTEXT DOWNGRADE ON A BLIND READ — a sealed field read with no
 *     tenant available yields null, not the envelope string. A caller must never
 *     be handed a blob it would then send to a channel as a bot token.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { setTenantSecretMasterKey } from '@omni/core';
import { isSealedCredentialField, openCredentialField, sealCredentialField } from '../sealed-credentials';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const MASTER_KEY = Buffer.alloc(32, 7);

afterEach(() => setTenantSecretMasterKey(null));

describe('sealed-credentials — dual world (inert without a key)', () => {
  test('no master key: seal is the identity function even with a tenant', () => {
    setTenantSecretMasterKey(null);
    expect(sealCredentialField(TENANT_A, 'xoxb-super-secret')).toBe('xoxb-super-secret');
  });

  test('no tenant: seal is the identity function even with a key', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    expect(sealCredentialField(null, 'xoxb-super-secret')).toBe('xoxb-super-secret');
    expect(sealCredentialField(undefined, 'xoxb-super-secret')).toBe('xoxb-super-secret');
  });

  test('null/undefined plaintext passes through unchanged in every world', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    expect(sealCredentialField(TENANT_A, null)).toBeNull();
    expect(sealCredentialField(TENANT_A, undefined)).toBeUndefined();
    expect(openCredentialField(TENANT_A, null)).toBeNull();
    expect(openCredentialField(TENANT_A, undefined)).toBeUndefined();
  });

  test('empty string is not sealed (nothing to protect, and callers treat it as absent)', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    expect(sealCredentialField(TENANT_A, '')).toBe('');
  });
});

describe('sealed-credentials — sealed at rest', () => {
  test('tenant + key: the stored string carries no plaintext and the owner round-trips it', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const stored = sealCredentialField(TENANT_A, 'xoxb-super-secret');
    if (typeof stored !== 'string') throw new Error('expected a sealed string');

    expect(stored).not.toContain('xoxb-super-secret');
    expect(isSealedCredentialField(stored)).toBe(true);
    expect(openCredentialField(TENANT_A, stored)).toBe('xoxb-super-secret');
  });

  test('two seals of the same secret differ (fresh nonce), and both open', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const a = sealCredentialField(TENANT_A, 'same-token');
    const b = sealCredentialField(TENANT_A, 'same-token');
    expect(a).not.toBe(b);
    expect(openCredentialField(TENANT_A, a as string)).toBe('same-token');
    expect(openCredentialField(TENANT_A, b as string)).toBe('same-token');
  });
});

describe('sealed-credentials — cross-tenant refusal', () => {
  test('tenant B cannot open a field sealed for tenant A (null, not a throw, not the blob)', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const stored = sealCredentialField(TENANT_A, 'tenant-a-bot-token') as string;
    expect(openCredentialField(TENANT_B, stored)).toBeNull();
  });

  test('rewriting the stored tenant label does not make it openable by the forger', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const stored = sealCredentialField(TENANT_A, 'tenant-a-bot-token') as string;
    const forged = JSON.stringify({ ...JSON.parse(stored), t: TENANT_B });
    expect(openCredentialField(TENANT_B, forged)).toBeNull();
  });

  test('a sealed field read with NO tenant yields null — never the envelope string', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const stored = sealCredentialField(TENANT_A, 'tenant-a-bot-token') as string;
    expect(openCredentialField(null, stored)).toBeNull();
  });

  test('a sealed field read after the key is withdrawn yields null, not the blob', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const stored = sealCredentialField(TENANT_A, 'tenant-a-bot-token') as string;
    setTenantSecretMasterKey(null);
    expect(openCredentialField(TENANT_A, stored)).toBeNull();
  });
});

describe('sealed-credentials — transitional reads', () => {
  test('legacy plaintext still reads through while sealing is enabled', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    expect(openCredentialField(TENANT_A, 'legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });

  test('a JSON value that is not a sealed envelope is left alone', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const notSealed = '{"v":1,"hello":"world"}';
    expect(isSealedCredentialField(notSealed)).toBe(false);
    expect(openCredentialField(TENANT_A, notSealed)).toBe(notSealed);
  });

  test('a value that merely looks like the sealed prefix but is malformed JSON is left alone', () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const junk = '{"v":not-json';
    expect(isSealedCredentialField(junk)).toBe(false);
    expect(openCredentialField(TENANT_A, junk)).toBe(junk);
  });
});
