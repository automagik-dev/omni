/**
 * Token Redaction for Log Output
 *
 * Redacts sensitive tokens from log messages and data fields.
 * Applied as middleware in the logging pipeline.
 *
 * Patterns redacted:
 * - Telegram bot tokens: `123456:ABC-xyz...` → `[REDACTED_BOT_TOKEN]`
 * - Bearer tokens: `Bearer <token>` → `Bearer [REDACTED]`
 * - API keys: `sk-...`, `key-...` patterns → `[REDACTED_API_KEY]`
 * - Connection strings: `postgres://...`, `nats://...` → `[REDACTED_URL]`
 */

// Telegram bot token: digits:alphanumeric+dash (35 chars)
const BOT_TOKEN_RE = /\b\d{8,12}:[A-Za-z0-9_-]{35}\b/g;

// Bearer tokens
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g;

// API keys: sk-..., key-..., api-... patterns (20+ chars)
const API_KEY_RE = /\b(?:sk|key|api|secret|token)[-_][A-Za-z0-9._-]{20,}/gi;

// Connection strings: postgres://, nats://, redis://, amqp://
const CONN_STRING_RE = /\b(?:postgres|postgresql|nats|redis|amqp|mysql)s?:\/\/[^\s'",)}\]]+/gi;

/**
 * Redact sensitive tokens from a string value.
 */
export function redactString(value: string): string {
  let result = value;
  result = result.replace(BOT_TOKEN_RE, '[REDACTED_BOT_TOKEN]');
  result = result.replace(BEARER_RE, 'Bearer [REDACTED]');
  result = result.replace(API_KEY_RE, '[REDACTED_API_KEY]');
  result = result.replace(CONN_STRING_RE, '[REDACTED_URL]');
  return result;
}

/**
 * Deep-redact sensitive values from an object (log entry data).
 * Returns a new object with redacted strings.
 * Uses a WeakSet to detect and safely handle circular references.
 */
export function redactObject<T>(obj: T, visited = new WeakSet<object>()): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactString(obj) as T;
  }

  if (typeof obj === 'object') {
    if (visited.has(obj as object)) return '[Circular]' as unknown as T;
    visited.add(obj as object);

    if (Array.isArray(obj)) {
      return obj.map((item) => redactObject(item, visited)) as T;
    }

    // Preserve non-plain objects (Date, Error, URL, RegExp, Buffer, etc.) as-is.
    // Object.entries on these types returns [] or only partial data, so deep-copying
    // via entries strips their semantics entirely (e.g. Date → {}, Error → {}).
    // Plain objects have Object.prototype or null as their prototype.
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return obj;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactObject(value, visited);
    }
    return result as T;
  }

  return obj;
}
