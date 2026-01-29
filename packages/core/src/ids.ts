/**
 * ID generation utilities
 *
 * Uses crypto.randomUUID() for UUIDs (built into Bun/Node)
 * and a custom function for correlation IDs.
 */

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a correlation ID for tracing
 * Format: prefix-timestamp-random
 */
export function generateCorrelationId(prefix = 'corr'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Generate a short ID (8 characters)
 * Useful for user-facing references
 */
export function generateShortId(): string {
  return crypto.randomUUID().substring(0, 8);
}

/**
 * Validate UUID format
 */
export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Extract timestamp from correlation ID
 */
export function extractTimestampFromCorrelationId(correlationId: string): number | null {
  const parts = correlationId.split('-');
  if (parts.length < 2) return null;

  const timestamp = Number.parseInt(parts[1] ?? '', 36);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * ID prefixes for different entity types
 */
export const ID_PREFIXES = {
  person: 'per',
  identity: 'idt',
  instance: 'ins',
  event: 'evt',
  message: 'msg',
  job: 'job',
  provider: 'prv',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/**
 * Generate a prefixed ID
 * Format: prefix_uuid
 */
export function generatePrefixedId(prefix: IdPrefix): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Extract prefix from prefixed ID
 */
export function extractPrefix(prefixedId: string): IdPrefix | null {
  const parts = prefixedId.split('_');
  if (parts.length !== 2) return null;

  const prefix = parts[0] as IdPrefix;
  if (Object.values(ID_PREFIXES).includes(prefix)) {
    return prefix;
  }
  return null;
}
