/**
 * CLI `omni webhooks create|update` — signature secret sources.
 *
 * The secret can come from argv (kept for scripting; visible in shell history),
 * an environment variable, or stdin. Exactly one source, validated against the
 * API's bounds before any request is sent.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { __testables } from '../webhooks';

const { resolveSignatureSecret, assertPairedSignatureOnCreate } = __testables;

const ENV_VAR = 'OMNI_TEST_WEBHOOK_SECRET';

// resolveSignatureSecret reads process.env at call time. Clear the variable
// before EVERY test (so the unset-variable case cannot read a host-provided
// value, even when run alone) and hand the host's value back after the suite.
const hostValue = process.env[ENV_VAR];

beforeEach(() => {
  Reflect.deleteProperty(process.env, ENV_VAR);
});

afterAll(() => {
  if (hostValue === undefined) Reflect.deleteProperty(process.env, ENV_VAR);
  else process.env[ENV_VAR] = hostValue;
});

describe('resolveSignatureSecret', () => {
  test('returns undefined when no source is given', async () => {
    expect(await resolveSignatureSecret({})).toBeUndefined();
  });

  test('argv flag is still accepted', async () => {
    expect(await resolveSignatureSecret({ signatureSecret: 'argv-secret-1' })).toBe('argv-secret-1');
  });

  test('reads the secret from the named environment variable', async () => {
    process.env[ENV_VAR] = 'from-env-secret';
    expect(await resolveSignatureSecret({ signatureSecretEnv: ENV_VAR })).toBe('from-env-secret');
  });

  test('an unset or empty environment variable is an error, not an empty secret', async () => {
    await expect(resolveSignatureSecret({ signatureSecretEnv: ENV_VAR })).rejects.toThrow(
      `environment variable ${ENV_VAR} is not set or empty`,
    );
    process.env[ENV_VAR] = '';
    await expect(resolveSignatureSecret({ signatureSecretEnv: ENV_VAR })).rejects.toThrow('not set or empty');
  });

  test('reads the secret from stdin and strips the trailing newline', async () => {
    const readStdin = async () => 'from-stdin-secret\n';
    expect(await resolveSignatureSecret({ signatureSecretStdin: true }, readStdin)).toBe('from-stdin-secret');
  });

  test('stdin keeps interior whitespace and only strips one trailing line break', async () => {
    const readStdin = async () => 'with space inside\r\n';
    expect(await resolveSignatureSecret({ signatureSecretStdin: true }, readStdin)).toBe('with space inside');
  });

  test('empty stdin is an error', async () => {
    const readStdin = async () => '\n';
    await expect(resolveSignatureSecret({ signatureSecretStdin: true }, readStdin)).rejects.toThrow(
      'no secret received on stdin',
    );
  });

  test('more than one source is rejected', async () => {
    process.env[ENV_VAR] = 'from-env-secret';
    await expect(
      resolveSignatureSecret({ signatureSecret: 'argv-secret-1', signatureSecretEnv: ENV_VAR }),
    ).rejects.toThrow('Use only one of');
    await expect(
      resolveSignatureSecret({ signatureSecretStdin: true, signatureSecretEnv: ENV_VAR }, async () => 'x'),
    ).rejects.toThrow('Use only one of');
  });

  test('applies the API bounds (8-512 chars) to every source', async () => {
    await expect(resolveSignatureSecret({ signatureSecret: 'short' })).rejects.toThrow('at least 8 characters');
    process.env[ENV_VAR] = 'x'.repeat(513);
    await expect(resolveSignatureSecret({ signatureSecretEnv: ENV_VAR })).rejects.toThrow('at most 512 characters');
    await expect(resolveSignatureSecret({ signatureSecretStdin: true }, async () => 'tiny\n')).rejects.toThrow(
      'at least 8 characters',
    );
  });
});

describe('assertPairedSignatureOnCreate', () => {
  const config = { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256' } as const;

  test('neither or both is fine', () => {
    expect(() => assertPairedSignatureOnCreate(undefined, undefined)).not.toThrow();
    expect(() => assertPairedSignatureOnCreate(config, 'long-enough-secret')).not.toThrow();
  });

  test('a config without a secret fails before any request is sent', () => {
    expect(() => assertPairedSignatureOnCreate(config, undefined)).toThrow('require a signature secret');
  });

  test('a secret without a config fails before any request is sent', () => {
    expect(() => assertPairedSignatureOnCreate(undefined, 'long-enough-secret')).toThrow(
      'requires --signature-algorithm and --signature-header',
    );
  });
});
