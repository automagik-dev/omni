/**
 * CLI `omni webhooks create|update` — signature secret sources and the
 * `--event-type-mapping` flag (#1011).
 *
 * The secret can come from argv (kept for scripting; visible in shell history),
 * an environment variable, or stdin. Exactly one source, validated against the
 * API's bounds before any request is sent.
 *
 * The event-type mapping comes as inline JSON or `@file`, validated against
 * the API's mapping schema before any request is sent; on update it is
 * undefined-when-omitted so the PATCH never clobbers a stored mapping.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __testables } from '../webhooks';

const { resolveSignatureSecret, assertPairedSignatureOnCreate, resolveEventTypeMapping, buildUpdateSourcePatch } =
  __testables;

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

describe('resolveEventTypeMapping', () => {
  test('returns undefined when the flag was not given', () => {
    expect(resolveEventTypeMapping(undefined)).toBeUndefined();
  });

  test('accepts the header-source variant inline', () => {
    expect(resolveEventTypeMapping('{"source":"header","header":"X-GitHub-Event"}')).toEqual({
      source: 'header',
      header: 'X-GitHub-Event',
    });
  });

  test('accepts the body-source variant inline (#984)', () => {
    expect(resolveEventTypeMapping('{"source":"body","path":"event"}')).toEqual({
      source: 'body',
      path: 'event',
    });
  });

  test('reads the mapping from @file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-1011-'));
    try {
      const file = join(dir, 'mapping.json');
      writeFileSync(file, '{"source":"body","path":"event"}\n');
      expect(resolveEventTypeMapping(`@${file}`)).toEqual({ source: 'body', path: 'event' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unreadable @file fails before any request is sent', () => {
    expect(() => resolveEventTypeMapping('@/nonexistent/omni-1011-mapping.json')).toThrow(
      "Cannot read --event-type-mapping file '/nonexistent/omni-1011-mapping.json'",
    );
  });

  test('invalid JSON fails before any request is sent', () => {
    expect(() => resolveEventTypeMapping('{source:header}')).toThrow('Invalid JSON for --event-type-mapping');
  });

  test('a schema-invalid mapping fails before any request is sent', () => {
    // Wrong discriminator
    expect(() => resolveEventTypeMapping('{"source":"query","name":"event"}')).toThrow('Invalid --event-type-mapping');
    // Right discriminator, wrong companion field
    expect(() => resolveEventTypeMapping('{"source":"header","path":"event"}')).toThrow('Invalid --event-type-mapping');
    // Bounds (1-200 chars) applied client-side like the API
    expect(() => resolveEventTypeMapping(`{"source":"body","path":"${'x'.repeat(201)}"}`)).toThrow(
      'path must be 1-200 characters',
    );
    expect(() => resolveEventTypeMapping('{"source":"header","header":""}')).toThrow('header must be 1-200 characters');
  });
});

describe('buildUpdateSourcePatch — eventTypeMapping', () => {
  test('omitted → the PATCH body has no eventTypeMapping key (no clobber)', async () => {
    const updates = await buildUpdateSourcePatch({ name: 'renamed' });
    expect('eventTypeMapping' in updates).toBe(false);
    expect(updates).toEqual({ name: 'renamed' });
  });

  test('--event-type-mapping sets the mapping', async () => {
    const updates = await buildUpdateSourcePatch({
      eventTypeMapping: '{"source":"header","header":"X-GitHub-Event"}',
    });
    expect(updates.eventTypeMapping).toEqual({ source: 'header', header: 'X-GitHub-Event' });
  });

  test('--clear-event-type-mapping sends an explicit null', async () => {
    const updates = await buildUpdateSourcePatch({ clearEventTypeMapping: true });
    expect(updates.eventTypeMapping).toBeNull();
  });

  test('set and clear together are rejected', async () => {
    await expect(
      buildUpdateSourcePatch({
        eventTypeMapping: '{"source":"body","path":"event"}',
        clearEventTypeMapping: true,
      }),
    ).rejects.toThrow('Use only one of --event-type-mapping and --clear-event-type-mapping');
  });

  test('an invalid mapping rejects the whole update before any request is sent', async () => {
    await expect(buildUpdateSourcePatch({ eventTypeMapping: 'not json' })).rejects.toThrow(
      'Invalid JSON for --event-type-mapping',
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
