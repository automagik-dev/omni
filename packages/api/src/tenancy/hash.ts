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

/** The credential alphabet. 62 symbols, so a byte cannot be folded into it evenly. */
const SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SECRET_LENGTH = 32;

/**
 * Largest byte value that divides evenly into the alphabet: 256 - (256 % 62) =
 * 248. Bytes at or above it are discarded rather than folded.
 */
const REJECTION_CEILING = 256 - (256 % SECRET_ALPHABET.length);

/**
 * Generate a fresh random credential secret. Used only by explicit issuance
 * paths; the plaintext is returned to the caller once and never persisted or
 * logged (the digest is what is stored).
 *
 * Rejection sampling, not `byte % 62`. Under modulo the 256 byte values map onto
 * 62 symbols as 8 symbols with 5 preimages and 54 with 4 — the first 8 letters
 * of the alphabet are 25% more likely than the rest, which costs roughly a third
 * of a bit per character and is exactly the kind of bias that makes a key space
 * searchable. Discarding the 8 bytes above {@link REJECTION_CEILING} makes the
 * distribution flat; the expected number of extra draws is under 4% of the
 * length, so the loop is not a practical cost.
 *
 * The alphabet and the 32-character body length are unchanged.
 */
export function generateSecret(): string {
  let body = '';
  while (body.length < SECRET_LENGTH) {
    const batch = new Uint8Array(SECRET_LENGTH - body.length);
    crypto.getRandomValues(batch);
    for (const value of batch) {
      if (value >= REJECTION_CEILING) continue;
      body += SECRET_ALPHABET[value % SECRET_ALPHABET.length];
    }
  }
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
