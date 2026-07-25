/**
 * Regression tests for the voice WebSocket upgrade auth decision.
 *
 * BUG BEING FIXED: the upgrade handler awaited `ApiKeyService.validate(apiKey)`
 * inside a try/catch and refused only when the call THREW. But `validate` is
 * typed `Promise<ValidatedApiKey | null>` and *returns null* — it does not throw
 * — for an unknown, malformed, expired, or revoked key. An unrecognised key
 * therefore reached the voice WebSocket and streamed audio. The whole check was
 * additionally wrapped in `if (globalDbRef)`, so a process with no database ref
 * skipped authentication entirely.
 *
 * These tests pin the refusal contract: only a key that RESOLVES to a live
 * credential is admitted. Everything else refuses.
 */

import { describe, expect, test } from 'bun:test';
import { authorizeVoiceApiKey } from '../ws/voice';

describe('authorizeVoiceApiKey', () => {
  test('admits a key that resolves to a live credential', async () => {
    const validate = async () => ({ id: 'key-1', name: 'primary', scopes: ['voice'] });
    expect(await authorizeVoiceApiKey(validate, 'omni_sk_live')).toBe(true);
  });

  test('REFUSES a key that resolves to null (the original bug — unknown/expired/revoked)', async () => {
    const validate = async () => null;
    expect(await authorizeVoiceApiKey(validate, 'omni_sk_unknown')).toBe(false);
  });

  test('REFUSES when there is no database to consult (validate absent)', async () => {
    expect(await authorizeVoiceApiKey(null, 'omni_sk_live')).toBe(false);
  });

  test('refuses when the credential lookup throws', async () => {
    const validate = async () => {
      throw new Error('auth store unreachable');
    };
    expect(await authorizeVoiceApiKey(validate, 'omni_sk_live')).toBe(false);
  });

  test('refuses a malformed key — validate returns null on bad prefix, it does not throw', async () => {
    // Mirrors ApiKeyService.validate's real contract: a key without the
    // `omni_sk_` prefix short-circuits to null before any hashing or lookup.
    const validate = async (apiKey: string) => (apiKey.startsWith('omni_sk_') ? { id: 'key-1' } : null);
    expect(await authorizeVoiceApiKey(validate, 'not-a-real-key')).toBe(false);
    expect(await authorizeVoiceApiKey(validate, 'omni_sk_good')).toBe(true);
  });

  test('passes the api key through unmodified to the validator', async () => {
    const seen: string[] = [];
    const validate = async (apiKey: string) => {
      seen.push(apiKey);
      return { id: 'key-1' };
    };
    await authorizeVoiceApiKey(validate, 'omni_sk_exact_value');
    expect(seen).toEqual(['omni_sk_exact_value']);
  });
});
