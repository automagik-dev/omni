/**
 * Redaction policy for ledger images, receipts, and quarantine reports
 * (wish: omni-full-multitenancy, Group G6).
 *
 * WISH "Backups and data safety": no secret values in logs, reports, diffs, or
 * CI artifacts. The migration ledger stores a REDACTED projection of each row
 * next to its full-row checksum, and every receipt/reconciliation/quarantine
 * report G6 emits is a projection too. This module is the single definition of
 * "redacted": a column whose NAME matches a secret/credential/free-text pattern
 * has its value replaced by a structural marker (`{ redacted, sha256, bytes }`),
 * and every other value passes through unchanged so the projection stays useful
 * for reconciliation.
 *
 * The `sha256` in a marker is an INTEGRITY checksum of the redacted value, which
 * WISH and the G6 test contract permit — it is a one-way digest, not the value —
 * and it is what lets a redacted image still detect a changed secret column
 * without ever storing the secret.
 *
 * `scanForSecrets` is the adversarial half: it walks a finished report and
 * fails if any value looks like raw secret material, so the redaction probe in
 * the test suite fires on a seeded secret-bearing fixture row.
 */

import { createHash } from 'node:crypto';

/** Marker written in place of a redacted value. Never contains the value. */
export interface RedactionMarker {
  readonly redacted: true;
  /** SHA-256 of the redacted value's canonical string form. Integrity only. */
  readonly sha256: string;
  /** Byte length of the redacted value's string form. Structural only. */
  readonly bytes: number;
}

/** Name of the default redaction policy, recorded in the ledger. */
export const DEFAULT_REDACTION_POLICY = 'g6-column-name-v1';

/**
 * Column-name fragments whose VALUES are never stored in the clear. Matched
 * case-insensitively as substrings, so `payload_compressed`, `api_key_hash`,
 * `secret`, `access_token`, and `text_content` are all caught.
 *
 * Deliberately broad: over-redacting an image costs nothing (the checksum still
 * proves the row), while under-redacting leaks. Structural identity columns
 * (`*_id`, `tenant_id`) are handled by an explicit allow-through below so the
 * broad `id`-adjacent matching here never hides a foreign key.
 */
export const SECRET_COLUMN_FRAGMENTS: readonly string[] = [
  'secret',
  'password',
  'passwd',
  'token',
  'hash',
  'credential',
  'private',
  'salt',
  'nonce',
  'signature',
  'cipher',
  'encrypted',
  'payload',
  'content',
  'text',
  'transcription',
  'description',
  'extraction',
  'body',
  'avatar',
  'profile_pic',
  'metadata',
  'expected_headers',
  'state',
  'actions',
  'trigger_conditions',
];

/**
 * Columns that always pass through in the clear even if a broad fragment above
 * would otherwise match them: they are structural identity/ownership columns a
 * reconciliation report must be able to read, and they carry no secret.
 */
export const ALWAYS_CLEAR_COLUMNS: readonly string[] = [
  'id',
  'tenant_id',
  'event_id',
  'instance_id',
  'person_id',
  'agent_id',
  'chat_id',
  'chat_uuid',
  'conversation_id',
  'platform_identity_id',
  'handler',
  'status',
  'channel',
  'event_type',
  'created_at',
  'updated_at',
];

function stringForm(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  return JSON.stringify(value) ?? String(value);
}

function marker(value: unknown): RedactionMarker {
  const s = stringForm(value);
  return { redacted: true, sha256: createHash('sha256').update(s).digest('hex'), bytes: Buffer.byteLength(s) };
}

/** True when a column NAME must be redacted. */
export function isSecretColumn(column: string): boolean {
  const lower = column.toLowerCase();
  if (ALWAYS_CLEAR_COLUMNS.includes(lower)) return false;
  return SECRET_COLUMN_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Project a raw DB row into its redacted image: secret-named columns become
 * markers, everything else passes through. A `null`/`undefined` value is left as
 * `null` — an absent secret is not a leak and a marker would imply one exists.
 */
export function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[column] = null;
    } else if (isSecretColumn(column)) {
      out[column] = marker(value);
    } else {
      out[column] = value;
    }
  }
  return out;
}

/** A single place a scan found something that looks like unredacted material. */
export interface SecretLeak {
  /** Dotted path to the offending value inside the scanned object. */
  readonly path: string;
  /** Why it tripped the scan. Never includes the value itself. */
  readonly reason: string;
}

/**
 * High-entropy / secret-shaped string heuristics. These match the SHAPE of
 * secret material (long base64/hex blobs, `sk-`/bearer prefixes) so a raw secret
 * that slipped past name-based redaction is still caught before a report is
 * emitted. A 64-char lowercase hex string is EXEMPTED because that is exactly an
 * integrity checksum, which is permitted content.
 */
const INTEGRITY_CHECKSUM = /^[0-9a-f]{64}$/;
const SECRET_SHAPES: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\b(?:sk|rk|pk)-[A-Za-z0-9]{16,}/, reason: 'API-key-prefixed token shape' },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/i, reason: 'bearer token shape' },
  { pattern: /\beyJ[A-Za-z0-9._-]{20,}/, reason: 'JWT shape' },
  { pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----/, reason: 'PEM private key' },
];

/** A long unbroken high-entropy blob that is not an allowed integrity checksum. */
function looksLikeRawSecret(value: string): string | null {
  if (INTEGRITY_CHECKSUM.test(value)) return null;
  for (const shape of SECRET_SHAPES) {
    if (shape.pattern.test(value)) return shape.reason;
  }
  // A long unbroken base64url/hex run with no whitespace is secret-shaped.
  if (/^[A-Za-z0-9+/_-]{40,}={0,2}$/.test(value)) return 'high-entropy blob (>=40 chars, no separators)';
  return null;
}

/**
 * Walk `report` and collect anything that looks like raw secret material. A
 * `RedactionMarker` short-circuits its subtree (its `sha256` is an allowed
 * digest). Used by every G6 emit path and asserted empty in the tests, with a
 * seeded secret-bearing fixture row proving the probe actually fires.
 */
/** Leaf-value check: a string secret shape or a raw binary blob, else null. */
function scalarLeak(value: unknown, at: string): SecretLeak | null {
  if (typeof value === 'string') {
    const reason = looksLikeRawSecret(value);
    return reason ? { path: at, reason } : null;
  }
  if (value instanceof Uint8Array) return { path: at, reason: 'raw binary blob in a report' };
  return null;
}

function visitValue(value: unknown, at: string, leaks: SecretLeak[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((element, index) => visitValue(element, `${at}[${index}]`, leaks));
    return;
  }
  if (typeof value === 'object' && !(value instanceof Uint8Array)) {
    const record = value as Record<string, unknown>;
    if (record.redacted === true && typeof record.sha256 === 'string') return; // allowed marker
    for (const [key, child] of Object.entries(record)) visitValue(child, `${at}.${key}`, leaks);
    return;
  }
  const leak = scalarLeak(value, at);
  if (leak) leaks.push(leak);
}

export function scanForSecrets(report: unknown, path = '$'): SecretLeak[] {
  const leaks: SecretLeak[] = [];
  visitValue(report, path, leaks);
  return leaks;
}

/** Throw if `scanForSecrets` finds anything. Used at every emit boundary. */
export function assertNoSecrets(report: unknown, context: string): void {
  const leaks = scanForSecrets(report);
  if (leaks.length > 0) {
    const where = leaks.map((leak) => `${leak.path} (${leak.reason})`).join('; ');
    throw new Error(`${context}: redaction probe found ${leaks.length} possible secret(s): ${where}`);
  }
}
