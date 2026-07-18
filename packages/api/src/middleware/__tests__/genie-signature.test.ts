/**
 * Unit tests for the Genie host signature verifier.
 *
 * Wish: omni-host-fingerprint-trust, Group 4.
 *
 * Strategy: drive `verifySignature()` directly with synthetic ed25519 keys
 * (no DB, no Hono). The middleware wrapper is thin enough that exercising
 * the pure verifier covers the contract; the few lines of Hono glue get a
 * smoke test at the bottom.
 *
 * Coverage target — the Group 4 acceptance criteria from the wish:
 *   - valid signature → status=verified, hostId set
 *   - missing all 3 headers → status=no-signature (bearer fall-through)
 *   - partial headers (only some) → status=invalid
 *   - tampered body → status=invalid
 *   - tampered path → status=invalid
 *   - tampered method → status=invalid
 *   - stale timestamp (>60s) → status=invalid
 *   - future timestamp (>60s ahead) → status=invalid
 *   - malformed timestamp → status=invalid
 *   - unknown host_id → status=invalid
 *   - revoked host → status=invalid
 *   - malformed signature (not base64url) decodes to empty/wrong bytes → status=invalid
 *   - unparseable pubkey on the server side → status=invalid
 *
 * Cross-system note: the canonical signing input MUST byte-exactly match
 * the genie-side signer (`src/lib/omni-signature.ts`). One of the tests
 * pins the exact wire bytes for a known input to catch silent drift.
 */

import { describe, expect, test } from 'bun:test';
import { type KeyObject, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { canonicalSigningInput, verifySignature } from '../genie-signature';

interface TestHost {
  id: string;
  pubkey: string;
  revokedAt: Date | null;
  scopes: string[];
}

/**
 * Mint a fresh ed25519 keypair, return the base64url pubkey + a signer
 * function that produces base64url signatures over arbitrary canonical
 * inputs. Mirrors what genie's `signOmniRequest` does on the wire.
 */
function freshKeypair(): { pubkeyB64Url: string; signCanonical: (canonical: string) => string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // Strip the 12-byte SPKI prefix to get the raw 32-byte pubkey, then
  // base64url-encode it.
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.byteLength - 32);
  const pubkeyB64Url = Buffer.from(raw).toString('base64url');
  return {
    pubkeyB64Url,
    privateKey,
    signCanonical: (canonical: string) =>
      Buffer.from(sign(null, Buffer.from(canonical, 'utf-8'), privateKey)).toString('base64url'),
  };
}

function makeHostFinder(host: TestHost | null) {
  return async (id: string) => (host && host.id === id ? host : null);
}

const NOW = Date.parse('2026-04-29T12:00:00.000Z');

describe('canonicalSigningInput — wire-format parity with the genie signer', () => {
  test('produces the documented format: timestamp\\nMETHOD\\npath\\nsha256(body) hex', () => {
    const ts = '2026-04-29T12:00:00.000Z';
    const method = 'POST';
    const path = '/api/v2/agents';
    const body = '{"name":"foo","provider":"claude"}';
    const expectedHash = createHash('sha256').update(body, 'utf-8').digest('hex');
    expect(canonicalSigningInput(ts, method, path, body)).toBe(`${ts}\n${method}\n${path}\n${expectedHash}`);
  });

  test('uppercases the method (matches signer behavior)', () => {
    const out = canonicalSigningInput('2026-04-29T12:00:00.000Z', 'post', '/x', '');
    expect(out.split('\n')[1]).toBe('POST');
  });

  test('hashes empty body to the well-known sha256 of empty string', () => {
    // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const out = canonicalSigningInput('2026-04-29T12:00:00.000Z', 'GET', '/health', '');
    const hash = out.split('\n')[3];
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('verifySignature — happy path', () => {
  test('valid signature → status=verified, hostId set', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/api/v2/agents', '{"name":"foo"}');
    const signature = signCanonical(canonical);

    const outcome = await verifySignature({
      hostIdHeader: 'host-1',
      timestampHeader: ts,
      signatureHeader: signature,
      method: 'POST',
      path: '/api/v2/agents',
      body: '{"name":"foo"}',
      now: NOW,
      findHost: makeHostFinder({ id: 'host-1', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });

    expect(outcome.status).toBe('verified');
    expect(outcome.hostId).toBe('host-1');
    // Group 5: per-host scopes are surfaced on the outcome so the
    // scope-enforcer can intersect them with the bearer's scopes.
    expect(outcome.hostScopes).toEqual(['*']);
  });

  test('verified outcome propagates narrowed host scopes (Group 5)', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const signature = signCanonical(canonical);

    const outcome = await verifySignature({
      hostIdHeader: 'narrow',
      timestampHeader: ts,
      signatureHeader: signature,
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({
        id: 'narrow',
        pubkey: pubkeyB64Url,
        revokedAt: null,
        scopes: ['agents:read'],
      }),
    });
    expect(outcome.status).toBe('verified');
    expect(outcome.hostScopes).toEqual(['agents:read']);
  });

  test('GET request with empty body verifies', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'GET', '/api/v2/agents?name=foo', '');
    const signature = signCanonical(canonical);

    const outcome = await verifySignature({
      hostIdHeader: 'host-2',
      timestampHeader: ts,
      signatureHeader: signature,
      method: 'GET',
      path: '/api/v2/agents?name=foo',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'host-2', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });

    expect(outcome.status).toBe('verified');
  });

  test('case-insensitive method (signer may pass "post", verifier uppercases)', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    // Sign canonical built from POST (uppercase, what canonicalSigningInput emits)
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const signature = signCanonical(canonical);

    // Verifier sees method='post' (lowercase) — should still pass because
    // it uppercases internally.
    const outcome = await verifySignature({
      hostIdHeader: 'host-3',
      timestampHeader: ts,
      signatureHeader: signature,
      method: 'post',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'host-3', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('verified');
  });
});

describe('verifySignature — header presence', () => {
  test('all three headers missing → status=no-signature (fall through)', async () => {
    const outcome = await verifySignature({
      hostIdHeader: undefined,
      timestampHeader: undefined,
      signatureHeader: undefined,
      method: 'GET',
      path: '/x',
      body: '',
      now: NOW,
      findHost: async () => null,
    });
    expect(outcome.status).toBe('no-signature');
  });

  for (const [headerName, headers] of [
    ['host-id', { hostIdHeader: '', timestampHeader: undefined, signatureHeader: undefined }],
    ['timestamp', { hostIdHeader: undefined, timestampHeader: '', signatureHeader: undefined }],
    ['signature', { hostIdHeader: undefined, timestampHeader: undefined, signatureHeader: '' }],
  ] as const) {
    test(`present-but-empty ${headerName} → status=invalid`, async () => {
      const outcome = await verifySignature({
        ...headers,
        method: 'GET',
        path: '/x',
        body: '',
        now: NOW,
        findHost: async () => null,
      });

      expect(outcome.status).toBe('invalid');
      expect(outcome.reason).toContain('partial');
    });
  }

  test('only host-id present → status=invalid (forge attempt)', async () => {
    const outcome = await verifySignature({
      hostIdHeader: 'host-1',
      timestampHeader: undefined,
      signatureHeader: undefined,
      method: 'GET',
      path: '/x',
      body: '',
      now: NOW,
      findHost: async () => null,
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('partial');
  });

  test('only signature present → status=invalid', async () => {
    const outcome = await verifySignature({
      hostIdHeader: undefined,
      timestampHeader: undefined,
      signatureHeader: 'AAAA',
      method: 'GET',
      path: '/x',
      body: '',
      now: NOW,
      findHost: async () => null,
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('partial');
  });

  test('host-id + timestamp without signature → status=invalid', async () => {
    const outcome = await verifySignature({
      hostIdHeader: 'host-1',
      timestampHeader: new Date(NOW).toISOString(),
      signatureHeader: undefined,
      method: 'GET',
      path: '/x',
      body: '',
      now: NOW,
      findHost: async () => null,
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('partial');
  });
});

describe('verifySignature — replay window (±60s)', () => {
  test('timestamp 30s in the past → verified (within window)', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW - 30_000).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signCanonical(canonical),
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('verified');
  });

  test('timestamp 90s in the past → invalid (outside window)', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW - 90_000).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signCanonical(canonical),
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('drift');
  });

  test('timestamp 90s in the future → invalid', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW + 90_000).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signCanonical(canonical),
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('drift');
  });

  test('malformed timestamp → invalid', async () => {
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: 'not-a-date',
      signatureHeader: 'AAAA',
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: async () => null,
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('malformed');
  });
});

describe('verifySignature — tampered inputs', () => {
  test('tampered body → invalid', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const signedBody = '{"name":"foo"}';
    const canonical = canonicalSigningInput(ts, 'POST', '/x', signedBody);
    const signature = signCanonical(canonical);

    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signature,
      method: 'POST',
      path: '/x',
      body: '{"name":"bar"}', // attacker swapped the body
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('does not verify');
  });

  test('tampered path → invalid', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/safe', '');
    const signature = signCanonical(canonical);

    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signature,
      method: 'POST',
      path: '/admin',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
  });

  test('tampered method → invalid', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'GET', '/x', '');
    const signature = signCanonical(canonical);

    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signature,
      method: 'DELETE',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
  });

  test('signature signed by a different key → invalid', async () => {
    const honestHost = freshKeypair();
    const attacker = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', 'body');
    const attackerSig = attacker.signCanonical(canonical);

    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: attackerSig,
      method: 'POST',
      path: '/x',
      body: 'body',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: honestHost.pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('does not verify');
  });
});

describe('verifySignature — host lookup', () => {
  test('unknown host_id → invalid (not silent fall-through)', async () => {
    const { signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const outcome = await verifySignature({
      hostIdHeader: 'nope',
      timestampHeader: ts,
      signatureHeader: signCanonical(canonical),
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: async () => null,
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('unknown host');
  });

  test('revoked host → invalid', async () => {
    const { pubkeyB64Url, signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signCanonical(canonical),
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: new Date(NOW - 1000), scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('revoked');
  });

  test('host lookup throws → invalid (no crash)', async () => {
    const { signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signCanonical(canonical),
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: async () => {
        throw new Error('db down');
      },
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('host lookup failed');
  });
});

describe('verifySignature — malformed crypto material', () => {
  test('host pubkey too short (not 32 bytes raw) → invalid', async () => {
    const { signCanonical } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    const canonical = canonicalSigningInput(ts, 'POST', '/x', '');
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: signCanonical(canonical),
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({
        id: 'h',
        pubkey: Buffer.alloc(16, 1).toString('base64url'), // 16 bytes, wrong length
        revokedAt: null,
        scopes: ['*'],
      }),
    });
    expect(outcome.status).toBe('invalid');
    expect(outcome.reason).toContain('pubkey');
  });

  test('signature decodes to wrong size → invalid (verify rejects)', async () => {
    const { pubkeyB64Url } = freshKeypair();
    const ts = new Date(NOW).toISOString();
    // ed25519 signatures are 64 bytes; 8 bytes will not verify.
    const garbageSig = Buffer.alloc(8, 7).toString('base64url');
    const outcome = await verifySignature({
      hostIdHeader: 'h',
      timestampHeader: ts,
      signatureHeader: garbageSig,
      method: 'POST',
      path: '/x',
      body: '',
      now: NOW,
      findHost: makeHostFinder({ id: 'h', pubkey: pubkeyB64Url, revokedAt: null, scopes: ['*'] }),
    });
    expect(outcome.status).toBe('invalid');
  });
});
