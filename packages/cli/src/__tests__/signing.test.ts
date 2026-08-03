/**
 * Unit tests for the operator-host signing helper.
 *
 * Wish: omni-host-fingerprint-trust, P0b follow-up.
 *
 * Strategy: drive the pure crypto path with synthetic ed25519 keys (no
 * filesystem) AND drive the load/store path with a temp OMNI_CONFIG_DIR
 * to lock down the file layout.
 *
 * Critical property under test: the canonical signing input MUST byte-
 * exactly match the genie signer (`genie/src/lib/omni-signature.ts`)
 * and the omni verifier
 * (`omni/packages/api/src/middleware/genie-signature.ts`). Drift breaks
 * every signed request, so we pin one known-input → known-canonical-bytes
 * test that mirrors the verifier-side assertion.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type KeyObject, createHash, verify as edVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _paths,
  canonicalSigningInput,
  generateAndStoreKeypair,
  loadHostMetadata,
  loadSigningContext,
  loadSigningContextForServer,
  signRequest,
  writeHostMetadata,
} from '../signing';

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'omni-signing-test-'));
  process.env.OMNI_CONFIG_DIR = tmpHome;
});

afterEach(() => {
  process.env.OMNI_CONFIG_DIR = undefined;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('canonicalSigningInput — wire-format parity', () => {
  test('format: <ts>\\n<METHOD>\\n<path>\\n<sha256(body) hex>', () => {
    const ts = '2026-04-30T12:00:00.000Z';
    const method = 'POST';
    const path = '/api/v2/instances/abc';
    const body = '{"name":"foo"}';
    const expectedHash = createHash('sha256').update(body, 'utf-8').digest('hex');
    expect(canonicalSigningInput(ts, method, path, body)).toBe(`${ts}\n${method}\n${path}\n${expectedHash}`);
  });

  test('uppercases method (matches verifier behavior)', () => {
    const out = canonicalSigningInput('2026-04-30T12:00:00.000Z', 'patch', '/x', '');
    expect(out.split('\n')[1]).toBe('PATCH');
  });

  test('empty body sha256 is the well-known constant', () => {
    // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    // Both signer and verifier rely on this. If your locale changes the
    // empty string's encoding, you have bigger problems.
    const out = canonicalSigningInput('2026-04-30T12:00:00.000Z', 'GET', '/health', '');
    expect(out.split('\n')[3]).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('signRequest — pure ed25519 sign', () => {
  function freshKeypair(): { pubKey: KeyObject; privKey: KeyObject } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { pubKey: publicKey, privKey: privateKey };
  }

  test('produces base64url-encoded signature that ed25519-verifies under the matching pubkey', () => {
    const { pubKey, privKey } = freshKeypair();
    const headers = signRequest({
      hostId: 'host-uuid',
      privateKey: privKey,
      method: 'POST',
      path: '/api/v2/agents',
      body: '{"name":"foo"}',
      now: new Date('2026-04-30T12:00:00.000Z'),
    });
    expect(headers['X-Genie-Host-Id']).toBe('host-uuid');
    expect(headers['X-Genie-Timestamp']).toBe('2026-04-30T12:00:00.000Z');

    const canonical = canonicalSigningInput(headers['X-Genie-Timestamp'], 'POST', '/api/v2/agents', '{"name":"foo"}');
    const sigBytes = Buffer.from(headers['X-Genie-Signature'], 'base64url');
    expect(edVerify(null, Buffer.from(canonical, 'utf-8'), pubKey, sigBytes)).toBe(true);
  });

  test('signing the same input twice with the same `now` yields the same signature (ed25519 is deterministic)', () => {
    const { privKey } = freshKeypair();
    const args = {
      hostId: 'h',
      privateKey: privKey,
      method: 'GET',
      path: '/health',
      body: '',
      now: new Date('2026-04-30T12:00:00.000Z'),
    };
    const a = signRequest(args);
    const b = signRequest(args);
    expect(a['X-Genie-Signature']).toBe(b['X-Genie-Signature']);
  });

  test('different `now` → different signature (different canonical input)', () => {
    const { privKey } = freshKeypair();
    const a = signRequest({
      hostId: 'h',
      privateKey: privKey,
      method: 'GET',
      path: '/health',
      body: '',
      now: new Date('2026-04-30T12:00:00.000Z'),
    });
    const b = signRequest({
      hostId: 'h',
      privateKey: privKey,
      method: 'GET',
      path: '/health',
      body: '',
      now: new Date('2026-04-30T12:00:01.000Z'),
    });
    expect(a['X-Genie-Signature']).not.toBe(b['X-Genie-Signature']);
  });
});

describe('generateAndStoreKeypair → loadSigningContext round-trip', () => {
  test('store, write metadata, then load and use to sign', () => {
    const { pubkeyB64Url, privateKey } = generateAndStoreKeypair();
    expect(existsSync(_paths.privateKey())).toBe(true);
    expect(existsSync(_paths.publicKey())).toBe(true);
    // pubkey file matches the returned base64url string
    expect(readFileSync(_paths.publicKey(), 'utf-8')).toBe(pubkeyB64Url);

    writeHostMetadata({
      hostId: 'host-from-handshake',
      pubkey: pubkeyB64Url,
      hostname: 'test-machine',
      registeredAt: '2026-04-30T12:00:00.000Z',
    });
    expect(existsSync(_paths.hostJson())).toBe(true);

    const ctx = loadSigningContext();
    expect(ctx).not.toBeNull();
    if (!ctx) throw new Error('unreachable');
    expect(ctx.hostId).toBe('host-from-handshake');

    // Sign with the loaded context, verify under a pubkey derived from
    // the persisted private key (the same KeyObject we just stored). If
    // the signing didn't round-trip through PEM cleanly, this verify
    // would fail.
    const headers = ctx.signRequest('POST', '/api/v2/agents', '{"name":"foo"}');
    const canonical = canonicalSigningInput(headers['X-Genie-Timestamp'], 'POST', '/api/v2/agents', '{"name":"foo"}');
    const sigBytes = Buffer.from(headers['X-Genie-Signature'], 'base64url');
    const derivedPub = require('node:crypto').createPublicKey(privateKey);
    expect(edVerify(null, Buffer.from(canonical, 'utf-8'), derivedPub, sigBytes)).toBe(true);
  });

  test('loadSigningContext returns null when no host.json exists', () => {
    expect(loadSigningContext()).toBeNull();
  });

  test('loadSigningContext returns null when private key file is missing even if host.json exists', () => {
    writeHostMetadata({
      hostId: 'half-baked',
      pubkey: 'AAAA',
      hostname: 'partial',
      registeredAt: '2026-04-30T12:00:00.000Z',
    });
    expect(loadSigningContext()).toBeNull();
  });

  test('per-server bindings sign with the id THAT server issued', () => {
    const { pubkeyB64Url } = generateAndStoreKeypair();
    writeHostMetadata({
      hostId: 'id-from-a',
      pubkey: pubkeyB64Url,
      hostname: 'test-machine',
      registeredAt: '2026-04-30T12:00:00.000Z',
      boundServers: [
        { url: 'https://a.example.com', hostId: 'id-from-a' },
        { url: 'https://b.example.com', hostId: 'id-from-b' },
      ],
    });

    expect(loadSigningContextForServer('https://a.example.com')?.hostId).toBe('id-from-a');
    // Trailing slash is normalized away before the lookup.
    expect(loadSigningContextForServer('https://b.example.com/')?.hostId).toBe('id-from-b');
    // Unbound server → unsigned.
    expect(loadSigningContextForServer('https://c.example.com')).toBeNull();
  });

  test('legacy string[] boundServers coerce to the top-level hostId', () => {
    const { pubkeyB64Url } = generateAndStoreKeypair();
    require('node:fs').writeFileSync(
      _paths.hostJson(),
      JSON.stringify({
        hostId: 'legacy-id',
        pubkey: pubkeyB64Url,
        hostname: 'test-machine',
        registeredAt: '2026-04-30T12:00:00.000Z',
        boundServers: ['https://a.example.com/', 'https://b.example.com'],
      }),
    );

    expect(loadHostMetadata()?.boundServers).toEqual([
      { url: 'https://a.example.com', hostId: 'legacy-id' },
      { url: 'https://b.example.com', hostId: 'legacy-id' },
    ]);
    expect(loadSigningContextForServer('https://b.example.com')?.hostId).toBe('legacy-id');
  });

  test('absent boundServers coerce to the local default URL', () => {
    const { pubkeyB64Url } = generateAndStoreKeypair();
    writeHostMetadata({
      hostId: 'legacy-id',
      pubkey: pubkeyB64Url,
      hostname: 'test-machine',
      registeredAt: '2026-04-30T12:00:00.000Z',
    });

    expect(loadHostMetadata()?.boundServers).toEqual([{ url: 'http://localhost:8882', hostId: 'legacy-id' }]);
    expect(loadSigningContextForServer('http://localhost:8882')?.hostId).toBe('legacy-id');
    expect(loadSigningContextForServer('https://remote.example.com')).toBeNull();
  });

  test('private key file gets 0600 perms (no group/other read)', () => {
    generateAndStoreKeypair();
    const stat = require('node:fs').statSync(_paths.privateKey());
    // Mask out the file-type bits, keep just permission bits.
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
