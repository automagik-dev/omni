#!/usr/bin/env bun
/**
 * Omni CLI - LLM-optimized command-line interface
 *
 * @example
 * omni auth login --api-key sk_xxx
 * omni instances list
 * omni send --instance abc --to +1234567890 --text "Hello"
 */

import { Command } from 'commander';
import { createAccessCommand } from './commands/access.js';
import { createAuthCommand } from './commands/auth.js';
import { createAutomationsCommand } from './commands/automations.js';
import { createBatchCommand } from './commands/batch.js';
import { createChatsCommand } from './commands/chats.js';
import { createCompletionsCommand } from './commands/completions.js';
import { createConfigCommand } from './commands/config.js';
import { createDeadLettersCommand } from './commands/dead-letters.js';
import { createEventsCommand } from './commands/events.js';
import { createInstancesCommand } from './commands/instances.js';
import { createLogsCommand } from './commands/logs.js';
import { createMessagesCommand } from './commands/messages.js';
import { createPayloadsCommand } from './commands/payloads.js';
import { createPersonsCommand } from './commands/persons.js';
import { createProvidersCommand } from './commands/providers.js';
import { createSendCommand } from './commands/send.js';
import { createSettingsCommand } from './commands/settings.js';
import { createStatusCommand } from './commands/status.js';
import { createWebhooksCommand } from './commands/webhooks.js';
import { type CommandCategory, getVisibleCategories } from './config.js';
import { disableColors } from './output.js';

const VERSION = '0.0.1';

/**
 * Command definitions with their categories
 *
 * Categories:
 * - core: Essential daily operations (instances, send, chats, auth, etc.)
 * - standard: Regular features (events, settings, config, messages)
 * - advanced: Power user/admin (automations, access, webhooks)
 * - debug: Development/ops (logs, dead-letters, payloads, event replay)
 */
interface CommandDef {
  create: () => Command;
  category: CommandCategory;
}

const COMMANDS: CommandDef[] = [
  // Core - Essential daily operations
  { create: createAuthCommand, category: 'core' },
  { create: createInstancesCommand, category: 'core' },
  { create: createSendCommand, category: 'core' },
  { create: createChatsCommand, category: 'core' },
  { create: createPersonsCommand, category: 'core' },
  { create: createProvidersCommand, category: 'core' },
  { create: createStatusCommand, category: 'core' },

  // Standard - Regular features
  { create: createMessagesCommand, category: 'standard' },
  { create: createEventsCommand, category: 'standard' },
  { create: createSettingsCommand, category: 'standard' },
  { create: createConfigCommand, category: 'standard' },
  { create: createBatchCommand, category: 'standard' },

  // Advanced - Power user/admin
  { create: createAutomationsCommand, category: 'advanced' },
  { create: createAccessCommand, category: 'advanced' },
  { create: createWebhooksCommand, category: 'advanced' },

  // Debug - Development/ops
  { create: createLogsCommand, category: 'debug' },
  { create: createDeadLettersCommand, category: 'debug' },
  { create: createPayloadsCommand, category: 'debug' },
  { create: createCompletionsCommand, category: 'debug' },
];

/** Check if --all flag is present in args */
function hasAllFlag(): boolean {
  return process.argv.includes('--all');
}

/** Get hidden command count by category */
function getHiddenCounts(): Record<CommandCategory, number> {
  const visible = getVisibleCategories();
  const counts: Record<CommandCategory, number> = { core: 0, standard: 0, advanced: 0, debug: 0 };

  if (visible === 'all') return counts;

  for (const cmd of COMMANDS) {
    if (!visible.includes(cmd.category)) {
      counts[cmd.category]++;
    }
  }

  return counts;
}

const program = new Command();

program
  .name('omni')
  .description('CLI for Omni v2 - Universal Omnichannel Platform')
  .version(VERSION)
  .option('--no-color', 'Disable colored output')
  .option('--all', 'Show all commands in help (including hidden)')
  .hook('preAction', (_thisCommand, actionCommand) => {
    // Handle --no-color flag
    const opts = actionCommand.optsWithGlobals();
    if (opts.color === false) {
      disableColors();
    }
  });

// Register commands with visibility
const showAll = hasAllFlag();
const visibleCategories = getVisibleCategories();

for (const def of COMMANDS) {
  const cmd = def.create();

  // Hide commands based on visibility config (unless --all flag)
  const shouldHide = !showAll && visibleCategories !== 'all' && !visibleCategories.includes(def.category);

  program.addCommand(cmd, { hidden: shouldHide });
}

// Add help hint about hidden commands
program.addHelpText('after', () => {
  if (showAll) {
    return '\nShowing all commands (--all flag active)';
  }

  const hidden = getHiddenCounts();
  const totalHidden = Object.values(hidden).reduce((a, b) => a + b, 0);

  if (totalHidden === 0) {
    return '';
  }

  const parts: string[] = [];
  if (hidden.advanced > 0) parts.push(`${hidden.advanced} advanced`);
  if (hidden.debug > 0) parts.push(`${hidden.debug} debug`);

  return `
Hidden: ${parts.join(', ')} commands
  Use --all to show all commands
  Or: omni config set showCommands all`;
});

// Parse and execute
program.parse(process.argv);
