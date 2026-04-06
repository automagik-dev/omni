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
  UPDATE_ERROR_AUTH_INVALID,
  decideUpdateVerify,
  normalizeVersion,
  updateErrorVersionMismatch,
} from '../commands/update.js';

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
