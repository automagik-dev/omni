/**
 * Meta WhatsApp Cloud API webhook signature verification.
 *
 * Meta signs every POST webhook with an HMAC-SHA256 over the *raw* request
 * body using the Facebook App Secret. The signature is delivered via the
 * `X-Hub-Signature-256` header in the format:
 *
 *     X-Hub-Signature-256: sha256=<hex digest>
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validating-payloads
 *
 * We use the Web Crypto API (`crypto.subtle`) — available natively in Bun —
 * so the implementation has zero external dependencies. The comparison is
 * timing-safe (byte-by-byte XOR over a fixed-length buffer) to mitigate
 * timing side-channels.
 */

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Verify the Meta `X-Hub-Signature-256` header against the raw request body.
 *
 * @param body          The raw request body string (MUST be read once, before
 *                      any JSON parsing — the signature is over the byte
 *                      sequence Meta sent on the wire).
 * @param signatureHeader The value of the `X-Hub-Signature-256` header, or
 *                      `null` if missing.
 * @param appSecret     The Facebook App Secret (`META_APP_SECRET`).
 * @returns             `true` when the header is well-formed and the
 *                      recomputed digest matches; `false` otherwise.
 *                      Returns `false` if the header is missing/malformed or
 *                      if `appSecret` is empty.
 */
export async function verifyMetaSignature(
  body: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length).trim();
  // sha256 digest is 32 bytes -> 64 hex chars
  if (providedHex.length !== 64 || !/^[0-9a-f]+$/i.test(providedHex)) return false;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(appSecret);
  const bodyData = encoder.encode(body);

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return false;
  }

  let signatureBytes: ArrayBuffer;
  try {
    signatureBytes = await crypto.subtle.sign('HMAC', cryptoKey, bodyData);
  } catch {
    return false;
  }

  const expectedHex = bufferToHex(signatureBytes);
  return timingSafeEqualHex(providedHex.toLowerCase(), expectedHex.toLowerCase());
}

/** Convert an ArrayBuffer to a lowercase hex string. */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Constant-time equality check for two equal-length hex strings.
 *
 * Both strings must already be normalized to the same case. Returns `false`
 * if lengths differ. Always iterates the full string length to avoid an
 * early-exit timing leak.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
