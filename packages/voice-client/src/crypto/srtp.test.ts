import { beforeAll, describe, expect, it } from 'bun:test';
import type SodiumType from 'libsodium-wrappers';
const sodium = require('libsodium-wrappers') as typeof SodiumType;
import { ENCRYPTION_MODES, SrtpDecryptor, preferredModes, selectEncryptionMode } from './srtp';

describe('selectEncryptionMode', () => {
  it('should select xchacha20 when available', () => {
    const modes = ['xsalsa20_poly1305_lite', 'aead_xchacha20_poly1305_rtpsize'];
    expect(selectEncryptionMode(modes)).toBe('aead_xchacha20_poly1305_rtpsize');
  });

  it('should fall back to aes256gcm', () => {
    const modes = ['aead_aes256_gcm_rtpsize', 'xsalsa20_poly1305_lite'];
    expect(selectEncryptionMode(modes)).toBe('aead_aes256_gcm_rtpsize');
  });

  it('should fall back to xsalsa20', () => {
    const modes = ['xsalsa20_poly1305_lite', 'unknown_mode'];
    expect(selectEncryptionMode(modes)).toBe('xsalsa20_poly1305_lite');
  });

  it('should throw if no supported mode', () => {
    expect(() => selectEncryptionMode(['unsupported_mode'])).toThrow('No supported encryption mode');
  });
});

describe('preferredModes', () => {
  it('should return all supported modes', () => {
    const modes = preferredModes();
    expect(modes).toEqual([...ENCRYPTION_MODES]);
    expect(modes.length).toBe(3);
  });
});

describe('SrtpDecryptor', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  it('should throw on encrypt (receive-only)', () => {
    const key = new Uint8Array(32);
    const dec = new SrtpDecryptor(key, 'aead_xchacha20_poly1305_rtpsize');
    expect(() => dec.encrypt(new Uint8Array(0), new Uint8Array(0))).toThrow('does not support encryption');
  });

  it('should decrypt xchacha20_poly1305 encrypted data', async () => {
    // Simulate what Discord sends: encrypt with xchacha20poly1305_ietf then append 4-byte nonce suffix
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const plaintext = new Uint8Array([0x78, 0x9a, 0xbc, 0xde]); // fake Opus frame
    const rtpHeader = new Uint8Array([0x80, 0x78, 0x00, 0x01, 0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x30, 0x39]);

    // Build a 4-byte nonce suffix (incrementing counter)
    const nonceSuffix = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
    // Full 24-byte nonce: suffix padded with zeros
    const nonce = new Uint8Array(24);
    nonce.set(nonceSuffix, 0);

    // Encrypt
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, rtpHeader, null, nonce, key);

    // Build the "wire" payload: ciphertext + 4-byte nonce suffix
    const wirePayload = new Uint8Array(ciphertext.length + 4);
    wirePayload.set(ciphertext, 0);
    wirePayload.set(nonceSuffix, ciphertext.length);

    // Decrypt
    const dec = new SrtpDecryptor(key, 'aead_xchacha20_poly1305_rtpsize');
    const result = await dec.decryptAsync(wirePayload, rtpHeader);

    expect(result).toEqual(plaintext);
  });

  it('should decrypt aes256gcm encrypted data', async () => {
    // AES-256-GCM uses a 12-byte nonce (same 4-byte suffix, zero-padded to 12)
    const sodiumAny = sodium as Record<string, unknown>;
    const keygen = sodiumAny.crypto_aead_aes256gcm_keygen as (() => Uint8Array) | undefined;
    const encrypt = sodiumAny.crypto_aead_aes256gcm_encrypt as
      | ((
          message: Uint8Array,
          additionalData: Uint8Array | null,
          nsec: null,
          nonce: Uint8Array,
          key: Uint8Array,
        ) => Uint8Array)
      | undefined;

    if (!keygen || !encrypt) {
      // AES-256-GCM not available in this libsodium build — skip gracefully
      return;
    }

    const key = keygen();
    const plaintext = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const rtpHeader = new Uint8Array([0x80, 0x78, 0x00, 0x01, 0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x30, 0x39]);

    const nonceSuffix = new Uint8Array([0x00, 0x00, 0x00, 0x03]);
    const nonce = new Uint8Array(12);
    nonce.set(nonceSuffix, 0);

    const ciphertext = encrypt(plaintext, rtpHeader, null, nonce, key);

    const wirePayload = new Uint8Array(ciphertext.length + 4);
    wirePayload.set(ciphertext, 0);
    wirePayload.set(nonceSuffix, ciphertext.length);

    const dec = new SrtpDecryptor(key, 'aead_aes256_gcm_rtpsize');
    const result = await dec.decryptAsync(wirePayload, rtpHeader);

    expect(result).toEqual(plaintext);
  });

  it('should roundtrip encryptRaw/decryptRaw for xchacha20', async () => {
    const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    const plaintext = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const rtpHeader = Buffer.from([0x80, 0x78, 0x00, 0x05, 0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x30, 0x39]);

    const dec = new SrtpDecryptor(key, 'aead_xchacha20_poly1305_rtpsize');
    const encrypted = dec.encryptRaw(plaintext, rtpHeader, 42);

    // Encrypted payload = cipherWithTag + 4-byte nonce suffix
    const cipherWithTag = encrypted.subarray(0, encrypted.length - 4);
    const nonceSuffix = encrypted.subarray(encrypted.length - 4);
    const nonce = Buffer.alloc(24);
    nonceSuffix.copy(nonce, 0);

    const result = dec.decryptRaw(cipherWithTag, rtpHeader, nonce);
    expect(Buffer.from(result)).toEqual(plaintext);
  });

  it('should decrypt xsalsa20_poly1305_lite encrypted data', async () => {
    const key = sodium.crypto_secretbox_keygen();
    const plaintext = new Uint8Array([0x11, 0x22, 0x33]);

    const nonceSuffix = new Uint8Array([0x00, 0x00, 0x00, 0x02]);
    const nonce = new Uint8Array(24);
    nonce.set(nonceSuffix, 0);

    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);

    const wirePayload = new Uint8Array(ciphertext.length + 4);
    wirePayload.set(ciphertext, 0);
    wirePayload.set(nonceSuffix, ciphertext.length);

    const dec = new SrtpDecryptor(key, 'xsalsa20_poly1305_lite');
    const result = await dec.decryptAsync(wirePayload, new Uint8Array(12));

    expect(result).toEqual(plaintext);
  });
});
