/**
 * Credential hashing for the multitenancy auth plane
 * (wish: omni-full-multitenancy, Group G1).
 *
 * SHA-256 hex, identical to the legacy `ApiKeyService` hashing so the two key
 * spaces share the same digest width and the `key_hash` columns are directly
 * comparable. The stored digest is what the indexed hash-equality lookup path
 * queries — plaintext is never compared and never persisted.
 */

const CREDENTIAL_PREFIX = 'omni_sk_';

/**
 * Generate a fresh random credential secret. Used only by explicit issuance
 * paths; the plaintext is returned to the caller once and never persisted or
 * logged (the digest is what is stored).
 */
export function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint8Array(32);
  crypto.getRandomValues(randomValues);
  let body = '';
  for (const value of randomValues) body += chars[value % chars.length];
  return `${CREDENTIAL_PREFIX}${body}`;
}

export async function hashSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** First 8 chars after the `omni_sk_` prefix — display/identification only. */
export function secretPrefix(secret: string): string {
  const body = secret.startsWith(CREDENTIAL_PREFIX) ? secret.slice(CREDENTIAL_PREFIX.length) : secret;
  return body.slice(0, 8);
}
