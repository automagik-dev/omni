/**
 * Redacted tenant fields for audit logs and traces
 * (wish: omni-full-multitenancy, Group G5; ADR-0008; WISH "Async and storage
 * enforcement": "Audit logs/traces include tenant ID and actor credential ID"
 * and "plaintext never appears in ... logs").
 *
 * Two guarantees:
 *
 *   1. Audit logs and traces DO carry the full tenant id and the actor's
 *      credential id — unlike metrics (see ../metrics/tenant-labels), which get
 *      bounded/redacted buckets. Audit surfaces are access-controlled, so the
 *      real identifiers belong there.
 *   2. No secret ever rides along. {@link buildTenantAuditFields} copies ONLY
 *      the three named identifier fields, so a secret sitting in the surrounding
 *      context cannot leak through it; {@link redactSecrets} is the
 *      defence-in-depth scrubber for the broader metadata bags that logging
 *      sometimes attaches.
 *
 * External request-id correlation uses the edge `requestId` (Hono
 * `c.get('requestId')`), never the auth-plane `context.requestId` (the G4 leg-2
 * cross-tenant-DoS fix): that internal id is per-auth-construction and must not
 * become an external correlation handle. The edge id is treated strictly as an
 * opaque correlation label here — it is never used to select a tenant or make
 * an authorization decision.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identity field names that must ALWAYS survive redaction, checked BEFORE the
 * secret-key denylist below. The denylist is deliberately broad (it now catches
 * bare `key`, `token`, `credentials`, …), which would otherwise clip these
 * required identity fields — notably `actorCredentialId` (contains `credential`)
 * and any future `key`/`token`-ish identity name. This preserve-list makes
 * identity win by construction: no matter how the denylist grows, these exact
 * keys pass through untouched. Matched exactly (case-sensitive canonical names).
 */
const PRESERVE_KEYS: ReadonlySet<string> = new Set(['tenantId', 'actorCredentialId', 'requestId', 'instanceId']);

/**
 * Substrings whose presence in a metadata KEY marks the value a secret. Curated
 * to fail closed (over-scrubbing a metadata field is safe; under-scrubbing a
 * secret is not). It is intentionally broad — including bare `key`, `token`,
 * `credentials`, `jwt` — because a secret can hide under a terse key. The
 * required identity fields are NOT protected by careful substring exclusion here
 * (that is brittle as the list grows); they are protected by {@link PRESERVE_KEYS}
 * which is consulted first. Matched case-insensitively.
 */
const SECRET_KEY_SUBSTRINGS: readonly string[] = [
  'secret',
  'password',
  'passwd',
  'apikey',
  'api_key',
  'api-key',
  'privatekey',
  'private_key',
  'private-key',
  'plaintext',
  'plain_text',
  'plain-text',
  'bearer',
  'authorization',
  'auth_token',
  'authtoken',
  'access_key',
  'accesskey',
  'signing_key',
  'session_secret',
  'session_key',
  'webhook_secret',
  'keyhash',
  'key_hash',
  'cookie',
  'signature',
  'token',
  'refresh_token',
  'key',
  'credentials',
  'jwt',
];

/**
 * Value-shaped secret markers. Even under an innocuous key, a value that looks
 * like a minted platform secret is scrubbed. Kept intentionally narrow so it
 * only fires on unambiguous secret material.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [/omni_sk_/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

/** JWT shape: three non-empty base64url segments joined by dots (`header.payload.signature`). */
const JWT_VALUE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** The placeholder a scrubbed field is replaced with is: nothing — the key is dropped. */
function keyIsSecret(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

/**
 * High-entropy token heuristic: a long, dense string drawn from a token alphabet
 * that mixes letters and digits (e.g. a third-party `sk-…`, an opaque bearer or
 * session token). Deliberately fail-closed. Short, human-readable, or structured
 * values (UUIDs, dotted actions, URLs with `:`/spaces) do not match.
 */
function looksLikeHighEntropyToken(value: string): boolean {
  if (value.length < 24) return false;
  // Token alphabet only — reject spaces, ':' (URLs), and other prose punctuation.
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(value)) return false;
  return /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

function valueLooksSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Identity ids are UUIDs (tenantId, actorCredentialId): short and structured —
  // never secret material. Exempt them so the entropy heuristic cannot clip them.
  if (UUID.test(value)) return false;
  if (SECRET_VALUE_PATTERNS.some((re) => re.test(value))) return true;
  if (JWT_VALUE.test(value)) return true;
  return looksLikeHighEntropyToken(value);
}

/**
 * Return a shallow copy of `metadata` with every secret-shaped entry removed
 * (dropped, not masked-in-place — a masked value is still a value that a later
 * formatter can mishandle). An entry is dropped when its key names a secret or
 * its value looks like minted secret material. {@link PRESERVE_KEYS} identity
 * fields are always kept, checked before the denylist so identity always wins.
 */
export function redactSecrets(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (PRESERVE_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    if (keyIsSecret(key)) continue;
    if (valueLooksSecret(value)) continue;
    out[key] = value;
  }
  return out;
}

/** The identity fields every tenant-context audit log / trace carries. */
export interface TenantAuditFields {
  /** Full tenant UUID. Audit/trace surfaces are access-controlled, so this is the real id, not a bucket. */
  readonly tenantId: string;
  /** The acting credential's id (never its secret/hash). */
  readonly actorCredentialId: string;
  /** Edge correlation id (Hono `c.get('requestId')`); optional. */
  readonly requestId?: string;
}

export interface TenantAuditFieldsInput {
  readonly tenantId: string;
  readonly actorCredentialId: string;
  readonly requestId?: string;
}

/**
 * Assemble the identity fields for a tenant-context audit log or trace.
 *
 * Copies ONLY `tenantId`, `actorCredentialId`, and (when present) `requestId`,
 * so any secret in the caller's surrounding context cannot pass through. Throws
 * when the tenant id is not a well-formed UUID or the actor credential id is
 * empty — a malformed identity must never reach an audit sink silently.
 */
export function buildTenantAuditFields(input: TenantAuditFieldsInput): TenantAuditFields {
  if (typeof input.tenantId !== 'string' || !UUID.test(input.tenantId)) {
    throw new Error('tenant-observability: tenantId must be a well-formed UUID');
  }
  if (typeof input.actorCredentialId !== 'string' || input.actorCredentialId.length === 0) {
    throw new Error('tenant-observability: actorCredentialId must be a non-empty string');
  }
  const fields: TenantAuditFields = {
    tenantId: input.tenantId,
    actorCredentialId: input.actorCredentialId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
  return fields;
}

/**
 * OTEL-style dotted identity keys. A hostile bag can smuggle these past the
 * camelCase identity merge (they are not secrets and not same-named), leaving a
 * spoofed `tenant.id` sitting beside the validated `tenantId`. They are stripped
 * so only the validated identity is ever present in the record.
 */
const DOTTED_IDENTITY_KEYS: readonly string[] = ['tenant.id', 'actor.credential_id', 'request.id'];

/**
 * Build a complete audit/trace record: the validated identity fields merged
 * over a redacted copy of an optional extra metadata bag. The identity fields
 * are applied LAST, so a hostile bag cannot spoof `tenantId` (or any identity
 * field) and no secret in the bag survives the {@link redactSecrets} pass. Any
 * OTEL-style dotted identity key ({@link DOTTED_IDENTITY_KEYS}) in the bag is
 * dropped so it cannot coexist with — and be mistaken for — the validated id.
 */
export function buildTenantAuditRecord(
  input: TenantAuditFieldsInput,
  extraMetadata: Record<string, unknown> = {},
): Record<string, unknown> {
  const identity = buildTenantAuditFields(input);
  const scrubbed = redactSecrets(extraMetadata);
  for (const dotted of DOTTED_IDENTITY_KEYS) delete scrubbed[dotted];
  return { ...scrubbed, ...identity };
}

/**
 * Render the identity fields as OpenTelemetry-style span attributes. Keys use
 * the OTEL dotted convention (`tenant.id`, `actor.credential_id`, `request.id`).
 */
export function tenantTraceAttributes(fields: TenantAuditFields): Record<string, string> {
  return {
    'tenant.id': fields.tenantId,
    'actor.credential_id': fields.actorCredentialId,
    ...(fields.requestId ? { 'request.id': fields.requestId } : {}),
  };
}
