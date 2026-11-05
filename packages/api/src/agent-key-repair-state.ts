/** Startup repair is best-effort; health keeps its failure visible until the next boot. */
import { createLogger } from '@omni/core';
import { unwrapDbError } from '@omni/db';
import type { AgentWithoutKey } from './services/agent-key-reconciliation';
import type { HealthCheck } from './types';

const log = createLogger('agent-key-reconciliation');
let repairFailed = false;
let agentsWithoutKey: number | null = null;

function errorFields(error: unknown): { code?: string; message: string } {
  // Drizzle's wrapper message contains SQL and bound parameters. Log only the
  // driver's code/message, never String(wrapper), params, detail, or stack.
  const cause = unwrapDbError(error);
  if (cause instanceof Error) {
    const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
    return { code, message: cause.message };
  }
  return { message: 'Unknown repair error' };
}

function logRepairFailure(error: unknown, missing: AgentWithoutKey[] | null, coverageError?: unknown): void {
  log.error('Agent key repair failed; continuing startup. Restart Omni to retry the repair.', {
    ...errorFields(error),
    agentsWithoutKey,
    agents: missing?.map((agent) => agent.name),
    coverageError: coverageError === undefined ? undefined : errorFields(coverageError),
  });
}

type RepairOptions = {
  inspectMissingAgents?: () => Promise<AgentWithoutKey[]>;
  reportFailure?: (error: unknown, missing: AgentWithoutKey[] | null, coverageError?: unknown) => void;
};

export async function runStartupAgentKeyRepair(
  repair: () => Promise<void>,
  options: RepairOptions = {},
): Promise<void> {
  try {
    await repair();
    repairFailed = false;
    agentsWithoutKey = null;
  } catch (error) {
    repairFailed = true;
    let missing: AgentWithoutKey[] | null = null;
    let coverageError: unknown;
    try {
      missing = options.inspectMissingAgents ? await options.inspectMissingAgents() : null;
    } catch (error) {
      coverageError = error;
    }
    agentsWithoutKey = missing?.length ?? null;
    (options.reportFailure ?? logRepairFailure)(error, missing, coverageError);
  }
}

export function getAgentKeyRepairHealth(): HealthCheck {
  return repairFailed
    ? {
        status: 'error',
        error: 'Agent key repair failed. Restart Omni to retry the repair.',
        details: { agentsWithoutKey },
      }
    : { status: 'ok' };
}
