/**
 * Redaction rules for {@link JsonInspector}.
 *
 * Values whose *key* looks like a credential are masked by default so an
 * operator can screenshot or share a payload without leaking secrets. The
 * inspector renders the redacted tree unless the operator explicitly toggles
 * the raw view, and the "copy" affordance always copies the redacted form.
 *
 * Pure and DOM-free so it can be unit-tested and reused server-side.
 */

/** Keys whose values are masked. Matches anywhere in the key, case-insensitive. */
export const SENSITIVE_KEY_RE = /key|token|secret|password|authorization/i;

/** Placeholder shown in place of a redacted value. */
export const REDACTION_MASK = '••••••••';

/** True when a key names a credential and its value should be masked. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

/**
 * Return a deep copy of `value` with every value under a sensitive key replaced
 * by {@link REDACTION_MASK}. A sensitive key masks its entire subtree (object,
 * array, or scalar) — partial exposure of a secret is still exposure.
 */
export function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTION_MASK : redactDeep(child);
    }
    return out;
  }
  return value;
}

/** Stable JSON string of the redacted tree — the payload the copy button emits. */
export function redactedJson(value: unknown, space = 2): string {
  return JSON.stringify(redactDeep(value), null, space);
}
