/**
 * Ingress idempotency key derivation (#958, RFC #925 G2).
 *
 * A webhook provider that redelivers (GitHub does, on any non-2xx or timeout)
 * must not create a second event: `WebhookService.receive()` derives a key
 * from the SOURCE's identity via the source's `idempotency_key_template` and
 * claims it by inserting the journal row — the `omni_events.idempotency_key`
 * unique index is the dedup authority, not application logic. A collision
 * means redelivery: the emitter is acked (200) so it stops retrying, and no
 * event enters the system.
 *
 * SCOPE BOUNDARY (dogfood evidence, RFC #925): this solves REDELIVERY, not
 * semantic identity. One real-world charge arriving as receipt +
 * card-approval + invoice emails carries three distinct provider message ids
 * and is three events BY DESIGN. Business-level dedup (merchant+amount+day)
 * is the consumer's contract, not the transport's — do not try to encode it
 * in a key template.
 *
 * Template grammar (one placeholder form, resolved left to right):
 *   {source}          the webhook source name
 *   {sha256(body)}    hex SHA-256 of the raw request body bytes
 *   {headers.<name>}  a request header (case-insensitive)
 *   {payload.<path>}  a dot-path into the JSON payload; scalars only
 *
 * Examples:
 *   github:  "github:{headers.x-github-delivery}"
 *   clickup: "clickup:{payload.event_id}"
 *   slack:   "slack:{payload.team_id}:{payload.event.channel}:{payload.event.event_ts}"
 *   default: "{source}:{sha256(body)}"  (existing sources migrate onto this)
 *
 * A placeholder that does not resolve to a non-empty scalar (missing header,
 * absent payload path, object value) makes the whole template unresolvable
 * and the derivation FALLS BACK to the body-hash default. Falling back keeps
 * dedup correct-by-content instead of either dropping the delivery or
 * colliding every keyless delivery on one literal string.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@omni/core';

const log = createLogger('api:ingress-idempotency');

/** Applied to sources created before templates existed (migration default). */
export const DEFAULT_IDEMPOTENCY_KEY_TEMPLATE = '{source}:{sha256(body)}';

/**
 * Longest key we store as-is. Longer resolved keys are collapsed to a hash so
 * a pathological template value can't blow up the unique index. 512 is far
 * above any provider delivery id and well under the btree key ceiling.
 */
const MAX_KEY_LENGTH = 512;

const PLACEHOLDER_RE = /\{([^{}]+)\}/g;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Resolve a dot-path into the payload; only non-empty scalars are usable. */
function resolvePayloadPath(payload: Record<string, unknown>, path: string): string | undefined {
  let current: unknown = payload;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'string') return current.length > 0 ? current : undefined;
  if (typeof current === 'number' || typeof current === 'boolean') return String(current);
  return undefined;
}

export interface DeriveIdempotencyKeyInput {
  /** Source's `idempotency_key_template`. */
  template: string;
  /** Webhook source name (fills `{source}` and prefixes the fallback key). */
  sourceName: string;
  /** Raw request body bytes as received (hashed for `{sha256(body)}`). */
  rawBody: string;
  /** Parsed JSON payload (for `{payload.*}`). */
  payload: Record<string, unknown>;
  /** Request headers, lowercase keys (for `{headers.*}`). */
  headers: Record<string, string>;
}

/**
 * Derive the delivery-identity key for one webhook request. Total: the same
 * request always derives the same key, and the result is never empty.
 */
export function deriveIdempotencyKey(input: DeriveIdempotencyKeyInput): string {
  const { template, sourceName, rawBody, payload, headers } = input;

  let unresolved: string | null = null;
  const resolved = template.replace(PLACEHOLDER_RE, (whole, rawExpr: string) => {
    const expr = rawExpr.trim();
    if (expr === 'source') return sourceName;
    if (expr === 'sha256(body)') return sha256Hex(rawBody);
    if (expr.startsWith('headers.')) {
      const value = headers[expr.slice('headers.'.length).toLowerCase()];
      if (value) return value;
    } else if (expr.startsWith('payload.')) {
      const value = resolvePayloadPath(payload, expr.slice('payload.'.length));
      if (value !== undefined) return value;
    }
    unresolved = whole;
    return whole;
  });

  if (unresolved !== null) {
    log.warn('idempotency template placeholder unresolved, falling back to body hash', {
      sourceName,
      template,
      placeholder: unresolved,
    });
    return `${sourceName}:${sha256Hex(rawBody)}`;
  }

  if (resolved.length > MAX_KEY_LENGTH) {
    return `${sourceName}:overflow:${sha256Hex(resolved)}`;
  }
  return resolved;
}

/**
 * Boundary validation shared by the OpenAPI schema: a template must be
 * non-empty, bounded, and carry at least one placeholder — a pure literal
 * would collide EVERY delivery of the source into one "duplicate".
 */
export function isValidIdempotencyKeyTemplate(template: string): boolean {
  if (template.length === 0 || template.length > 500) return false;
  PLACEHOLDER_RE.lastIndex = 0;
  return PLACEHOLDER_RE.test(template);
}
