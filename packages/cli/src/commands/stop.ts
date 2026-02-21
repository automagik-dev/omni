/**
 * Stop Command
 *
 * omni stop — Stop all omni PM2 processes (including legacy names)
 */

import { Command } from 'commander';
import * as output from '../output.js';
import { PM2_PROCESSES, isPm2Available, pm2NotFoundError, runPm2 } from '../pm2.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Legacy PM2 process names from older omni versions */
const LEGACY_PROCESSES = ['omni-v2-api', 'omni-v2-nats'] as const;

// ============================================================================
// ACTION
// ============================================================================

async function runStop(): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  output.info('Stopping omni services...');

  // Delete current processes
  for (const name of Object.values(PM2_PROCESSES)) {
    await runPm2(['delete', name]);
  }

  // Also clean up legacy process names (ignore errors for missing processes)
  for (const name of LEGACY_PROCESSES) {
    await runPm2(['delete', name]);
  }

  output.success('Omni services stopped');
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

export function createStopCommand(): Command {
  return new Command('stop').description('Stop all omni PM2 processes').action(runStop);
}
