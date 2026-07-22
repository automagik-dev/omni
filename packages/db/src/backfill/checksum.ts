/**
 * Deterministic row-image checksums (wish: omni-full-multitenancy, Group G6).
 *
 * The G2 migration ledger stores a `pre_image_checksum`/`post_image_checksum`
 * pair (`^[0-9a-f]{64}$`, i.e. SHA-256 hex) whose job is to PROVE a row was
 * untouched — the checksum is the integrity witness, not a copy of the row. Two
 * properties make it trustworthy:
 *
 *   * **Canonical.** Object key order, and the representation of Date/Buffer/
 *     bigint/undefined, must not change the digest, or a re-read of the same row
 *     would appear to have changed. Keys are sorted recursively and every scalar
 *     has a single tagged encoding.
 *   * **Injective enough.** The encoding tags types (`s:`, `n:`, `b:`…) so the
 *     string `"1"` and the number `1`, or an empty object and an empty array,
 *     never collide into the same digest.
 *
 * A checksum is taken over the FULL row (secret-bearing columns included): a
 * one-way digest reveals nothing, and hashing the whole row is what lets the
 * inverse prove a byte-identical restore. The REDACTED projection stored
 * alongside it (see `redaction.ts`) is the human-readable half; the two are
 * independent.
 */

import { createHash } from 'node:crypto';

/**
 * A sentinel used as the pre-image of a row that does not yet exist — the person
 * clone fan-out ledgers a "creates a row that was absent" decision, and its
 * pre-image is this explicit does-not-exist projection rather than a real row.
 */
export const ABSENT_IMAGE = { $absent: true } as const;

/**
 * Canonical, type-tagged serialization of an arbitrary JSON-ish value.
 *
 * Not valid JSON — it is a canonical BYTE STRING for hashing. Object keys are
 * emitted in sorted order; scalars carry a one-character type tag so distinct
 * types cannot alias.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'z:';
  if (value === undefined) return 'u:';

  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'number') return Number.isFinite(value) ? `n:${value}` : `n:!${String(value)}`;
  if (typeof value === 'boolean') return `b:${value ? '1' : '0'}`;
  if (typeof value === 'bigint') return `i:${value.toString()}`;

  if (value instanceof Date) return `d:${value.toISOString()}`;
  if (value instanceof Uint8Array) return `x:${Buffer.from(value).toString('hex')}`;

  if (Array.isArray(value)) {
    return `a:[${value.map((element) => canonicalize(element)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const body = keys.map((key) => `${encodeURIComponent(key)}=${canonicalize(record[key])}`).join('&');
    return `o:{${body}}`;
  }

  // Functions/symbols never appear in a row image; tag them so a stray one is
  // visible in a digest mismatch rather than silently dropped.
  return `?:${String(value)}`;
}

/** SHA-256 hex digest of the canonical encoding of `value`. Lowercase, 64 chars. */
export function checksum(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

/** Convenience: the checksum of the absent-row sentinel. */
export function absentChecksum(): string {
  return checksum(ABSENT_IMAGE);
}
