/**
 * SRTP decryption for Discord voice using libsodium.
 *
 * Supports Discord's encryption modes:
 * - aead_xchacha20_poly1305_rtpsize (preferred, current default)
 * - aead_aes256_gcm_rtpsize (fallback)
 * - xsalsa20_poly1305_lite (legacy)
 *
 * Each mode uses the RTP header as AAD (additional authenticated data)
 * and extracts a nonce suffix from the tail of the encrypted payload.
 */
import type { EncryptionLayer } from '../interfaces/encryption';

// Use require() — Bun's ESM resolution for libsodium-wrappers is broken (missing ./libsodium.mjs)
import type SodiumType from 'libsodium-wrappers';
const sodium = require('libsodium-wrappers') as typeof SodiumType;

/** Supported Discord voice encryption modes, in preference order. */
export const ENCRYPTION_MODES = [
  'aead_xchacha20_poly1305_rtpsize',
  'aead_aes256_gcm_rtpsize',
  'xsalsa20_poly1305_lite',
] as const;

export type EncryptionMode = (typeof ENCRYPTION_MODES)[number];

/** Pick the best mode from the server's offered list. */
export function selectEncryptionMode(offered: string[]): EncryptionMode {
  for (const preferred of ENCRYPTION_MODES) {
    if (offered.includes(preferred)) return preferred;
  }
  throw new Error(`No supported encryption mode found in: ${offered.join(', ')}`);
}

/** Nonce byte sizes per mode. */
const NONCE_SIZES: Record<EncryptionMode, number> = {
  aead_xchacha20_poly1305_rtpsize: 24,
  aead_aes256_gcm_rtpsize: 12,
  xsalsa20_poly1305_lite: 24,
};

/** Nonce suffix bytes appended to each encrypted packet. */
const NONCE_SUFFIX_SIZE = 4;

/** Typed helper — libsodium-wrappers types don't include AES-256-GCM, but it's available at runtime. */
const sodiumAny = sodium as Record<string, unknown>;

/**
 * SRTP decryptor implementing the EncryptionLayer interface.
 *
 * For AEAD modes (xchacha20, aes256gcm) with `_rtpsize` suffix:
 * - The last 4 bytes of the ciphertext are the incrementing nonce suffix
 * - The nonce is the suffix zero-padded to the mode's nonce size
 * - The RTP header is used as AAD
 *
 * For xsalsa20_poly1305_lite:
 * - Same nonce suffix extraction
 * - No AAD (just secret box)
 */
export class SrtpDecryptor implements EncryptionLayer {
  private secretKey: Uint8Array;
  private mode: EncryptionMode;
  private ready: Promise<void>;

  constructor(secretKey: Uint8Array, mode: EncryptionMode) {
    this.secretKey = secretKey;
    this.mode = mode;
    this.ready = sodium.ready;
  }

  encrypt(_packet: Uint8Array, _nonce: Uint8Array): Uint8Array {
    throw new Error('SrtpDecryptor does not support encryption');
  }

  decrypt(packet: Uint8Array, header: Uint8Array): Uint8Array {
    if (!sodium.crypto_aead_xchacha20poly1305_ietf_decrypt) {
      throw new Error('libsodium not ready');
    }
    return this.decryptPacket(packet, header);
  }

  /** Async decrypt that ensures sodium is ready. */
  async decryptAsync(packet: Uint8Array, header: Uint8Array): Promise<Uint8Array> {
    await this.ready;
    return this.decryptPacket(packet, header);
  }

  private decryptPacket(encryptedPayload: Uint8Array, rtpHeader: Uint8Array): Uint8Array {
    const nonceSize = NONCE_SIZES[this.mode];

    // Extract the 4-byte nonce suffix from the end of the payload
    const ciphertext = encryptedPayload.slice(0, encryptedPayload.length - NONCE_SUFFIX_SIZE);
    const nonceSuffix = encryptedPayload.slice(encryptedPayload.length - NONCE_SUFFIX_SIZE);

    // Build full nonce: suffix zero-padded to mode's nonce size
    const nonce = new Uint8Array(nonceSize);
    nonce.set(nonceSuffix, 0);

    switch (this.mode) {
      case 'aead_xchacha20_poly1305_rtpsize':
        return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, rtpHeader, nonce, this.secretKey);

      case 'aead_aes256_gcm_rtpsize': {
        // AES-256-GCM is available at runtime but not in @types/libsodium-wrappers
        const fn = sodiumAny.crypto_aead_aes256gcm_decrypt as typeof sodium.crypto_aead_xchacha20poly1305_ietf_decrypt;
        if (!fn) throw new Error('AES-256-GCM not available in this libsodium build');
        return fn(null, ciphertext, rtpHeader, nonce, this.secretKey);
      }

      case 'xsalsa20_poly1305_lite':
        return sodium.crypto_secretbox_open_easy(ciphertext, nonce, this.secretKey);

      default:
        throw new Error(`Unsupported encryption mode: ${this.mode}`);
    }
  }
}

/** Preferred encryption modes list for Select Protocol. */
export function preferredModes(): string[] {
  return [...ENCRYPTION_MODES];
}
