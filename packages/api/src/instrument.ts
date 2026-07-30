/**
 * Sentry SDK initialisation for @omni/api.
 *
 * This file MUST be imported before any other module in the entry point
 * (`import './instrument'` as the first line of index.ts) so that Sentry
 * can monkey-patch modules for automatic instrumentation.
 */

import * as Sentry from '@sentry/bun';
import { scrubBreadcrumb, scrubEvent, scrubSpan, scrubTransaction } from './lib/sentry-scrub';

/** Hardcoded production DSN — all Omni instances report here. Set SENTRY_DSN="" to disable. */
const OMNI_SENTRY_DSN =
  'https://2b2ca6f407e3d13409aa7dd8d12483f2@o4509714066571264.ingest.us.sentry.io/4510982636371968';

// Never under `bun test`: this module is a transitive import of anything that
// touches the API entry, and its client is PROCESS-GLOBAL — one test file
// importing it flips `sentryEnabled()` for every file that runs after it
// (order-dependent, CI-only failures) and ships test telemetry to the
// production DSN. Tests that need a client init one explicitly.
const dsn = process.env.NODE_ENV === 'test' ? '' : (process.env.SENTRY_DSN ?? OMNI_SENTRY_DSN);

if (dsn) {
  const tracesSampleRate = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1');

  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE ?? `@omni/api@${getPackageVersion()}`,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    sendDefaultPii: false,
    maxBreadcrumbs: 30,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,

    integrations: [
      Sentry.requestDataIntegration({
        include: {
          ip: false,
          data: false,
          headers: false,
          query_string: false,
          cookies: false,
        },
      }),
      // Hono framework integration — route-level spans with parameterized URLs.
      Sentry.honoIntegration(),
      // Auto-instrument AI SDK calls — captures model, token counts, latency, cost.
      // Prompt/completion content is NOT captured when sendDefaultPii: false.
      Sentry.anthropicAIIntegration(),
      Sentry.openAIIntegration(),
      Sentry.googleGenAIIntegration(),
      // Auto-instrument PostgreSQL queries — captures query duration for slow-query detection.
      // Query parameters are scrubbed by beforeSendSpan.
      Sentry.postgresIntegration(),
    ],

    beforeSend(event) {
      return scrubEvent(event as Parameters<typeof scrubEvent>[0]) as typeof event;
    },

    beforeSendTransaction(event) {
      return scrubTransaction(event as Parameters<typeof scrubTransaction>[0]) as typeof event;
    },

    beforeSendSpan(span) {
      return scrubSpan(span as Parameters<typeof scrubSpan>[0]) as typeof span;
    },

    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb as Parameters<typeof scrubBreadcrumb>[0]) as typeof breadcrumb | null;
    },

    ignoreErrors: ['ECONNRESET', 'ETIMEDOUT', 'socket hang up'],
    ignoreTransactions: ['/healthcheck', '/health', '/favicon.ico', '/metrics'],
  });
}

function getPackageVersion(): string {
  try {
    return require('../package.json').version;
  } catch {
    return 'unknown';
  }
}
