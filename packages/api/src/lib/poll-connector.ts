/**
 * Supervised pull connector (issue #1186).
 *
 * The pull equivalent of a webhook source: omni runs the user's command on an
 * interval, turns each JSON stdout line into an event, and owns the pieces
 * every hand-rolled cron reinvented — scheduling with a known environment,
 * dedup (the source's key template), liveness (heartbeat after a clean run),
 * failure visibility (`lastRun`) and exponential backoff. A non-zero exit —
 * even with empty stdout (`grep` finding nothing) — is a failed run.
 *
 * SECURITY: commands run only from inside `OMNI_POLL_COMMAND_DIR`. Unset means
 * the feature is disabled and every poll config is refused. The command is a
 * path executed directly (no shell, no arguments) with PATH from the API
 * process plus the source's stored env — nothing else from the API env leaks.
 *
 * This module is pure scheduling/execution; the `webhook_sources` reads and
 * writes stay in `WebhookService` (tenancy-db-access-guard).
 */

import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { ValidationError } from '@omni/core';
import type { WebhookPollConfig } from '@omni/db';
import { DEFAULT_IDEMPOTENCY_KEY_TEMPLATE, isValidIdempotencyKeyTemplate } from './ingress-idempotency';
import { z } from './zod-openapi';

/** Default longest backoff (#1240): a broken connector is retried at least hourly. */
const MAX_DELAY_SECONDS = 3_600;
/** Local config errors (allowlist unset, command missing) retry at most this far apart (#1240). */
const CONFIG_ERROR_DELAY_SECONDS = 300;
const STDOUT_TAIL_CHARS = 2_000;
/** A hung command is killed after this long (or its interval, if shorter). */
const MAX_RUN_MS = 10 * 60_000;

export const PollConfigInputSchema = z.object({
  command: z.string().min(1).max(1024),
  intervalSeconds: z.number().int().min(10).max(2_592_000),
  emitType: z
    .string()
    .min(1)
    .max(255)
    .refine((t) => t.startsWith('custom.'), { message: 'emitType must start with "custom."' }),
  dedupKeyTemplate: z
    .string()
    .min(1)
    .max(512)
    .refine(isValidIdempotencyKeyTemplate, { message: 'dedupKeyTemplate needs at least one known {placeholder}' })
    .default(DEFAULT_IDEMPOTENCY_KEY_TEMPLATE),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
  maxBackoffSeconds: z.number().int().min(10).max(86_400).optional(),
});

/** Resolve `command` and refuse anything outside the allowlist directory. Returns the real path. */
export function resolveAllowedCommand(command: string, allowDir = process.env.OMNI_POLL_COMMAND_DIR): string {
  if (!allowDir) {
    throw new ValidationError('Poll connectors are disabled: set OMNI_POLL_COMMAND_DIR to an allowlist directory');
  }
  let real: string;
  let root: string;
  try {
    real = realpathSync(command);
    root = realpathSync(allowDir);
  } catch {
    throw new ValidationError(`Poll command not found: ${command}`);
  }
  if (!real.startsWith(root + sep)) {
    throw new ValidationError(`Poll command must live inside OMNI_POLL_COMMAND_DIR (${root})`);
  }
  return real;
}

/** True when OMNI_POLL_COMMAND_DIR is set to an existing directory — i.e. poll connectors can run (#1239). */
export function isPollAllowlistConfigured(allowDir = process.env.OMNI_POLL_COMMAND_DIR): boolean {
  if (!allowDir) return false;
  try {
    realpathSync(allowDir);
    return true;
  } catch {
    return false;
  }
}

/** Seconds until the next run: the interval, doubled per consecutive failure, capped at `maxBackoffSeconds` (default 1h). */
export function nextDelaySeconds(
  intervalSeconds: number,
  consecutiveFailures: number,
  maxBackoffSeconds = MAX_DELAY_SECONDS,
): number {
  return Math.min(
    intervalSeconds * 2 ** Math.min(consecutiveFailures, 20),
    Math.max(maxBackoffSeconds, intervalSeconds),
  );
}

export function isPollDue(config: WebhookPollConfig, now: Date): boolean {
  return !config.nextRunAt || new Date(config.nextRunAt).getTime() <= now.getTime();
}

/** Ingest one stdout line; resolves true when a new event was published (false = deduped). */
export type PollEmitter = (payload: Record<string, unknown>, rawLine: string) => Promise<boolean>;

/** Emit every non-blank stdout line; each must be a JSON object. Returns the count of new events. */
async function ingestLines(stdout: string, emit: PollEmitter): Promise<number> {
  let emitted = 0;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const payload: unknown = JSON.parse(line);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`stdout line is not a JSON object: ${line.slice(0, 200)}`);
    }
    if (await emit(payload as Record<string, unknown>, line)) emitted++;
  }
  return emitted;
}

/**
 * Run the command once and fold the outcome into the next config state.
 * Never throws: a spawn failure, a bad JSON line, or a rejected event is
 * recorded as a failed run and backs off.
 */
export async function executePoll(
  config: WebhookPollConfig,
  emit: PollEmitter,
  now: () => Date = () => new Date(),
): Promise<WebhookPollConfig> {
  const startedAt = now();
  let exitCode: number | null = null;
  let stdout = '';
  let eventsEmitted = 0;
  let error: string | undefined;
  let configError = false;

  try {
    let command: string;
    try {
      command = resolveAllowedCommand(config.command);
    } catch (err) {
      configError = err instanceof ValidationError;
      throw err;
    }
    const proc = Bun.spawn({
      cmd: [command],
      env: { PATH: process.env.PATH ?? '', ...config.env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const timer = setTimeout(() => proc.kill(), Math.min(config.intervalSeconds * 1000, MAX_RUN_MS));
    [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);

    // ponytail: lines are ingested only on exit 0 — a partial run replays next time and dedup absorbs it.
    if (exitCode === 0) {
      eventsEmitted = await ingestLines(stdout, emit);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ok = exitCode === 0 && !error;
  // A local config error is not a flaky upstream (#1240): retry soon, don't grow the backoff.
  const consecutiveFailures = ok ? 0 : (config.consecutiveFailures ?? 0) + (configError ? 0 : 1);
  const delaySeconds = configError
    ? Math.min(config.intervalSeconds, CONFIG_ERROR_DELAY_SECONDS)
    : nextDelaySeconds(config.intervalSeconds, consecutiveFailures, config.maxBackoffSeconds);
  return {
    ...config,
    consecutiveFailures,
    nextRunAt: new Date(startedAt.getTime() + delaySeconds * 1000).toISOString(),
    lastRun: {
      at: startedAt.toISOString(),
      exitCode,
      stdoutTail: stdout.slice(-STDOUT_TAIL_CHARS),
      eventsEmitted,
      ...(error && { error }),
    },
  };
}
