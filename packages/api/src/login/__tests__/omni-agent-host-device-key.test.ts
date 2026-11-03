/**
 * The agent-host device client (#1461): a paired agent host reads events and nothing else
 * (owner decision 2026-11-03). Its device key is the literal set below, under the operator's
 * ceiling, never more; no send, write, admin, `auth:*` or `keys:*` scope, and no companion key.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DEVICE_KEY_SCOPES,
  DEVICE_CLIENTS,
  DEVICE_CLIENT_KEYS,
  FORBIDDEN_SCOPE,
  deviceKeysFor,
  isDeviceClient,
  readLoginConfig,
} from '../config';

const AGENT_HOST = 'omni-agent-host';
/** The approved set, written out: read events only. */
const APPROVED = ['events:read'];

describe('the omni-agent-host device client', () => {
  test('is a known device client', () => {
    expect(isDeviceClient(AGENT_HOST)).toBe(true);
    expect(DEVICE_CLIENTS[AGENT_HOST as keyof typeof DEVICE_CLIENTS]).toBeString();
  });

  test('declares exactly the approved scopes and no companion key', () => {
    expect(DEVICE_CLIENT_KEYS[AGENT_HOST as keyof typeof DEVICE_CLIENT_KEYS]).toEqual({ scopes: APPROVED });
  });

  test('its key under the default ceiling is exactly the approved set', () => {
    expect(deviceKeysFor(AGENT_HOST, DEFAULT_DEVICE_KEY_SCOPES)).toEqual({ scopes: APPROVED, companions: [] });
  });

  test('carries no send, write, admin, auth, keys or other governing scope', () => {
    const { scopes } = deviceKeysFor(AGENT_HOST, DEFAULT_DEVICE_KEY_SCOPES);
    expect(scopes.filter((scope) => FORBIDDEN_SCOPE.test(scope))).toEqual([]);
    expect(scopes.filter((scope) => !scope.endsWith(':read'))).toEqual([]);
    expect(scopes.filter((scope) => !scope.startsWith('events:'))).toEqual([]);
  });

  test("the operator's ceiling narrows it and never widens it", () => {
    const cases: [ceiling: string[], expected: string[]][] = [
      [['events:*'], ['events:read']],
      [['events:read'], ['events:read']],
      [['messages:*', 'events:read'], ['events:read']],
      [['instances:read', 'chats:read'], []],
      [['messages:*'], []],
      // events:write is not events:read: the ceiling must name the read.
      [['events:write'], []],
    ];
    for (const [ceiling, expected] of cases) {
      const keys = deviceKeysFor(AGENT_HOST, ceiling);
      expect({ ceiling, scopes: keys.scopes, companions: keys.companions }).toEqual({
        ceiling,
        scopes: expected,
        companions: [],
      });
      // Every granted scope is both declared and covered by the ceiling.
      for (const scope of keys.scopes) {
        expect(APPROVED).toContain(scope);
        expect(ceiling.includes(scope) || ceiling.includes(`${scope.split(':')[0]}:*`)).toBe(true);
      }
    }
  });

  test('cannot pair on a multitenant deployment: login is off there', () => {
    expect(
      readLoginConfig({
        OMNI_MULTITENANCY_ENABLED: 'true',
        OMNI_AUTH_SECRET: 'test-secret-test-secret-test-secret-42',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
