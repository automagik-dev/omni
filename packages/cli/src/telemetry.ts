/**
 * CLI Error Telemetry via Sentry
 *
 * Lazy-initialised: Sentry is only loaded and configured on first error.
 * Opt-out: set OMNI_TELEMETRY=false or `omni config set telemetry false`.
 * Only errors are captured — successful commands send nothing.
 */

import { arch, platform, release } from 'node:os';
import { loadConfig } from './config.js';
import { VERSION } from './version.js';

/** Same DSN used by the API server */
const OMNI_SENTRY_DSN =
  'https://2b2ca6f407e3d13409aa7dd8d12483f2@o4509714066571264.ingest.us.sentry.io/4510982636371968';

/** Flags whose values must never be sent to Sentry */
const SENSITIVE_FLAGS = new Set([
  '--api-key',
  '--apikey',
  '--token',
  '--password',
  '--secret',
  '--text',
  '--caption',
  '--body',
  '--message',
  '--tts',
]);

/** Whether telemetry is disabled via env var or config */
export function isTelemetryDisabled(): boolean {
  // Env var takes precedence
  const envVal = process.env.OMNI_TELEMETRY;
  if (envVal !== undefined) {
    return envVal.toLowerCase() === 'false' || envVal === '0';
  }

  // Config file
  const config = loadConfig();
  if (config.telemetry === 'false') {
    return true;
  }

  return false;
}

/**
 * Sanitize CLI args by stripping values for sensitive flags.
 * Returns a copy — never mutates the input.
 */
export function sanitizeArgs(argv: string[]): string[] {
  const result: string[] = [];
  let skipNext = false;

  for (let i = 0; i < argv.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const arg = argv[i];

    // Handle --flag=value form
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const flag = arg.slice(0, eqIdx).toLowerCase();
      if (SENSITIVE_FLAGS.has(flag)) {
        result.push(`${arg.slice(0, eqIdx)}=[REDACTED]`);
      } else {
        result.push(arg);
      }
      continue;
    }

    // Handle --flag value form
    if (SENSITIVE_FLAGS.has(arg.toLowerCase())) {
      result.push(arg);
      result.push('[REDACTED]');
      // Skip the next arg (the value)
      skipNext = true;
      continue;
    }

    result.push(arg);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Lazy Sentry initialisation
// ---------------------------------------------------------------------------

/** Minimal type surface for the Sentry API methods we actually use.
 *  @sentry/bun is an optional peer dep loaded at runtime via require(). */
interface SentryLike {
  init(opts: Record<string, unknown>): void;
  setTag(key: string, value: string): void;
  withScope(
    callback: (scope: {
      setTag: (k: string, v: string) => void;
      setContext: (k: string, v: Record<string, unknown>) => void;
    }) => void,
  ): void;
  addBreadcrumb(crumb: Record<string, unknown>): void;
  captureException(error: Error): void;
  flush(timeout: number): Promise<boolean>;
}

let sentryModule: SentryLike | null = null;
let initAttempted = false;

function ensureSentry(): SentryLike | null {
  if (initAttempted) return sentryModule;
  initAttempted = true;

  if (isTelemetryDisabled()) return null;

  const dsn = process.env.SENTRY_DSN ?? OMNI_SENTRY_DSN;
  if (!dsn) return null;

  try {
    // Dynamic require — avoids loading Sentry at startup
    const Sentry = require('@sentry/bun') as SentryLike;

    Sentry.init({
      dsn,
      release: `@automagik/omni-cli@${VERSION}`,
      environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
      sendDefaultPii: false,
      maxBreadcrumbs: 10,
      // No performance tracing for CLI
      tracesSampleRate: 0,
      beforeSend(event: Record<string, unknown>) {
        // Strip server_name (leaks hostname)
        if (event.server_name) {
          event.server_name = undefined;
        }
        return event;
      },
    });

    // Set persistent context
    Sentry.setTag('cli.version', VERSION);
    Sentry.setTag('os.platform', platform());
    Sentry.setTag('os.arch', arch());
    Sentry.setTag('os.release', release());
    Sentry.setTag('runtime', `bun/${process.versions.bun ?? 'unknown'}`);

    sentryModule = Sentry;
    return Sentry;
  } catch {
    // Sentry not available — silently disable
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a CLI error and send it to Sentry.
 * Only initialises Sentry on first call (lazy).
 */
export function captureCliError(error: Error, context?: Record<string, unknown>): void {
  const Sentry = ensureSentry();
  if (!Sentry) return;

  const sanitizedArgs = sanitizeArgs(process.argv.slice(2));

  Sentry.withScope((scope) => {
    scope.setTag('cli.command', sanitizedArgs[0] ?? 'unknown');
    scope.setContext('cli', {
      args: sanitizedArgs.join(' '),
      cwd: process.cwd(),
      nodeVersion: process.version,
      bunVersion: process.versions.bun ?? 'unknown',
    });

    if (context) {
      scope.setContext('extra', context);
    }

    // Add breadcrumb with the full (sanitized) command
    Sentry.addBreadcrumb({
      category: 'cli',
      message: `omni ${sanitizedArgs.join(' ')}`,
      level: 'info',
    });

    Sentry.captureException(error);
  });
}

/**
 * Flush pending Sentry events. Call before process exit.
 * Short timeout — CLI should not hang waiting for Sentry.
 */
export async function flushTelemetry(): Promise<void> {
  if (!sentryModule) return;
  try {
    await sentryModule.flush(2000);
  } catch {
    // Never block CLI exit
  }
}
