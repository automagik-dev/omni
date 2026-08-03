import { describe, expect, test } from 'bun:test';
import {
  FlowDecryptError,
  decryptFlowRequest,
  encryptFlowResponse,
  generateFlowKeyPair,
  importFlowPrivateKey,
} from '../utils/flow-crypto';

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** Encrypt a payload exactly the way Meta's client does (the inverse of our endpoint). */
async function metaEncryptRequest(
  payload: unknown,
  publicKeyPem: string,
): Promise<{
  body: { encrypted_flow_data: string; encrypted_aes_key: string; initial_vector: string };
  aesRaw: Uint8Array;
  iv: Uint8Array;
}> {
  const der = Uint8Array.from(
    atob(publicKeyPem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, '').replace(/\s+/g, '')),
    (c) => c.charCodeAt(0),
  );
  const publicKey = await crypto.subtle.importKey(
    'spki',
    der.buffer as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );

  const aesRaw = crypto.getRandomValues(new Uint8Array(16)); // AES-128
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await crypto.subtle.importKey('raw', aesRaw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    aesKey,
    new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer,
  );
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, aesRaw.buffer as ArrayBuffer);

  return {
    body: {
      encrypted_flow_data: b64(new Uint8Array(ciphertext)),
      encrypted_aes_key: b64(new Uint8Array(wrappedKey)),
      initial_vector: b64(iv),
    },
    aesRaw,
    iv,
  };
}

describe('flow-crypto', () => {
  test('decrypts a Meta-shaped request and encrypts a response Meta can read', async () => {
    const { privateKeyPem, publicKeyPem } = await generateFlowKeyPair();
    const privateKey = await importFlowPrivateKey(privateKeyPem);

    const request = {
      version: '3.0',
      action: 'data_exchange' as const,
      screen: 'CADASTRO',
      data: { nome: 'Cezar' },
      flow_token: 'omni.123.abc',
    };
    const { body, aesRaw, iv } = await metaEncryptRequest(request, publicKeyPem);

    const decrypted = await decryptFlowRequest(body, privateKey);
    expect(decrypted.payload).toEqual(request);

    // Response round-trip: decrypt with the same AES key + flipped IV (Meta's side).
    const response = { screen: 'SUCCESS', data: { ok: true } };
    const encryptedResponse = await encryptFlowResponse(response, decrypted.aesKey, decrypted.iv);

    const flippedIv = iv.map((byte) => byte ^ 0xff);
    const aesKey = await crypto.subtle.importKey('raw', aesRaw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    const roundTripped = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: flippedIv.buffer as ArrayBuffer },
      aesKey,
      Uint8Array.from(atob(encryptedResponse), (c) => c.charCodeAt(0)).buffer as ArrayBuffer,
    );
    expect(JSON.parse(new TextDecoder().decode(roundTripped))).toEqual(response);
  });

  test('throws FlowDecryptError when the AES key was wrapped for a different keypair', async () => {
    const ours = await generateFlowKeyPair();
    const theirs = await generateFlowKeyPair();
    const privateKey = await importFlowPrivateKey(ours.privateKeyPem);

    const { body } = await metaEncryptRequest({ version: '3.0', action: 'ping' }, theirs.publicKeyPem);
    expect(decryptFlowRequest(body, privateKey)).rejects.toBeInstanceOf(FlowDecryptError);
  });

  test('throws FlowDecryptError on tampered ciphertext (GCM auth failure)', async () => {
    const { privateKeyPem, publicKeyPem } = await generateFlowKeyPair();
    const privateKey = await importFlowPrivateKey(privateKeyPem);
    const { body } = await metaEncryptRequest({ version: '3.0', action: 'ping' }, publicKeyPem);

    const bytes = Uint8Array.from(atob(body.encrypted_flow_data), (c) => c.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const tampered = { ...body, encrypted_flow_data: b64(bytes) };
    expect(decryptFlowRequest(tampered, privateKey)).rejects.toBeInstanceOf(FlowDecryptError);
  });

  test('generateFlowKeyPair produces importable PEM halves', async () => {
    const { privateKeyPem, publicKeyPem } = await generateFlowKeyPair();
    expect(privateKeyPem).toStartWith('-----BEGIN PRIVATE KEY-----');
    expect(publicKeyPem).toStartWith('-----BEGIN PUBLIC KEY-----');
    await importFlowPrivateKey(privateKeyPem); // does not throw
  });
});
