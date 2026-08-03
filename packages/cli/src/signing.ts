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
import { getConfigDir, loadLocalRuntimeConfig } from './config.js';

const KEY_FILENAME_PRIV = 'omni-cli.ed25519';
const KEY_FILENAME_PUB = 'omni-cli.ed25519.pub';
const HOST_JSON_FILENAME = 'host.json';

/**
 * One server this keypair is registered with, and the host id THAT server
 * issued for it.
 *
 * The id is per-server: each omni instance mints its own row (its own UUID)
 * when the pubkey is handshaken there. Carrying a single id across servers
 * makes every request to the other servers 401 "unknown host", which is why
 * bindings are (url, hostId) pairs rather than bare urls.
 */
export interface ServerBinding {
  url: string;
  hostId: string;
}

export interface OmniHostMetadata {
  /**
   * The host id issued by the FIRST server this keypair was registered with.
   * Kept as the legacy/default id (older CLIs read only this field, and
   * {@link loadSigningContext} still uses it); never overwritten by binding an
   * additional server — only a `--rotate` handshake replaces it.
   */
  hostId: string;
  pubkey: string;
  hostname: string;
  registeredAt: string;
  /**
   * Servers this keypair is registered with, each with the host id that server
   * issued. URLs are normalized by {@link normalizeServerUrl}.
   *
   * A handshake registers the pubkey with ONE server; other servers in the
   * registry have never seen it, so signing headers sent to them are at best
   * ignored and at worst rejected. Requests therefore carry X-Genie-* headers
   * only for bound servers — everything else goes bearer-only.
   *
   * Legacy shapes are coerced on load (see {@link loadHostMetadata}):
   *   - ABSENT (host.json written before multi-server support) → bound to the
   *     local `default` entry, the only server those installs could have
   *     handshaken against, with the top-level `hostId`.
   *   - `string[]` (written before per-server ids) → each url paired with the
   *     top-level `hostId`.
   */
  boundServers?: ServerBinding[];
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
 * Canonical form of a server base URL for binding comparisons: trimmed, with
 * trailing slashes removed. Deliberately conservative — host casing and port
 * are left alone so `localhost` and `127.0.0.1` stay distinct entries.
 */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Read `~/.omni/keys/host.json`, or null when this CLI has never handshaken.
 *
 * Requires the private key to exist too: metadata without a key cannot sign,
 * and treating that state as "handshook" would make every caller fail later
 * with a confusing crypto error instead of falling back to bearer-only.
 */
export function loadHostMetadata(): OmniHostMetadata | null {
  const hostJsonFile = hostJsonPath();
  if (!existsSync(hostJsonFile) || !existsSync(privateKeyPath())) {
    return null;
  }
  const raw = JSON.parse(readFileSync(hostJsonFile, 'utf-8')) as Omit<OmniHostMetadata, 'boundServers'> & {
    boundServers?: Array<string | ServerBinding>;
  };
  return { ...raw, boundServers: coerceBindings(raw.hostId, raw.boundServers) };
}

/**
 * Normalize the on-disk `boundServers` value into (url, hostId) pairs.
 *
 * Both legacy shapes predate per-server ids, so they can only be attributed to
 * the top-level `hostId` — which is exactly the id those installs were signing
 * with, so the coercion is behavior-preserving.
 */
function coerceBindings(hostId: string, raw: Array<string | ServerBinding> | undefined): ServerBinding[] {
  if (!raw || raw.length === 0) {
    // Absent: legacy install, bound to the LOCAL `default` entry — never the
    // active one, since a legacy handshake could only have targeted the local API.
    return [{ url: normalizeServerUrl(loadLocalRuntimeConfig().apiUrl ?? 'http://localhost:8882'), hostId }];
  }
  return raw.map((entry) =>
    typeof entry === 'string'
      ? { url: normalizeServerUrl(entry), hostId }
      : { url: normalizeServerUrl(entry.url), hostId: entry.hostId },
  );
}

/** Bindings of loaded metadata — always populated by {@link loadHostMetadata}. */
export function boundServerBindings(meta: OmniHostMetadata): ServerBinding[] {
  return coerceBindings(meta.hostId, meta.boundServers);
}

/** Base URLs of the servers this keypair is registered with. */
export function boundServerUrls(meta: OmniHostMetadata): string[] {
  return boundServerBindings(meta).map((b) => b.url);
}

/** The binding for `url`, or undefined when that server has never seen this key. */
export function bindingForServer(meta: OmniHostMetadata, url: string): ServerBinding | undefined {
  const normalized = normalizeServerUrl(url);
  return boundServerBindings(meta).find((b) => b.url === normalized);
}

/**
 * Signing context for a specific target server, or null when requests to that
 * server must go out unsigned (no keypair at all, or a keypair the target
 * server has never seen).
 *
 * Uses the host id THAT server issued — not the top-level one, which belongs to
 * whichever server was handshaken first.
 */
export function loadSigningContextForServer(url: string): SigningContext | null {
  const meta = loadHostMetadata();
  if (!meta) {
    return null;
  }
  const binding = bindingForServer(meta, url);
  if (!binding) {
    return null;
  }
  return buildSigningContext(binding.hostId);
}

/**
 * Load the operator's signing context from `~/.omni/keys/`. Returns null
 * when no keypair is present (the CLI then continues bearer-only — same
 * behavior as before this module existed).
 *
 * Ignores server binding — callers that put headers on the wire should use
 * {@link loadSigningContextForServer} instead.
 *
 * Errors loading an existing keypair (file unreadable, malformed JSON,
 * etc.) bubble up — silently falling back to bearer would mask a key
 * file that was tampered with or partially written.
 */
export function loadSigningContext(): SigningContext | null {
  const meta = loadHostMetadata();
  if (!meta) {
    return null;
  }
  return buildSigningContext(meta.hostId);
}

/** Read the private key off disk and bind it to one host id. */
function buildSigningContext(hostId: string): SigningContext {
  const privKeyBuf = readFileSync(privateKeyPath());
  const privateKey = createPrivateKey({ key: privKeyBuf });
  return {
    hostId,
    signRequest: (method, path, body) => signRequest({ hostId, privateKey, method, path, body }),
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
