/**
 * OpenClaw Device Keypair Generation
 *
 * Shared Ed25519 keypair generation and deviceId derivation.
 * Used by both the CLI setup command and the OpenClawClient.
 *
 * Key formats match what the OpenClaw gateway expects:
 * - deviceId: SHA256 hex of raw 32-byte Ed25519 public key
 * - publicKey: base64url of raw 32-byte Ed25519 public key
 * - privateKey: base64url of raw 32-byte Ed25519 private key
 */

import * as crypto from 'node:crypto';

export interface DeviceKeypair {
  /** SHA256 hex of the raw 32-byte Ed25519 public key */
  deviceId: string;
  /** Raw 32-byte Ed25519 public key, base64url encoded */
  publicKey: string;
  /** Raw 32-byte Ed25519 private key, base64url encoded */
  privateKey: string;
}

/**
 * SPKI DER prefix for Ed25519 public key (RFC 8410).
 * Raw 32-byte key starts at offset 12 in the SPKI export.
 */
const SPKI_PREFIX_LEN = 12;

/**
 * PKCS8 DER prefix for Ed25519 private key (RFC 8410).
 * Raw 32-byte key starts at offset 16 in the PKCS8 export.
 */
const PKCS8_PREFIX_LEN = 16;

/**
 * PKCS8 DER prefix bytes for wrapping a raw 32-byte Ed25519 private key (RFC 8410).
 * Used when reconstructing a PKCS8 DER key from a stored raw base64url private key.
 */
export const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * Generate a new Ed25519 device keypair for OpenClaw gateway registration.
 *
 * Returns keys in the raw 32-byte format the gateway expects:
 * - publicKey/privateKey: base64url encoded raw 32-byte keys
 * - deviceId: SHA256 hex of the raw public key bytes
 */
export function generateDeviceKeypair(): DeviceKeypair {
  const { publicKey: pubKeyObj, privateKey: privKeyObj } = crypto.generateKeyPairSync('ed25519');

  // Export SPKI DER and slice off the 12-byte prefix to get raw 32-byte public key
  const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
  const rawPublicKey = spkiDer.slice(SPKI_PREFIX_LEN);

  // Export PKCS8 DER and slice off the 16-byte prefix to get raw 32-byte private key
  const pkcs8Der = privKeyObj.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const rawPrivateKey = pkcs8Der.slice(PKCS8_PREFIX_LEN);

  // deviceId is SHA256 hex of the raw public key bytes
  const deviceId = crypto.createHash('sha256').update(rawPublicKey).digest('hex');

  return {
    deviceId,
    publicKey: rawPublicKey.toString('base64url'),
    privateKey: rawPrivateKey.toString('base64url'),
  };
}
