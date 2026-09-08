/**
 * META_GRAPH_API_VERSION resolution for non-canonical whatsapp-business
 * connects (generic connect/restart, boot auto-reconnect).
 *
 * The env var is a runtime override of the provisioning snapshot stored on
 * the row. It must win when it carries a real Graph version and be ignored
 * — not empty out the snapshot — when it is absent, empty, or malformed.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { applyWhatsAppBusinessConnectionOptions } from '../whatsapp-business-connection';

const ENV = 'META_GRAPH_API_VERSION';
const original = process.env[ENV];

function setEnv(value: string | undefined): void {
  // Not `= undefined` — process.env coerces that to the string "undefined".
  if (value === undefined) Reflect.deleteProperty(process.env, ENV);
  else process.env[ENV] = value;
}

afterEach(() => setEnv(original));

function resolve(persisted: string | null | undefined, env: string | undefined): unknown {
  setEnv(env);
  const options: Record<string, unknown> = {};
  applyWhatsAppBusinessConnectionOptions(options, { metaApiVersion: persisted });
  return options.metaApiVersion;
}

describe('applyWhatsAppBusinessConnectionOptions — metaApiVersion', () => {
  test('a valid env version beats the persisted snapshot', () => {
    expect(resolve('v25.0', 'v26.0')).toBe('v26.0');
  });

  test('an absent env keeps the persisted snapshot', () => {
    expect(resolve('v25.0', undefined)).toBe('v25.0');
  });

  test('an empty env value does not erase the persisted snapshot', () => {
    expect(resolve('v25.0', '')).toBe('v25.0');
  });

  test('a malformed env value is ignored in favour of the persisted snapshot', () => {
    expect(resolve('v25.0', '25.0')).toBe('v25.0');
    expect(resolve('v25.0', 'v25')).toBe('v25.0');
    expect(resolve('v25.0', 'latest')).toBe('v25.0');
  });

  test('nothing valid anywhere leaves the key unset so the plugin default applies', () => {
    expect(resolve(null, '')).toBeUndefined();
    expect(resolve(undefined, undefined)).toBeUndefined();
  });
});
