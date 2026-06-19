/**
 * update-verify tests
 *
 * Covers the pure `decideVerify` decision function (and its deprecated
 * alias `decideUpdateVerify`) that drives the 3-step post-update
 * verification. We do NOT spin up pm2 or a real server here — the caller
 * (runUpdate) is what ties this into the outside world.
 *
 * Error message strings are also asserted so the exact user-facing text
 * in the wish ("Server version mismatch: ... Run: omni doctor" and
 * "Auth key invalid after restart. Run: omni doctor --fix") is locked in.
 */

import { describe, expect, test } from 'bun:test';
import {
  UPDATE_ERROR_AUTH_INVALID,
  decideUpdateVerify,
  decideVerify,
  normalizeVersion,
  resolveChannel,
  updateErrorVersionMismatch,
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

describe('decideVerify (canonical name) — public-shape parity', () => {
  test('decideUpdateVerify is a pointer-equal alias of decideVerify', () => {
    expect(decideUpdateVerify).toBe(decideVerify);
  });

  test('returns skipped { reason: "no-restart" } when skipReason is set', () => {
    const result = decideVerify({ skipReason: 'no-restart' });
    expect(result).toEqual({ kind: 'skipped', reason: 'no-restart' });
  });

  test('returns skipped { reason: "no-verify-flag" } when --no-verify is wired in', () => {
    const result = decideVerify({ skipReason: 'no-verify-flag' });
    expect(result).toEqual({ kind: 'skipped', reason: 'no-verify-flag' });
  });

  test('returns skipped { reason: "no-running-services" } when no pm2 services were online', () => {
    const result = decideVerify({ skipReason: 'no-running-services' });
    expect(result).toEqual({ kind: 'skipped', reason: 'no-running-services' });
  });

  test('full-args path produces same result as decideUpdateVerify (byte-identical)', () => {
    const args = {
      latest: '2.20260218.18',
      apiPort: 8882,
      healthBody: { status: 'healthy', version: '2.20260218.18' },
      keyValid: true,
    } as const;
    expect(decideVerify(args)).toEqual(decideUpdateVerify(args));
  });
});

describe('resolveChannel', () => {
  test('--next overrides everything else', () => {
    const config: Config = { updateChannel: 'latest' };
    expect(resolveChannel({ next: true }, config)).toBe('next');
  });

  test('--stable overrides everything else', () => {
    const config: Config = { updateChannel: 'next' };
    expect(resolveChannel({ stable: true }, config)).toBe('latest');
  });

  test('uses saved updateChannel when no flag is provided', () => {
    expect(resolveChannel({}, { updateChannel: 'next' })).toBe('next');
    expect(resolveChannel({}, { updateChannel: 'latest' })).toBe('latest');
  });

  test('defaults to latest when no flag and no saved channel', () => {
    expect(resolveChannel({}, {})).toBe('latest');
  });

  test('defaults to latest when saved channel is invalid', () => {
    // Simulate a legacy 'main' value left over from before the rename.
    const config = { updateChannel: 'main' } as unknown as Config;
    expect(resolveChannel({}, config)).toBe('latest');
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
