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
import { createAuthCommand } from './commands/auth.js';
import { createChatsCommand } from './commands/chats.js';
import { createCompletionsCommand } from './commands/completions.js';
import { createConfigCommand } from './commands/config.js';
import { createEventsCommand } from './commands/events.js';
import { createInstancesCommand } from './commands/instances.js';
import { createPersonsCommand } from './commands/persons.js';
import { createSendCommand } from './commands/send.js';
import { createSettingsCommand } from './commands/settings.js';
import { createStatusCommand } from './commands/status.js';
import { disableColors } from './output.js';

const VERSION = '0.0.1';

const program = new Command();

program
  .name('omni')
  .description('LLM-optimized CLI for Omni v2 - Universal Omnichannel Platform')
  .version(VERSION)
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (_thisCommand, actionCommand) => {
    // Handle --no-color flag
    const opts = actionCommand.optsWithGlobals();
    if (opts.color === false) {
      disableColors();
    }
  });

// Register commands
program.addCommand(createAuthCommand());
program.addCommand(createConfigCommand());
program.addCommand(createInstancesCommand());
program.addCommand(createSendCommand());
program.addCommand(createChatsCommand());
program.addCommand(createEventsCommand());
program.addCommand(createPersonsCommand());
program.addCommand(createSettingsCommand());
program.addCommand(createStatusCommand());
program.addCommand(createCompletionsCommand());

// Parse and execute
program.parse(process.argv);
