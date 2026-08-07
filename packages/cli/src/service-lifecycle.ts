/**
 * Dependency-aware Omni service startup.
 *
 * A process-manager state is not a readiness signal. This module keeps the
 * dependency order explicit and exposes the data-plane probes shared by
 * install, start, and restart.
 */

import { createConnection } from 'node:net';
import postgres from 'postgres';

export const DEPENDENCY_READY_TIMEOUT_MS = 15_000;
const READINESS_POLL_INTERVAL_MS = 250;

export type LifecycleFailurePhase = 'database' | 'nats-start' | 'nats-ready' | 'api-start' | 'api-health';

export type LifecycleResult = { ok: true } | { ok: false; phase: LifecycleFailurePhase };

export interface ServiceStartSteps {
  checkDatabase: () => Promise<boolean>;
  startNats: () => Promise<boolean>;
  checkNats: () => Promise<boolean>;
  startApi: () => Promise<boolean>;
  checkApi: () => Promise<boolean>;
}

const PHASE_MESSAGES: Record<LifecycleFailurePhase, string> = {
  database: 'Database is not ready; no Omni services were changed',
  'nats-start': 'NATS failed to start',
  'nats-ready': 'NATS started but did not become ready',
  'api-start': 'Omni API failed to start',
  'api-health': 'Omni API started but its health check did not pass',
};

export async function runServiceStartSequence(steps: ServiceStartSteps): Promise<LifecycleResult> {
  const phases: Array<[LifecycleFailurePhase, () => Promise<boolean>]> = [
    ['database', steps.checkDatabase],
    ['nats-start', steps.startNats],
    ['nats-ready', steps.checkNats],
    ['api-start', steps.startApi],
    ['api-health', steps.checkApi],
  ];

  for (const [phase, run] of phases) {
    try {
      if (!(await run())) return { ok: false, phase };
    } catch {
      return { ok: false, phase };
    }
  }

  return { ok: true };
}

export function formatLifecycleFailure(result: Exclude<LifecycleResult, { ok: true }>): string {
  return PHASE_MESSAGES[result.phase];
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function waitForTcpReady(
  host: string,
  port: number,
  timeoutMs = DEPENDENCY_READY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  do {
    const remaining = Math.max(1, deadline - Date.now());
    if (await probeTcp(host, port, Math.min(remaining, 1_000))) return true;
    if (Date.now() < deadline) {
      await Bun.sleep(Math.min(READINESS_POLL_INTERVAL_MS, deadline - Date.now()));
    }
  } while (Date.now() < deadline);

  return false;
}

export interface DatabaseReadinessTarget {
  databaseUrl: string;
  host?: string;
  port?: number;
}

export async function waitForDatabaseReady(
  target: DatabaseReadinessTarget,
  timeoutMs = DEPENDENCY_READY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  do {
    let sql: ReturnType<typeof postgres> | undefined;
    try {
      const options: {
        max: number;
        connect_timeout: number;
        idle_timeout: number;
        prepare: boolean;
        onnotice: () => void;
        host?: string;
        port?: number;
      } = {
        max: 1,
        connect_timeout: 1,
        idle_timeout: 1,
        prepare: false,
        onnotice: () => {},
      };
      if (target.host) options.host = target.host;
      if (target.port) options.port = target.port;

      sql = postgres(target.databaseUrl, options);
      await sql`SELECT 1`;
      return true;
    } catch {
      // Retry until the bounded deadline. Callers surface the failure phase.
    } finally {
      await sql?.end({ timeout: 1 }).catch(() => {});
    }

    if (Date.now() < deadline) {
      await Bun.sleep(Math.min(READINESS_POLL_INTERVAL_MS, deadline - Date.now()));
    }
  } while (Date.now() < deadline);

  return false;
}

export function databaseTargetFromRuntimeEnv(env: {
  DATABASE_URL: string;
  PGHOST?: string;
  PGPORT?: string;
}): DatabaseReadinessTarget {
  const parsedPort = Number.parseInt(env.PGPORT ?? '', 10);
  return {
    databaseUrl: env.DATABASE_URL,
    host: env.PGHOST || undefined,
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : undefined,
  };
}

export function tcpTargetFromUrl(rawUrl: string): { host: string; port: number } | null {
  try {
    const url = new URL(rawUrl);
    const port = Number.parseInt(url.port, 10);
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
    return { host: url.hostname, port };
  } catch {
    return null;
  }
}
