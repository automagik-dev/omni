/**
 * The omni-cli device key's scopes are pinned (#1461): the CLI's device login and
 * `/auth/validate` for any authenticated credential widen nothing. `omni-cli` declares no
 * keys of its own, so its device key is exactly the operator ceiling, which by default is
 * this set, with no `auth:*` or `keys:*` scope.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_DEVICE_KEY_SCOPES, DEVICE_CLIENTS, DEVICE_CLIENT_KEYS, FORBIDDEN_SCOPE, deviceKeysFor } from '../config';

/** DEFAULT_DEVICE_KEY_SCOPES as on origin/dev 5c1a2316f. */
const DEV_DEFAULT_DEVICE_KEY_SCOPES = [
  'instances:*',
  'chats:*',
  'messages:*',
  'events:*',
  'persons:*',
  'automations:*',
  'agents:*',
  'agent-state:*',
  'agent-tasks:*',
  'providers:*',
  'routes:*',
  'follow-up:*',
  'handoffs:*',
  'conversations:*',
  'context:*',
  'media:*',
  'voice:*',
  'tts:*',
  'turns:*',
  'webhooks:*',
  'batch-jobs:*',
  'connectors:*',
  'payloads:*',
  'dead-letters:*',
  'event-ops:*',
  'journeys:*',
  'access:*',
  'system:read',
  'system:update',
];

describe('the omni-cli device key', () => {
  test('the default device-key scopes are exactly the set on dev', () => {
    expect<string[]>([...DEFAULT_DEVICE_KEY_SCOPES]).toEqual(DEV_DEFAULT_DEVICE_KEY_SCOPES);
  });

  test('omni-cli gets the default scopes and no companion key', () => {
    expect(DEVICE_CLIENTS['omni-cli']).toBe('the omni command line');
    expect(DEVICE_CLIENT_KEYS['omni-cli']).toBeUndefined();
    expect(deviceKeysFor('omni-cli', DEFAULT_DEVICE_KEY_SCOPES)).toEqual({
      scopes: DEV_DEFAULT_DEVICE_KEY_SCOPES,
      companions: [],
    });
  });

  test('it carries no auth, keys or other governing scope', () => {
    const { scopes } = deviceKeysFor('omni-cli', DEFAULT_DEVICE_KEY_SCOPES);
    expect(scopes.filter((scope) => FORBIDDEN_SCOPE.test(scope))).toEqual([]);
    expect(scopes.some((scope) => scope.startsWith('auth:') || scope.startsWith('keys:'))).toBe(false);
  });
});
