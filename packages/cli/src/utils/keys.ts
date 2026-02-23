/**
 * API Key Utilities
 *
 * Shared helpers for generating and displaying API keys.
 * Used by install, auth recover, and other commands.
 */

/** Generate a random API key: omni_sk_ + 32 hex chars */
export function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `omni_sk_${hex}`;
}

/** Mask an API key for display: show first 12 chars + ... */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 12)}...`;
}
