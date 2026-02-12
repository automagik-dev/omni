/**
 * UTF-8 sanitization for PostgreSQL text columns.
 *
 * WhatsApp protobuf messages can contain malformed UTF-8 byte sequences
 * (e.g. a leading byte like 0xD2 without a valid continuation byte).
 * PostgreSQL rejects these with:
 *   "invalid byte sequence for encoding UTF8"
 *
 * These helpers strip problematic characters so text can be safely persisted.
 */

/**
 * Sanitize a string for PostgreSQL UTF-8 storage.
 *
 * 1. Strips null bytes (\x00) — PostgreSQL text columns reject them.
 * 2. Strips lone surrogates (high surrogate NOT followed by low, or
 *    low surrogate NOT preceded by high) — these can't encode to valid UTF-8.
 * 3. Round-trips through TextEncoder/TextDecoder as a final safety net.
 */
export function sanitizeText(str: string | undefined | null): string | undefined {
  if (!str) return undefined;
  // Strip null bytes
  let cleaned = str.replace(/\0/g, '');
  // Strip lone surrogates while preserving valid surrogate pairs (emoji etc.)
  // Lone high surrogate: \uD800-\uDBFF NOT followed by \uDC00-\uDFFF
  // Lone low surrogate: \uDC00-\uDFFF NOT preceded by \uD800-\uDBFF
  cleaned = cleaned.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  // Round-trip through UTF-8 as final safety net
  return new TextDecoder().decode(new TextEncoder().encode(cleaned));
}

/**
 * Recursively sanitize all string values in an object for PostgreSQL UTF-8 storage.
 * Used on rawPayload (JSONB) to ensure no embedded string contains invalid bytes.
 */
export function deepSanitize<T>(value: T): T {
  if (typeof value === 'string') return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map(deepSanitize) as T;
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deepSanitize(v);
    }
    return result as T;
  }
  return value;
}
