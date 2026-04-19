/**
 * Output redactor middleware — scrubs outbound message bodies against a
 * per-profile denylist before delivery.
 *
 * Layering:
 *   - This is NOT a scope — scopes gate "can I make this API call";
 *     redaction gates "what can the response contain". Different layer.
 *   - Runs AFTER auth + scope enforcement, BEFORE the send-route handler.
 *   - Only touches POST/PUT send routes (see SEND_ROUTE_PREFIXES).
 *
 * Denylist resolution per request:
 *   1. Resolve preset key: apiKey.profileOverrides.denylistPresetKey ??
 *      PROFILES[apiKey.profile].defaultOverrides.denylistPresetKey ?? null
 *   2. Load compiled patterns for that preset from the startup-compiled map
 *      (populated from `OMNI_DENYLIST_PRESETS` env / tenant config).
 *   3. Append per-key `profile_overrides.denylistExtras` as extra literal
 *      patterns. Extras are compiled per-request (small cardinality).
 *
 * Profile bypass:
 *   - `admin` profile is bypassed (god key; redactor off by design).
 *   - No profile (legacy keys) → no redaction.
 *   - Profile with no resolvable preset key AND no extras → no-op.
 *
 * Mutation strategy:
 *   Hono's `c.req.json()` re-parses `bodyCache.text` on each call and does
 *   not cache parsed objects — so mutating the object returned to the
 *   middleware does NOT propagate. We replace `bodyCache.text` with the
 *   redacted JSON string; downstream `c.req.json()` calls then observe the
 *   redacted body. `bodyCache.json` (if any adapter set it) is cleared.
 *
 * Event emission:
 *   One `secret.redacted` event per matched pattern per request, with the
 *   pattern source, field path, hit count, key id, and request id in the
 *   payload. Events are best-effort (errors are logged, not raised).
 */

import { createLogger } from '@omni/core';
import type { EventType } from '@omni/core';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { COWORKER_DEFAULT_DENYLIST_PRESET_KEY, PROFILES } from '../constants/profiles';
import type { ApiKeyData, AppVariables } from '../types';

const log = createLogger('api:output-redactor');

/** Path prefixes (after /api/v2 stripping) that this middleware redacts. */
const SEND_ROUTE_PREFIXES = ['/messages/send'];

/** Replacement token for a matched pattern. */
export const REDACTION_MARKER = '[redacted]';

/**
 * Audit event name emitted on every redaction hit. Not in CORE_EVENT_TYPES —
 * `publishGeneric` is the right call for runtime-validated audit events.
 * Cast at the call site; the runtime name is the contract.
 */
export const SECRET_REDACTED_EVENT = 'secret.redacted' as EventType;

/** Max body size to redact (bytes). Above this, skip — oversized bodies should be rejected by body-limit. */
const MAX_REDACT_BYTES = 64 * 1024;

export interface CompiledPattern {
  /** The original (user-supplied) literal source. */
  source: string;
  /** Case-insensitive compiled regex (literal source, regex-escaped). */
  regex: RegExp;
}

/**
 * Startup-compiled preset registry. Populated from the `OMNI_DENYLIST_PRESETS`
 * env variable (or tenant config in future work). The env is expected to be a
 * JSON object: `{ "<presetKey>": ["literal-1", "literal-2", ...] }`.
 */
let presetRegistry: Map<string, CompiledPattern[]> | null = null;

/** Escape a literal string for safe use inside a RegExp. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile a list of literal strings into case-insensitive regexes. */
export function compilePatterns(literals: readonly string[]): CompiledPattern[] {
  const out: CompiledPattern[] = [];
  for (const literal of literals) {
    if (typeof literal !== 'string' || literal.length === 0) continue;
    try {
      out.push({ source: literal, regex: new RegExp(escapeRegex(literal), 'gi') });
    } catch (err) {
      log.warn('output-redactor: failed to compile pattern, skipping', { literal, error: String(err) });
    }
  }
  return out;
}

/**
 * Parse the preset map from a raw string (env value or tenant config). Returns
 * an empty map for null / malformed input and logs the parse error.
 */
export function parsePresetMap(raw: string | null | undefined): Map<string, CompiledPattern[]> {
  const map = new Map<string, CompiledPattern[]>();
  if (!raw || !raw.trim()) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('output-redactor: OMNI_DENYLIST_PRESETS is not valid JSON — ignoring', { error: String(err) });
    return map;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    log.warn('output-redactor: OMNI_DENYLIST_PRESETS must be a JSON object');
    return map;
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    map.set(key, compilePatterns(value.filter((v): v is string => typeof v === 'string')));
  }
  return map;
}

/**
 * Load the preset registry once. Subsequent calls return the memoized map.
 * Tests can reset via `resetPresetRegistryForTests()`.
 */
export function loadPresetRegistry(): Map<string, CompiledPattern[]> {
  if (presetRegistry) return presetRegistry;
  presetRegistry = parsePresetMap(process.env.OMNI_DENYLIST_PRESETS ?? null);
  return presetRegistry;
}

/** Test-only: clear the cached registry so the next `loadPresetRegistry()` re-reads env. */
export function resetPresetRegistryForTests(): void {
  presetRegistry = null;
}

/** Test-only: inject a precompiled registry, bypassing env parsing. */
export function setPresetRegistryForTests(map: Map<string, CompiledPattern[]>): void {
  presetRegistry = map;
}

/**
 * Resolve the effective denylist preset key for a key. Tenant overrides win,
 * falling back to the profile template's default. Admin is always null.
 */
export function resolvePresetKey(apiKey: ApiKeyData): string | null {
  if (!apiKey.profile) return null;
  if (apiKey.profile === 'admin') return null;
  const override = apiKey.profileOverrides?.denylistPresetKey;
  if (typeof override === 'string' && override.length > 0) return override;
  const template = PROFILES[apiKey.profile];
  const def = template?.defaultOverrides?.denylistPresetKey;
  if (typeof def === 'string' && def.length > 0) return def;
  // Coworker has a well-known default that lives outside the template when
  // defaults are not explicit (defensive: keeps behaviour even if the template
  // file drifts).
  if (apiKey.profile === 'coworker') return COWORKER_DEFAULT_DENYLIST_PRESET_KEY;
  return null;
}

/**
 * Build the effective compiled pattern list for a key (preset + extras).
 * Returns an empty list when nothing applies (admin, legacy key, unknown preset).
 */
export function resolvePatternsForKey(apiKey: ApiKeyData): CompiledPattern[] {
  if (!apiKey.profile || apiKey.profile === 'admin') return [];
  const registry = loadPresetRegistry();
  const presetKey = resolvePresetKey(apiKey);
  const presetPatterns = presetKey ? (registry.get(presetKey) ?? []) : [];
  const extras = apiKey.profileOverrides?.denylistExtras;
  if (!extras || extras.length === 0) return presetPatterns;
  return [...presetPatterns, ...compilePatterns(extras)];
}

/** A single redaction hit — used for event emission + telemetry. */
export interface RedactionHit {
  pattern: string;
  field: string;
  count: number;
}

/** Internal mutable state threaded through the walker. */
interface RedactionState {
  patterns: readonly CompiledPattern[];
  hits: RedactionHit[];
  hitIndex: Map<string, RedactionHit>;
}

function recordHit(state: RedactionState, patternSource: string, field: string, count: number): void {
  if (count <= 0) return;
  const key = `${patternSource}\0${field}`;
  const existing = state.hitIndex.get(key);
  if (existing) {
    existing.count += count;
    return;
  }
  const hit: RedactionHit = { pattern: patternSource, field, count };
  state.hitIndex.set(key, hit);
  state.hits.push(hit);
}

function redactStringValue(state: RedactionState, value: string, field: string): string {
  let out = value;
  for (const p of state.patterns) {
    p.regex.lastIndex = 0;
    let count = 0;
    out = out.replace(p.regex, () => {
      count++;
      return REDACTION_MARKER;
    });
    recordHit(state, p.source, field, count);
  }
  return out;
}

function handleArrayNode(state: RedactionState, arr: unknown[], field: string): void {
  for (let i = 0; i < arr.length; i++) {
    const childField = `${field}.${i}`;
    const child = arr[i];
    if (typeof child === 'string') {
      const redacted = redactStringValue(state, child, childField);
      if (redacted !== child) arr[i] = redacted;
      continue;
    }
    walkNode(state, child, childField);
  }
}

function handleObjectNode(state: RedactionState, obj: Record<string, unknown>, field: string): void {
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) return; // Date, Error, RegExp, etc.
  for (const [k, v] of Object.entries(obj)) {
    const childField = field ? `${field}.${k}` : k;
    if (typeof v === 'string') {
      const redacted = redactStringValue(state, v, childField);
      if (redacted !== v) obj[k] = redacted;
      continue;
    }
    walkNode(state, v, childField);
  }
}

function walkNode(state: RedactionState, node: unknown, field: string): void {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    handleArrayNode(state, node, field);
    return;
  }
  handleObjectNode(state, node as Record<string, unknown>, field);
}

/**
 * Walk `body` recursively, replacing matches of each compiled pattern in every
 * string value with `REDACTION_MARKER`. Returns the hit list for event emission.
 *
 * The input is mutated in place — the caller is responsible for re-serialising
 * if needed. Skips non-plain objects (Date, RegExp, etc.); numeric indices in
 * arrays are tracked as `parent.N` in `field` for debuggability.
 */
export function redactBodyInPlace(body: unknown, patterns: readonly CompiledPattern[]): RedactionHit[] {
  const state: RedactionState = { patterns, hits: [], hitIndex: new Map() };
  if (patterns.length === 0) return state.hits;
  walkNode(state, body, '');
  return state.hits;
}

function cleanPath(rawPath: string): string {
  const stripped = rawPath.replace(/^\/api\/v2/, '');
  return stripped.endsWith('/') && stripped.length > 1 ? stripped.slice(0, -1) : stripped;
}

function isSendRoute(rawPath: string): boolean {
  const p = cleanPath(rawPath);
  return SEND_ROUTE_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * Replace Hono's cached request text with the redacted payload so downstream
 * `c.req.json()` calls observe the scrubbed body. Deletes any pre-parsed
 * JSON cache entry that an adapter might have populated.
 */
function replaceCachedBody(c: Context<{ Variables: AppVariables }>, redactedJson: string): void {
  const req = c.req as unknown as { bodyCache?: Record<string, unknown> };
  if (!req.bodyCache) req.bodyCache = {};
  req.bodyCache.text = Promise.resolve(redactedJson);
  // Clear any sibling caches Hono may read (defensive — keys include json/arrayBuffer/blob).
  req.bodyCache.json = undefined;
  req.bodyCache.arrayBuffer = undefined;
  req.bodyCache.blob = undefined;
  req.bodyCache.parsedBody = undefined;
}

async function emitRedactionEvents(
  c: Context<{ Variables: AppVariables }>,
  apiKey: ApiKeyData,
  presetKey: string | null,
  hits: readonly RedactionHit[],
): Promise<void> {
  const eventBus = c.get('eventBus');
  if (!eventBus) return;
  const requestId = c.get('requestId');
  for (const hit of hits) {
    try {
      await eventBus.publishGeneric(SECRET_REDACTED_EVENT, {
        keyId: apiKey.id,
        profile: apiKey.profile ?? null,
        presetKey,
        pattern: hit.pattern,
        field: hit.field,
        count: hit.count,
        route: c.req.path,
        requestId: requestId ?? null,
      });
    } catch (err) {
      log.warn('output-redactor: failed to publish secret.redacted', {
        keyId: apiKey.id,
        pattern: hit.pattern,
        error: String(err),
      });
    }
  }
}

export const outputRedactorMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT') return next();

  if (!isSendRoute(c.req.path)) return next();

  const apiKey = c.get('apiKey');
  if (!apiKey) return next();

  // Admin bypass — explicit and logged at debug level to keep audit trail readable.
  if (apiKey.profile === 'admin') {
    log.debug('output-redactor: admin bypass', { keyId: apiKey.id });
    return next();
  }

  const patterns = resolvePatternsForKey(apiKey);
  if (patterns.length === 0) return next();

  const contentType = (c.req.header('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) return next();

  let bodyText: string;
  try {
    bodyText = await c.req.text();
  } catch {
    return next();
  }
  if (!bodyText) return next();
  if (bodyText.length > MAX_REDACT_BYTES) {
    log.warn('output-redactor: body exceeds MAX_REDACT_BYTES, skipping', {
      keyId: apiKey.id,
      bytes: bodyText.length,
    });
    return next();
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return next();
  }

  const hits = redactBodyInPlace(body, patterns);
  if (hits.length === 0) return next();

  const redactedJson = JSON.stringify(body);
  replaceCachedBody(c, redactedJson);

  const presetKey = resolvePresetKey(apiKey);
  // Event emission is fire-and-forget to avoid blocking the send path.
  void emitRedactionEvents(c, apiKey, presetKey, hits);

  return next();
});
