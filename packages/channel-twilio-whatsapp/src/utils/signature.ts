/**
 * Twilio webhook signature validation.
 *
 * Implements Twilio's documented x-www-form-urlencoded algorithm without
 * adding the full twilio-node dependency to the channel plugin.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

function buildSignatureBase(url: string, params: Record<string, string | string[]>): string {
  const normalizedUrl = url.split('#')[0] ?? url;
  const entries = Object.entries(params).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.map((v) => [key, v] as const);
    return [[key, value] as const];
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.reduce((acc, [key, value]) => `${acc}${key}${value}`, normalizedUrl);
}

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string | string[]>,
): string {
  return createHmac('sha1', authToken).update(buildSignatureBase(url, params)).digest('base64');
}

export function validateTwilioSignature(
  authToken: string,
  signature: string | null | undefined,
  url: string,
  params: Record<string, string | string[]>,
): boolean {
  if (!signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
