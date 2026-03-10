/**
 * PII scrubbing utilities for Sentry integration.
 *
 * All Sentry hooks (beforeSend, beforeSendTransaction, beforeBreadcrumb)
 * delegate to these pure functions so PII never leaves the process.
 */

// ---------------------------------------------------------------------------
// Local Sentry-compatible interfaces (avoids importing @sentry/bun before it
// is installed in Group 2).
// ---------------------------------------------------------------------------

export interface SentryException {
  type?: string;
  value?: string;
  mechanism?: Record<string, unknown>;
}

export interface SentryBreadcrumb {
  type?: string;
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  level?: string;
  timestamp?: number;
}

export interface SentrySpan {
  op?: string;
  description?: string;
  data?: Record<string, unknown>;
}

export interface SentryRequest {
  url?: string;
  query_string?: string;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface SentryEvent {
  event_id?: string;
  message?: string;
  server_name?: string;
  transaction?: string;
  exception?: { values?: SentryException[] };
  breadcrumbs?: SentryBreadcrumb[];
  contexts?: Record<string, Record<string, unknown>>;
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  request?: SentryRequest;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Phone numbers: optional +, 10-15 digits */
const PHONE_RE = /\+?\b\d{10,15}\b/g;

/** WhatsApp JIDs: digits@s.whatsapp.net or @c.whatsapp.net */
const JID_RE = /\d+@[sc]\.whatsapp\.net/g;

/** Email addresses (simplified but practical) */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** UUID v4 (and similar hex-dash patterns) */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// ---------------------------------------------------------------------------
// Core scrubber
// ---------------------------------------------------------------------------

/**
 * Replace PII tokens in a plain string.
 *
 * Order matters:
 * 1. UUIDs are preserved first (their trailing hex-digit segments would
 *    otherwise match the phone pattern).
 * 2. JIDs must be matched before phones so that the digit prefix of a JID
 *    isn't partially replaced by the phone pattern.
 */
export function scrubPii(text: string): string {
  // Temporarily shelter UUIDs from the phone regex
  const uuids: string[] = [];
  let result = text.replace(UUID_RE, (match) => {
    uuids.push(match);
    return `<<UUID${uuids.length - 1}>>`;
  });

  result = result.replace(JID_RE, '[jid]').replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');

  // Restore UUIDs
  return result.replace(/<<UUID(\d+)>>/g, (_, idx) => uuids[Number(idx)] ?? '');
}

// ---------------------------------------------------------------------------
// Deep object scrubber
// ---------------------------------------------------------------------------

/** Recursively walk an object and scrub all string values. */
function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubPii(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Sentry event scrubber (beforeSend)
// ---------------------------------------------------------------------------

export function scrubEvent(event: SentryEvent): SentryEvent {
  // Strip server_name (leaks hostname / infra topology)
  const { server_name: _, ...rest } = event;
  const scrubbed = { ...rest };

  if (scrubbed.tags) {
    const { server_name: __, ...cleanTags } = scrubbed.tags;
    const scrubbedTags: Record<string, string> = {};
    for (const [k, v] of Object.entries(cleanTags)) {
      scrubbedTags[k] = scrubPii(v);
    }
    scrubbed.tags = scrubbedTags;
  }

  // Exception values
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((ex) => ({
        ...ex,
        value: ex.value ? scrubPii(ex.value) : ex.value,
      })),
    };
  }

  // Message
  if (scrubbed.message) {
    scrubbed.message = scrubPii(scrubbed.message);
  }

  // Contexts
  if (scrubbed.contexts) {
    scrubbed.contexts = scrubValue(scrubbed.contexts) as typeof scrubbed.contexts;
  }

  // Extra
  if (scrubbed.extra) {
    scrubbed.extra = scrubValue(scrubbed.extra) as typeof scrubbed.extra;
  }

  // Breadcrumbs (inline — scrubBreadcrumb is also exported for the hook)
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb).filter((b): b is SentryBreadcrumb => b !== null);
  }

  // Request
  if (scrubbed.request) {
    scrubbed.request = {
      ...scrubbed.request,
      url: scrubbed.request.url ? scrubPii(scrubbed.request.url) : scrubbed.request.url,
      query_string: scrubbed.request.query_string
        ? scrubPii(scrubbed.request.query_string)
        : scrubbed.request.query_string,
    };
  }

  return scrubbed;
}

// ---------------------------------------------------------------------------
// Transaction name scrubber (beforeSendTransaction)
// ---------------------------------------------------------------------------

/**
 * Parameterize transaction names so high-cardinality PII doesn't create
 * unbounded transaction groups in Sentry.
 */
export function scrubTransaction(event: SentryEvent): SentryEvent {
  if (!event.transaction) return event;

  let tx = event.transaction;
  tx = tx.replace(JID_RE, ':jid');
  tx = tx.replace(UUID_RE, ':uuid');
  tx = tx.replace(PHONE_RE, ':phone');

  return { ...event, transaction: tx };
}

// ---------------------------------------------------------------------------
// Breadcrumb scrubber (beforeBreadcrumb)
// ---------------------------------------------------------------------------

/** Pattern that hints at message body content (not metadata). */
const MESSAGE_BODY_RE = /\b(messageContent|body|text|caption|description)\s*[:=]\s*["'`]/i;

/**
 * Scrub a single breadcrumb. Returns `null` to drop the breadcrumb entirely
 * (e.g. when it embeds raw message content).
 */
export function scrubBreadcrumb(breadcrumb: SentryBreadcrumb): SentryBreadcrumb | null {
  // Drop breadcrumbs that look like they contain message body content
  if (breadcrumb.message && MESSAGE_BODY_RE.test(breadcrumb.message)) {
    return null;
  }

  const scrubbed = { ...breadcrumb };

  if (scrubbed.message) {
    scrubbed.message = scrubPii(scrubbed.message);
  }

  // Console breadcrumbs carry arbitrary data
  if (scrubbed.data) {
    scrubbed.data = scrubValue(scrubbed.data) as Record<string, unknown>;
  }

  return scrubbed;
}

// ---------------------------------------------------------------------------
// Span scrubber
// ---------------------------------------------------------------------------

/**
 * Scrub PII from span descriptions and data (db.statement, http.url, etc.).
 */
export function scrubSpan(span: SentrySpan): SentrySpan {
  const scrubbed = { ...span };

  if (scrubbed.description) {
    scrubbed.description = scrubPii(scrubbed.description);
  }

  if (scrubbed.data) {
    scrubbed.data = { ...scrubbed.data };

    if (typeof scrubbed.data['db.statement'] === 'string') {
      scrubbed.data['db.statement'] = scrubPii(scrubbed.data['db.statement']);
    }

    if (typeof scrubbed.data['http.url'] === 'string') {
      scrubbed.data['http.url'] = scrubPii(scrubbed.data['http.url']);
    }
  }

  return scrubbed;
}

// ---------------------------------------------------------------------------
// Guard helper
// ---------------------------------------------------------------------------

/**
 * Returns true when a Sentry client is initialised and capturing events.
 *
 * Uses Bun's global require() for lazy loading — @sentry/bun is always
 * installed but we avoid a top-level import to prevent circular dependency
 * with instrument.ts which imports scrub functions from this file.
 */
export function sentryEnabled(): boolean {
  try {
    return !!require('@sentry/bun').getClient();
  } catch {
    return false;
  }
}
