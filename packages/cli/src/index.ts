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
program.addCommand(createAccessCommand());
program.addCommand(createAuthCommand());
program.addCommand(createAutomationsCommand());
program.addCommand(createChatsCommand());
program.addCommand(createCompletionsCommand());
program.addCommand(createConfigCommand());
program.addCommand(createDeadLettersCommand());
program.addCommand(createEventsCommand());
program.addCommand(createInstancesCommand());
program.addCommand(createLogsCommand());
program.addCommand(createMessagesCommand());
program.addCommand(createPayloadsCommand());
program.addCommand(createPersonsCommand());
program.addCommand(createProvidersCommand());
program.addCommand(createSendCommand());
program.addCommand(createSettingsCommand());
program.addCommand(createStatusCommand());
program.addCommand(createWebhooksCommand());

// Parse and execute
program.parse(process.argv);
