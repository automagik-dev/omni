/**
 * update-verify tests
 *
 * Covers the pure `decideUpdateVerify` decision function that drives the
 * 3-step post-update verification. We do NOT spin up pm2 or a real server
 * here — the caller (runUpdate) is what ties this into the outside world.
 *
 * Error message strings are also asserted so the exact user-facing text
 * in the wish ("Server version mismatch: ... Run: omni doctor" and
 * "Auth key invalid after restart. Run: omni doctor --fix") is locked in.
 */

import { describe, expect, test } from 'bun:test';
import {
  type OmniClientFactory,
  UPDATE_ERROR_AUTH_INVALID,
  decideUpdateVerify,
  normalizeVersion,
  updateErrorVersionMismatch,
  validateStoredKey,
} from '../commands/update.js';
import type { Config } from '../config.js';

describe('normalizeVersion', () => {
  test('strips a git-hash suffix', () => {
    expect(normalizeVersion('2.20260218.18+abc1234')).toBe('2.20260218.18');
  });

  test('passes plain versions through', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
  });
});

describe('decideUpdateVerify', () => {
  const base = {
    latest: '2.20260218.18',
    apiPort: 8882,
  };

  test('returns ok when version matches and key is valid', () => {
    const result = decideUpdateVerify({
      ...base,
      healthBody: { status: 'healthy', version: '2.20260218.18' },
      keyValid: true,
    });
    expect(result).toEqual({
      kind: 'ok',
      cliVersion: '2.20260218.18',
      serverVersion: '2.20260218.18',
    });
  });

  test('returns ok when the server reports a build hash suffix', () => {
    const result = decideUpdateVerify({
      ...base,
      healthBody: { status: 'healthy', version: '2.20260218.18+abc1234' },
      keyValid: true,
    });
    expect(result.kind).toBe('ok');
  });

  test('returns health-unreachable when body is null', () => {
    const result = decideUpdateVerify({ ...base, healthBody: null, keyValid: false });
    expect(result).toEqual({ kind: 'health-unreachable', apiPort: 8882 });
  });

  test('returns version-mismatch when server version differs', () => {
    const result = decideUpdateVerify({
      ...base,
      healthBody: { status: 'healthy', version: '1.0.0' },
      keyValid: true,
    });
    expect(result).toEqual({
      kind: 'version-mismatch',
      cliVersion: '2.20260218.18',
      serverVersion: '1.0.0',
    });
  });

  test('returns version-mismatch when server version is missing', () => {
    const result = decideUpdateVerify({
      ...base,
      healthBody: { status: 'healthy' },
      keyValid: true,
    });
    expect(result).toEqual({
      kind: 'version-mismatch',
      cliVersion: '2.20260218.18',
      serverVersion: null,
    });
  });

  test('returns auth-invalid when version matches but key does not validate', () => {
    const result = decideUpdateVerify({
      ...base,
      healthBody: { status: 'healthy', version: '2.20260218.18' },
      keyValid: false,
    });
    expect(result).toEqual({ kind: 'auth-invalid' });
  });
});

describe('validateStoredKey — always targets localhost (HIGH-3)', () => {
  // Build a stub client factory that records the baseUrl it was handed,
  // so tests can assert the post-restart probe never talks to a remote
  // cliConfig.apiUrl. The factory returns a minimal shape that only
  // exposes the `auth.validate()` method validateStoredKey calls.
  function mkSpyFactory(validResponse: boolean): {
    factory: OmniClientFactory;
    received: { baseUrl?: string; apiKey?: string };
  } {
    const received: { baseUrl?: string; apiKey?: string } = {};
    // We cast because createOmniClient's real return type is enormous;
    // the spy only needs to expose the subset validateStoredKey touches.
    const factory = ((config: { baseUrl: string; apiKey: string }) => {
      received.baseUrl = config.baseUrl;
      received.apiKey = config.apiKey;
      return {
        auth: {
          validate: async () => ({ valid: validResponse }),
        },
      };
    }) as unknown as OmniClientFactory;
    return { factory, received };
  }

  test('uses http://localhost:<apiPort> even when cliConfig.apiUrl is remote', async () => {
    // Before the HIGH-3 fix, this test would fail — validateStoredKey
    // preferred `cliConfig.apiUrl` over the local port, which produced
    // bogus pass/fail for operators pointing the CLI at a shared server.
    const { factory, received } = mkSpyFactory(true);
    const cliConfig: Config = {
      apiKey: 'omni_sk_test-key',
      apiUrl: 'https://prod.example.com',
    };

    const result = await validateStoredKey(8882, cliConfig, factory);

    expect(result).toBe(true);
    expect(received.baseUrl).toBe('http://localhost:8882');
    expect(received.apiKey).toBe('omni_sk_test-key');
  });

  test('ignores cliConfig.apiUrl even when it is undefined', async () => {
    const { factory, received } = mkSpyFactory(true);
    const cliConfig: Config = { apiKey: 'omni_sk_test-key' };

    await validateStoredKey(9000, cliConfig, factory);

    expect(received.baseUrl).toBe('http://localhost:9000');
  });

  test('returns false without calling the factory when no apiKey is stored', async () => {
    let factoryCalled = false;
    const factory = (() => {
      factoryCalled = true;
      return { auth: { validate: async () => ({ valid: true }) } };
    }) as unknown as OmniClientFactory;

    const result = await validateStoredKey(8882, {}, factory);

    expect(result).toBe(false);
    expect(factoryCalled).toBe(false);
  });

  test('returns false when the auth.validate call throws', async () => {
    const factory = (() => ({
      auth: {
        validate: async () => {
          throw new Error('network blew up');
        },
      },
    })) as unknown as OmniClientFactory;

    const result = await validateStoredKey(8882, { apiKey: 'omni_sk_test-key' }, factory);

    expect(result).toBe(false);
  });

  test('returns false when auth.validate responds with valid: false', async () => {
    const { factory } = mkSpyFactory(false);
    const result = await validateStoredKey(8882, { apiKey: 'omni_sk_test-key' }, factory);
    expect(result).toBe(false);
  });
});

describe('update error message strings', () => {
  test('updateErrorVersionMismatch formats the exact documented message', () => {
    const msg = updateErrorVersionMismatch('2.20260218.18', '1.0.0');
    expect(msg).toBe('Server version mismatch: cli=v2.20260218.18 server=v1.0.0. Run: omni doctor');
  });

  test('updateErrorVersionMismatch handles a null server version', () => {
    const msg = updateErrorVersionMismatch('2.20260218.18', null);
    expect(msg).toBe('Server version mismatch: cli=v2.20260218.18 server=vunknown. Run: omni doctor');
  });

  test('UPDATE_ERROR_AUTH_INVALID is the exact documented string', () => {
    expect(UPDATE_ERROR_AUTH_INVALID).toBe('Auth key invalid after restart. Run: omni doctor --fix');
  });
});
