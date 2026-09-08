/**
 * Unit tests for output-redactor middleware.
 *
 * Covers:
 *   - compilePatterns / parsePresetMap pure helpers
 *   - resolvePresetKey + resolvePatternsForKey for every profile
 *   - redactBodyInPlace across string, nested object, array, non-plain object
 *   - Admin bypass and legacy-key no-op
 *   - Middleware end-to-end: body mutation + secret.redacted event emission
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { ApiKeyData, AppVariables } from '../../types';
import {
  type CompiledPattern,
  REDACTION_MARKER,
  compilePatterns,
  hashPattern,
  outputRedactorMiddleware,
  parsePresetMap,
  redactBodyInPlace,
  resetPresetRegistryForTests,
  resolvePatternsForKey,
  resolvePresetKey,
  setPresetRegistryForTests,
} from '../output-redactor';

function mkKey(overrides: Partial<ApiKeyData> = {}): ApiKeyData {
  return {
    id: 'k-1',
    name: 'test',
    scopes: ['*'],
    instanceIds: null,
    expiresAt: null,
    profile: null,
    chatAllowlist: [],
    instanceAllowlist: [],
    outboundRecipientAllowlist: [],
    profileOverrides: null,
    ...overrides,
  };
}

afterEach(() => {
  resetPresetRegistryForTests();
});

describe('compilePatterns', () => {
  test('escapes regex metachars and compiles case-insensitively', () => {
    const compiled = compilePatterns(['foo.bar+baz']);
    const p = compiled[0]!;
    expect(p.regex.test('FOO.BAR+BAZ')).toBe(true);
    // Make sure `.` is literal, not a wildcard
    expect(p.regex.test('fooXbar+baz')).toBe(false);
  });

  test('skips empty / non-string entries without throwing', () => {
    const compiled = compilePatterns(['', 'valid', null as unknown as string, undefined as unknown as string]);
    expect(compiled.length).toBe(1);
    expect(compiled[0]!.source).toBe('valid');
  });
});

describe('parsePresetMap', () => {
  test('parses a well-formed JSON object', () => {
    const m = parsePresetMap('{"khal-os-core":["secret-a","secret-b"]}');
    expect(m.has('khal-os-core')).toBe(true);
    expect(m.get('khal-os-core')?.length).toBe(2);
  });

  test('returns empty map for null / empty / malformed input', () => {
    expect(parsePresetMap(null).size).toBe(0);
    expect(parsePresetMap('').size).toBe(0);
    expect(parsePresetMap('not json').size).toBe(0);
    expect(parsePresetMap('[1,2,3]').size).toBe(0);
  });

  test('ignores non-array preset values', () => {
    const m = parsePresetMap('{"broken":"string","good":["p1"]}');
    expect(m.has('broken')).toBe(false);
    expect(m.get('good')?.length).toBe(1);
  });
});

describe('resolvePresetKey', () => {
  test('legacy (profile=null) key → null', () => {
    expect(resolvePresetKey(mkKey({ profile: null }))).toBe(null);
  });

  test('admin profile → null (bypass)', () => {
    expect(resolvePresetKey(mkKey({ profile: 'admin' }))).toBe(null);
  });

  test('coworker profile with no overrides → khal-os-core default', () => {
    expect(resolvePresetKey(mkKey({ profile: 'coworker' }))).toBe('khal-os-core');
  });

  test('coworker with tenant override wins', () => {
    const key = mkKey({
      profile: 'coworker',
      profileOverrides: { denylistPresetKey: 'tenant-custom' },
    });
    expect(resolvePresetKey(key)).toBe('tenant-custom');
  });

  test('cs / personal / scout have no default preset', () => {
    expect(resolvePresetKey(mkKey({ profile: 'cs' }))).toBe(null);
    expect(resolvePresetKey(mkKey({ profile: 'personal' }))).toBe(null);
    expect(resolvePresetKey(mkKey({ profile: 'scout' }))).toBe(null);
  });
});

describe('resolvePatternsForKey', () => {
  beforeEach(() => {
    const registry = new Map<string, CompiledPattern[]>();
    registry.set('khal-os-core', compilePatterns(['khal-secret', 'internal-token']));
    setPresetRegistryForTests(registry);
  });

  test('legacy key → empty list', () => {
    expect(resolvePatternsForKey(mkKey({ profile: null })).length).toBe(0);
  });

  test('admin → empty list (bypass)', () => {
    expect(resolvePatternsForKey(mkKey({ profile: 'admin' })).length).toBe(0);
  });

  test('coworker with default preset → preset patterns', () => {
    const patterns = resolvePatternsForKey(mkKey({ profile: 'coworker' }));
    expect(patterns.length).toBe(2);
  });

  test('coworker + denylistExtras → preset + extras', () => {
    const patterns = resolvePatternsForKey(
      mkKey({
        profile: 'coworker',
        profileOverrides: { denylistExtras: ['tenant-extra-1', 'tenant-extra-2'] },
      }),
    );
    expect(patterns.length).toBe(4);
    expect(patterns.map((p) => p.source)).toContain('tenant-extra-1');
  });

  test('cs profile with extras only (no preset) → extras', () => {
    const patterns = resolvePatternsForKey(
      mkKey({
        profile: 'cs',
        profileOverrides: { denylistExtras: ['only-extra'] },
      }),
    );
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.source).toBe('only-extra');
  });

  test('unknown preset key → empty list (no throw)', () => {
    const patterns = resolvePatternsForKey(
      mkKey({
        profile: 'coworker',
        profileOverrides: { denylistPresetKey: 'does-not-exist' },
      }),
    );
    expect(patterns.length).toBe(0);
  });
});

describe('redactBodyInPlace', () => {
  const patterns = compilePatterns(['alpha', 'beta']);

  test('redacts matched substrings in top-level strings', () => {
    const body = { text: 'hello alpha world', other: 'beta here' };
    const hits = redactBodyInPlace(body, patterns);
    expect(body.text).toBe(`hello ${REDACTION_MARKER} world`);
    expect(body.other).toBe(`${REDACTION_MARKER} here`);
    expect(hits.length).toBe(2);
  });

  test('recurses into nested objects and arrays', () => {
    const body = {
      top: 'clean',
      nested: { caption: 'has alpha secret' },
      items: ['beta-prefix', 'safe'],
    };
    const hits = redactBodyInPlace(body, patterns);
    expect(body.nested.caption).toBe(`has ${REDACTION_MARKER} secret`);
    expect(body.items[0]).toBe(`${REDACTION_MARKER}-prefix`);
    expect(body.items[1]).toBe('safe');
    expect(hits.length).toBe(2);
  });

  test('is case-insensitive', () => {
    const body = { text: 'ALPHA is here' };
    redactBodyInPlace(body, patterns);
    expect(body.text).toBe(`${REDACTION_MARKER} is here`);
  });

  test('aggregates multiple matches per pattern per field', () => {
    const body = { text: 'alpha alpha alpha' };
    const hits = redactBodyInPlace(body, patterns);
    const alphaHit = hits.find((h) => h.pattern === 'alpha' && h.field === 'text');
    expect(alphaHit?.count).toBe(3);
  });

  test('empty pattern list is a no-op', () => {
    const body = { text: 'alpha' };
    const hits = redactBodyInPlace(body, []);
    expect(body.text).toBe('alpha');
    expect(hits.length).toBe(0);
  });

  test('returns empty hit list when nothing matches', () => {
    const body = { text: 'nothing sensitive' };
    const hits = redactBodyInPlace(body, patterns);
    expect(hits.length).toBe(0);
  });

  test('preserves non-plain objects (Date) without traversing', () => {
    const body = { text: 'alpha', when: new Date(0) };
    redactBodyInPlace(body, patterns);
    expect(body.text).toBe(REDACTION_MARKER);
    expect(body.when).toBeInstanceOf(Date);
  });
});

// ==============================================================
// Middleware integration — runs through a Hono stack to verify
// body mutation + event emission.
// ==============================================================

type MockEventCall = { type: string; payload: Record<string, unknown> };

function mkEventBusMock() {
  const calls: MockEventCall[] = [];
  const publishGeneric = mock(async (type: string, payload: Record<string, unknown>) => {
    calls.push({ type, payload });
    return { id: 'evt', sequence: 0, stream: 'omni' };
  });
  return { calls, bus: { publishGeneric } };
}

function mkApp(apiKey: ApiKeyData, eventBus: { publishGeneric: ReturnType<typeof mock> } | null) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', apiKey);
    c.set('eventBus', eventBus as unknown as AppVariables['eventBus']);
    c.set('requestId', 'req-1');
    return next();
  });
  app.use('*', outputRedactorMiddleware);
  app.post('/api/v2/messages/send', async (c) => {
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await c.req.json();
      return c.json({ received: body });
    }
    return c.json({ received: null, raw: await c.req.text() });
  });
  app.post('/api/v2/chats', async (c) => {
    const body = await c.req.json();
    return c.json({ received: body });
  });
  return app;
}

describe('outputRedactorMiddleware (HTTP)', () => {
  beforeEach(() => {
    const registry = new Map<string, CompiledPattern[]>();
    registry.set('khal-os-core', compilePatterns(['khal-secret']));
    setPresetRegistryForTests(registry);
  });

  test('coworker: redacts body AND emits secret.redacted', async () => {
    const { calls, bus } = mkEventBusMock();
    const apiKey = mkKey({ profile: 'coworker' });
    const app = mkApp(apiKey, bus);

    const res = await app.request('/api/v2/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'i-1', to: 'j@s', text: 'leak khal-secret please' }),
    });
    const json = (await res.json()) as { received: { text: string } };
    expect(json.received.text).toBe(`leak ${REDACTION_MARKER} please`);
    expect(calls.length).toBe(1);
    expect(calls[0]!.type).toBe('secret.redacted');
    expect(calls[0]!.payload).toMatchObject({
      keyId: 'k-1',
      profile: 'coworker',
      presetKey: 'khal-os-core',
      patternHash: hashPattern('khal-secret'),
      field: 'text',
      count: 1,
    });
    // Defence-in-depth: the literal pattern MUST NOT appear in the event payload.
    expect((calls[0]!.payload as Record<string, unknown>).pattern).toBeUndefined();
    expect(JSON.stringify(calls[0]!.payload)).not.toContain('khal-secret');
  });

  test('admin profile: bypasses redactor (body untouched, no event)', async () => {
    const { calls, bus } = mkEventBusMock();
    const apiKey = mkKey({ profile: 'admin' });
    const app = mkApp(apiKey, bus);

    const res = await app.request('/api/v2/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'i-1', to: 'j@s', text: 'khal-secret stays' }),
    });
    const json = (await res.json()) as { received: { text: string } };
    expect(json.received.text).toBe('khal-secret stays');
    expect(calls.length).toBe(0);
  });

  test('legacy (profile=null) key: redactor is no-op', async () => {
    const { calls, bus } = mkEventBusMock();
    const apiKey = mkKey({ profile: null });
    const app = mkApp(apiKey, bus);

    const res = await app.request('/api/v2/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'khal-secret' }),
    });
    const json = (await res.json()) as { received: { text: string } };
    expect(json.received.text).toBe('khal-secret');
    expect(calls.length).toBe(0);
  });

  test('non-send route: redactor is no-op even for coworker', async () => {
    const { calls, bus } = mkEventBusMock();
    const apiKey = mkKey({ profile: 'coworker' });
    const app = mkApp(apiKey, bus);

    const res = await app.request('/api/v2/chats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'khal-secret' }),
    });
    const json = (await res.json()) as { received: { text: string } };
    expect(json.received.text).toBe('khal-secret');
    expect(calls.length).toBe(0);
  });

  test('denylistExtras merge with preset and both trigger events', async () => {
    const { calls, bus } = mkEventBusMock();
    const apiKey = mkKey({
      profile: 'coworker',
      profileOverrides: { denylistExtras: ['extra-word'] },
    });
    const app = mkApp(apiKey, bus);

    const res = await app.request('/api/v2/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'khal-secret and extra-word here' }),
    });
    const json = (await res.json()) as { received: { text: string } };
    expect(json.received.text).toBe(`${REDACTION_MARKER} and ${REDACTION_MARKER} here`);
    const hashes = calls.map((c) => c.payload.patternHash).sort();
    expect(hashes).toEqual([hashPattern('extra-word'), hashPattern('khal-secret')].sort());
    // No literal pattern source should appear in emitted payloads.
    for (const call of calls) {
      expect(JSON.stringify(call.payload)).not.toContain('khal-secret');
      expect(JSON.stringify(call.payload)).not.toContain('extra-word');
    }
  });

  test('non-JSON body: middleware passes through unchanged', async () => {
    const { bus } = mkEventBusMock();
    const apiKey = mkKey({ profile: 'coworker' });
    const app = mkApp(apiKey, bus);

    const res = await app.request('/api/v2/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'plain khal-secret body',
    });
    expect(res.status).toBe(200);
  });
});
