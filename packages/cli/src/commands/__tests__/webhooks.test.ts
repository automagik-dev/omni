/**
 * CLI `omni webhooks create|update` — signature secret sources.
 *
 * The secret can come from argv (kept for scripting; visible in shell history),
 * an environment variable, or stdin. Exactly one source, validated against the
 * API's bounds before any request is sent.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { __testables } from '../webhooks';

const { resolveSignatureSecret } = __testables;

const ENV_VAR = 'OMNI_TEST_WEBHOOK_SECRET';

afterEach(() => {
  delete process.env[ENV_VAR];
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
