/** Startup repair is best-effort; health keeps its failure visible until the next boot. */
import { createLogger } from '@omni/core';
import type { HealthCheck } from './types';

const log = createLogger('agent-key-reconciliation');
let repairFailed = false;

function logRepairFailure(error: unknown): void {
  log.error('Agent key repair failed; continuing startup. Restart Omni to retry the repair.', {
    error: String(error),
    cause: error instanceof Error && error.cause !== undefined ? String(error.cause) : undefined,
  });
}

export async function runStartupAgentKeyRepair(
  repair: () => Promise<void>,
  reportFailure: (error: unknown) => void = logRepairFailure,
): Promise<void> {
  try {
    await repair();
    repairFailed = false;
  } catch (error) {
    repairFailed = true;
    reportFailure(error);
  }
}

export function getAgentKeyRepairHealth(): HealthCheck {
  return repairFailed
    ? { status: 'error', error: 'Agent key repair failed. Restart Omni to retry the repair.' }
    : { status: 'ok' };
}
