/**
 * WhatsApp Flows data-endpoint crypto (Meta data API v3.0).
 *
 * Request:  Meta wraps a fresh 128-bit AES key with the business's 2048-bit
 *           RSA public key (RSA-OAEP, SHA-256 hash + SHA-256 MGF1) and
 *           encrypts the JSON payload with AES-128-GCM. The 16-byte GCM tag
 *           is appended to the ciphertext — exactly the layout Web Crypto's
 *           `decrypt` expects.
 * Response: encrypted with the SAME AES key but the IV bitwise-inverted
 *           (each byte XOR 0xFF), then base64'd as the raw HTTP body.
 *
 * Pure functions — no fetch, no DB — so the whole contract is unit-testable
 * as an encrypt→decrypt inverse without Meta in the loop.
 */

export interface EncryptedFlowRequestBody {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

/** Decrypted request plus the material needed to encrypt the response. */
export interface DecryptedFlowRequest {
  payload: FlowDataExchangeRequest;
  aesKey: CryptoKey;
  iv: Uint8Array;
}

/** The decrypted data-exchange payload (action drives the dispatch). */
export interface FlowDataExchangeRequest {
  version: string;
  action: 'ping' | 'INIT' | 'data_exchange' | 'BACK';
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
}

/** Thrown for any failure that must map to HTTP 421 (Meta re-fetches the key). */
export class FlowDecryptError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'FlowDecryptError';
    this.cause = cause;
  }
}

const b64decode = (value: string): Uint8Array => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const b64encode = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** Strip PEM armor and return the DER bytes. */
function pemToDer(pem: string): Uint8Array {
  const base64 = pem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return b64decode(base64);
}

/** Import a PKCS#8 RSA private key PEM for OAEP-SHA256 unwrapping. */
export async function importFlowPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  try {
    const der = pemToDer(privateKeyPem);
    return await crypto.subtle.importKey(
      'pkcs8',
      der.buffer as ArrayBuffer,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
  } catch (err) {
    throw new FlowDecryptError('failed to import flow private key', err);
  }
}

/**
 * Decrypt an inbound data-exchange request. Any failure (bad base64, wrong
 * key, GCM auth failure, non-JSON plaintext) throws FlowDecryptError → the
 * caller must answer HTTP 421.
 */
export async function decryptFlowRequest(
  body: EncryptedFlowRequestBody,
  privateKey: CryptoKey,
): Promise<DecryptedFlowRequest> {
  let aesKeyBytes: ArrayBuffer;
  try {
    const wrapped = b64decode(body.encrypted_aes_key);
    aesKeyBytes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, wrapped.buffer as ArrayBuffer);
  } catch (err) {
    throw new FlowDecryptError('RSA unwrap of AES key failed', err);
  }

  try {
    const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = b64decode(body.initial_vector);
    const ciphertext = b64decode(body.encrypted_flow_data);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      aesKey,
      ciphertext.buffer as ArrayBuffer,
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as FlowDataExchangeRequest;
    return { payload, aesKey, iv };
  } catch (err) {
    if (err instanceof FlowDecryptError) throw err;
    throw new FlowDecryptError('AES-GCM decrypt of flow data failed', err);
  }
}

/**
 * Encrypt the response payload with the request's AES key and the inverted
 * IV. Returns the base64 string Meta expects as the raw response body.
 */
export async function encryptFlowResponse(
  response: unknown,
  aesKey: CryptoKey,
  requestIv: Uint8Array,
): Promise<string> {
  const flippedIv = requestIv.map((byte) => byte ^ 0xff);
  const plaintext = new TextEncoder().encode(JSON.stringify(response));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: flippedIv.buffer as ArrayBuffer },
    aesKey,
    plaintext.buffer as ArrayBuffer,
  );
  return b64encode(new Uint8Array(ciphertext));
}

/**
 * Generate a 2048-bit RSA-OAEP keypair for the flows endpoint. Returns both
 * halves as PEM: the public side goes to Meta
 * (`uploadBusinessPublicKey`), the private side is sealed and stored.
 */
export async function generateFlowKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const publicDer = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    privateKeyPem: derToPem(privateDer, 'PRIVATE KEY'),
    publicKeyPem: derToPem(publicDer, 'PUBLIC KEY'),
  };
}

function derToPem(der: Uint8Array, label: string): string {
  const base64 = b64encode(der);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}
