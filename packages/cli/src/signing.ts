/**
 * Operator-host signing for the omni CLI.
 *
 * Wish: omni-host-fingerprint-trust, P0b follow-up.
 *
 * The genie host signs every API call out of the box (genie#1539). The
 * `omni` CLI itself was bearer-only — which created the lockout footgun
 * that the P0a hotfix (#568) closed via a kill-switch unlock PATCH. P0b
 * removes the underlying problem: when an operator runs
 * `omni trust handshake`, the CLI mints its own ed25519 keypair, registers
 * it with omni as a host, and from then on signs every request the
 * cached SDK client (or the trust.ts raw-fetch path) makes.
 *
 * Key files (default location, override via OMNI_CONFIG_DIR):
 *   ~/.omni/keys/omni-cli.ed25519        ← private (perms 0600)
 *   ~/.omni/keys/omni-cli.ed25519.pub    ← public (32 bytes raw)
 *   ~/.omni/keys/host.json               ← { hostId, pubkey, hostname,
 *                                            registeredAt }
 *
 * The wire format MUST byte-exactly match
 * `genie/src/lib/omni-signature.ts:canonicalSigningInput()` and
 * `omni/packages/api/src/middleware/genie-signature.ts:canonicalSigningInput()`.
 * See those files for the full spec.
 */

import { type KeyObject, createHash, createPrivateKey, sign as edSign, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

const KEY_FILENAME_PRIV = 'omni-cli.ed25519';
const KEY_FILENAME_PUB = 'omni-cli.ed25519.pub';
const HOST_JSON_FILENAME = 'host.json';

export interface OmniHostMetadata {
  hostId: string;
  pubkey: string;
  hostname: string;
  registeredAt: string;
}

export interface SigningHeaders {
  'X-Genie-Host-Id': string;
  'X-Genie-Timestamp': string;
  'X-Genie-Signature': string;
}

export interface SigningContext {
  hostId: string;
  signRequest(method: string, path: string, body: string): SigningHeaders;
}

/** Path to the directory holding the operator's keypair + host metadata. */
function getKeysDir(): string {
  return join(getConfigDir(), 'keys');
}

function privateKeyPath(): string {
  return join(getKeysDir(), KEY_FILENAME_PRIV);
}

function publicKeyPath(): string {
  return join(getKeysDir(), KEY_FILENAME_PUB);
}

function hostJsonPath(): string {
  return join(getKeysDir(), HOST_JSON_FILENAME);
}

/**
 * Build the canonical signing input.
 *
 * Format MUST byte-exactly match the genie signer and omni verifier.
 * Drift here breaks every signed request.
 *
 *   canonical = <iso8601-ts>\n<METHOD>\n<path>\n<sha256(body) hex>
 */
export function canonicalSigningInput(timestamp: string, method: string, path: string, body: string): string {
  const bodyHash = createHash('sha256').update(body, 'utf-8').digest('hex');
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
}

/**
 * Sign a request given the host's loaded private key. Pure function — no
 * filesystem access, deterministic for a given input + key + timestamp.
 *
 * Exported for direct use in tests; production callers should go through
 * `loadSigningContext()` which handles the filesystem layer.
 */
export function signRequest(opts: {
  hostId: string;
  privateKey: KeyObject;
  method: string;
  path: string;
  body: string;
  now?: Date;
}): SigningHeaders {
  const timestamp = (opts.now ?? new Date()).toISOString();
  const canonical = canonicalSigningInput(timestamp, opts.method, opts.path, opts.body);
  const sigBytes = edSign(null, Buffer.from(canonical, 'utf-8'), opts.privateKey);
  return {
    'X-Genie-Host-Id': opts.hostId,
    'X-Genie-Timestamp': timestamp,
    'X-Genie-Signature': Buffer.from(sigBytes).toString('base64url'),
  };
}

/**
 * Load the operator's signing context from `~/.omni/keys/`. Returns null
 * when no keypair is present (the CLI then continues bearer-only — same
 * behavior as before this module existed).
 *
 * Errors loading an existing keypair (file unreadable, malformed JSON,
 * etc.) bubble up — silently falling back to bearer would mask a key
 * file that was tampered with or partially written.
 */
export function loadSigningContext(): SigningContext | null {
  const hostJsonFile = hostJsonPath();
  const privKeyFile = privateKeyPath();
  if (!existsSync(hostJsonFile) || !existsSync(privKeyFile)) {
    return null;
  }
  const meta = JSON.parse(readFileSync(hostJsonFile, 'utf-8')) as OmniHostMetadata;
  const privKeyBuf = readFileSync(privKeyFile);
  const privateKey = createPrivateKey({ key: privKeyBuf });
  return {
    hostId: meta.hostId,
    signRequest: (method, path, body) => signRequest({ hostId: meta.hostId, privateKey, method, path, body }),
  };
}

/**
 * Mint a fresh ed25519 keypair on disk. Idempotent only across `--rotate`
 * boundaries: caller is responsible for deciding whether to overwrite an
 * existing pair.
 *
 * Returns the base64url-encoded raw public key (32 bytes) — the form the
 * handshake endpoint expects.
 */
export function generateAndStoreKeypair(): { pubkeyB64Url: string; privateKey: KeyObject } {
  const dir = getKeysDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Persist private key as PEM (PKCS#8) — node:crypto re-parses it via
  // createPrivateKey() on next load. Permissions tightened to 0600 so
  // operators get the same protection genie's keys do.
  const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  const privPath = privateKeyPath();
  writeFileSync(privPath, privPem, { mode: 0o600 });
  // chmodSync defends against umask races where writeFileSync's mode arg
  // is silently widened by an aggressive umask.
  chmodSync(privPath, 0o600);

  // Public key: store the raw 32 bytes base64url-encoded so it matches
  // exactly what the handshake endpoint accepts. We also strip from the
  // SPKI DER prefix to get the raw bytes.
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const raw = spki.subarray(spki.byteLength - 32);
  const pubkeyB64Url = Buffer.from(raw).toString('base64url');
  writeFileSync(publicKeyPath(), pubkeyB64Url, { mode: 0o644 });

  return { pubkeyB64Url, privateKey };
}

/** Persist host metadata after a successful handshake. */
export function writeHostMetadata(meta: OmniHostMetadata): void {
  const dir = getKeysDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(hostJsonPath(), JSON.stringify(meta, null, 2), { mode: 0o644 });
}

/**
 * Test-only: paths the module reads/writes. Exported so tests can inject a
 * temp `OMNI_CONFIG_DIR` and assert the right files were created.
 */
export const _paths = {
  privateKey: privateKeyPath,
  publicKey: publicKeyPath,
  hostJson: hostJsonPath,
};
