/**
 * Inbound signature verification.
 *
 * The raw body is verified BEFORE anything is parsed or published, so a badly
 * signed request never reaches the JSON parser, the journal or the bus. The
 * comparison is constant-time over equal-length digests.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorVerification } from './types';

function normalizedHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}

/** Verify an HMAC-SHA256 delivery. Never throws for a malformed header. */
export function verifyHmacSha256(args: {
  readonly secret: string;
  readonly rawBody: string;
  readonly provided: string | undefined;
  readonly encoding: 'hex' | 'base64';
  readonly prefix?: string;
}): boolean {
  const { secret, rawBody, provided, encoding, prefix } = args;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest(encoding);
  const expectedWithPrefix = `${prefix ?? ''}${expected}`;
  const providedNormalized = encoding === 'hex' ? provided.toLowerCase() : provided;
  if (providedNormalized.length !== expectedWithPrefix.length) return false;
  return timingSafeEqual(Buffer.from(providedNormalized, 'utf8'), Buffer.from(expectedWithPrefix, 'utf8'));
}

/** Verify a delivery with a manifest's declared scheme. */
export async function verifyDelivery(
  verification: ConnectorVerification,
  rawBody: string,
  headers: Readonly<Record<string, string>>,
  secret: string,
): Promise<boolean> {
  if (verification.kind === 'custom') return verification.verify(rawBody, headers, secret);
  const provided = normalizedHeaders(headers)[verification.header.toLowerCase()];
  return verifyHmacSha256({
    secret,
    rawBody,
    provided,
    encoding: verification.encoding,
    prefix: verification.prefix,
  });
}
