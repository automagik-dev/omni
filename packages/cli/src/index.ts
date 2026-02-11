#!/usr/bin/env bun
/**
 * Omni CLI - LLM-optimized command-line interface
 *
 * @example
 * omni auth login --api-key sk_xxx
 * omni instances list
 * omni send --instance abc --to +1234567890 --text "Hello"
 */

import chalk, { Chalk, type ChalkInstance } from 'chalk';
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
import { createKeysCommand } from './commands/keys.js';
import { createLogsCommand } from './commands/logs.js';
import { createMediaCommand } from './commands/media.js';
import { createMessagesCommand } from './commands/messages.js';
import { createPayloadsCommand } from './commands/payloads.js';
import { createPersonsCommand } from './commands/persons.js';
import { createPromptsCommand } from './commands/prompts.js';
import { createProvidersCommand } from './commands/providers.js';
import { createResyncCommand } from './commands/resync.js';
import { createSendCommand } from './commands/send.js';
import { createSettingsCommand } from './commands/settings.js';
import { createStatusCommand } from './commands/status.js';
import { createWebhooksCommand } from './commands/webhooks.js';
import type { CommandCategory } from './config.js';
import { type CommandInfo, formatCommandGroups, formatExamples } from './help.js';
import { areColorsEnabled, disableColors } from './output.js';
import { getConfigSummary, getInlineStatus } from './status.js';

const VERSION = '0.0.1';

/**
 * Help display group for organizing commands
 */
type HelpGroup = 'Core' | 'Management' | 'System';

/**
 * Command definitions with their categories and help groups
 *
 * Categories (visibility):
 * - core: Essential daily operations (instances, send, chats, auth, etc.)
 * - standard: Regular features (events, settings, config, messages)
 * - advanced: Power user/admin (automations, access, webhooks)
 * - debug: Development/ops (logs, dead-letters, payloads, event replay)
 *
 * Help Groups (display):
 * - Core: send, chats, messages
 * - Management: instances, persons, automations
 * - System: status, config, events
 */
interface CommandDef {
  create: () => Command;
  category: CommandCategory;
  helpGroup: HelpGroup;
  helpDescription?: string; // Override for help display
}

const COMMANDS: CommandDef[] = [
  // Core group - Main messaging operations
  {
    create: createSendCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Send message (text, media, location, poll)',
  },
  { create: createChatsCommand, category: 'core', helpGroup: 'Core', helpDescription: 'List and manage conversations' },
  {
    create: createMessagesCommand,
    category: 'standard',
    helpGroup: 'Core',
    helpDescription: 'Message actions (read receipts)',
  },

  // Management group - Configuration and setup
  {
    create: createInstancesCommand,
    category: 'core',
    helpGroup: 'Management',
    helpDescription: 'Channel connections (WhatsApp, Discord)',
  },
  { create: createPersonsCommand, category: 'core', helpGroup: 'Management', helpDescription: 'Contact directory' },
  {
    create: createAutomationsCommand,
    category: 'advanced',
    helpGroup: 'Management',
    helpDescription: 'Event-driven workflows',
  },
  {
    create: createProvidersCommand,
    category: 'core',
    helpGroup: 'Management',
    helpDescription: 'AI/LLM providers configuration',
  },
  {
    create: createKeysCommand,
    category: 'core',
    helpGroup: 'Management',
    helpDescription: 'API key management',
  },
  {
    create: createAccessCommand,
    category: 'advanced',
    helpGroup: 'Management',
    helpDescription: 'Access control and permissions',
  },
  {
    create: createWebhooksCommand,
    category: 'advanced',
    helpGroup: 'Management',
    helpDescription: 'Webhook management',
  },

  // System group - Status and configuration
  {
    create: createStatusCommand,
    category: 'core',
    helpGroup: 'System',
    helpDescription: 'API health and connection info',
  },
  {
    create: createConfigCommand,
    category: 'standard',
    helpGroup: 'System',
    helpDescription: 'CLI settings (default instance, format)',
  },
  { create: createEventsCommand, category: 'standard', helpGroup: 'System', helpDescription: 'Query message history' },
  { create: createAuthCommand, category: 'core', helpGroup: 'System', helpDescription: 'Authentication management' },
  { create: createSettingsCommand, category: 'standard', helpGroup: 'System', helpDescription: 'Server settings' },
  { create: createBatchCommand, category: 'standard', helpGroup: 'System', helpDescription: 'Batch operations' },
  {
    create: createMediaCommand,
    category: 'standard',
    helpGroup: 'Core',
    helpDescription: 'Browse and download media items',
  },
  {
    create: createPromptsCommand,
    category: 'standard',
    helpGroup: 'System',
    helpDescription: 'Manage LLM prompt overrides',
  },
  {
    create: createResyncCommand,
    category: 'standard',
    helpGroup: 'System',
    helpDescription: 'Trigger history backfill for instances',
  },

  // Debug commands (not shown in grouped help)
  { create: createLogsCommand, category: 'debug', helpGroup: 'System' },
  { create: createDeadLettersCommand, category: 'debug', helpGroup: 'System' },
  { create: createPayloadsCommand, category: 'debug', helpGroup: 'System' },
  { create: createCompletionsCommand, category: 'debug', helpGroup: 'System' },
];

/** Check if --all flag is present in args */
function hasAllFlag(): boolean {
  return process.argv.includes('--all');
}

/** Get count of commands not shown in grouped help */
function getHiddenCount(): number {
  return COMMANDS.filter((cmd) => !cmd.helpDescription).length;
}

const program = new Command();

program
  .name('omni')
  .description('CLI for Omni v2 - Universal Omnichannel Platform')
  .version(VERSION)
  .enablePositionalOptions()
  .passThroughOptions()
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (_thisCommand, actionCommand) => {
    // Handle --no-color flag
    const opts = actionCommand.optsWithGlobals();
    if (opts.color === false) {
      disableColors();
    }
  });

// Register commands with visibility
const showAll = hasAllFlag();

for (const def of COMMANDS) {
  const cmd = def.create();

  // Hide ALL commands from default help - we show our own grouped list
  // Unless --all is specified, then show the standard Commander list
  const shouldHide = !showAll;

  program.addCommand(cmd, { hidden: shouldHide });
}

// Configure help to show minimal info for root (we customize everything)
program.configureHelp({
  // Don't sort commands - we control order via our grouped display
  sortSubcommands: false,
  // Don't show subcommand list for root - we have our own grouped display
  subcommandTerm: () => '',
  visibleCommands: (cmd) => {
    // For root command, hide all from default list (we show our grouped list)
    if (cmd === program) return [];
    // For subcommands, show their children normally (filter out hidden ones)
    return cmd.commands.filter((c) => !(c as unknown as { _hidden?: boolean })._hidden);
  },
});

/** Get chalk instance (respects color setting) */
function c(): ChalkInstance {
  if (areColorsEnabled()) {
    return chalk;
  }
  return new Chalk({ level: 0 });
}

/** Build grouped commands for help display */
function buildCommandGroups(includeDebug = false): Record<string, CommandInfo[]> {
  const groups: Record<string, CommandInfo[]> = {
    Core: [],
    Management: [],
    System: [],
  };

  // Add Debug group if showing all
  if (includeDebug) {
    groups.Debug = [];
  }

  for (const def of COMMANDS) {
    // Skip debug commands unless includeDebug is true
    if (def.category === 'debug') {
      if (!includeDebug) continue;
      // Add debug commands to Debug group
      const cmd = def.create();
      groups.Debug.push({
        name: cmd.name(),
        description: cmd.description() || 'Debug command',
      });
      continue;
    }

    // Skip commands without helpDescription (they go in default help)
    if (!def.helpDescription) continue;

    const cmd = def.create();
    groups[def.helpGroup].push({
      name: cmd.name(),
      description: def.helpDescription,
    });
  }

  return groups;
}

// Custom help: Add Quick Start section before commands (root only)
program.addHelpText('before', (context) => {
  // Only show for root command
  if (context.command !== program) return '';

  const quickStart = `
${c().bold('Quick Start')}:
  omni send --to +5511999999999 --text "Hello"
  omni chats list
  omni events list --limit 10
`;
  return quickStart;
});

// Custom help: Add status and grouped commands after description (root only)
program.addHelpText('afterAll', (context) => {
  // Only show for root command
  if (context.command !== program) return '';

  const status = getInlineStatus();
  const configSummary = getConfigSummary();
  const hiddenCount = getHiddenCount();

  const commandGroups = buildCommandGroups(showAll);
  const groupedCommands = formatCommandGroups(commandGroups);

  const examples = formatExamples([
    { command: 'omni send --to +55119999 --text "Hi"', description: 'Send text' },
    { command: 'omni send --to +55119999 --media ./pic.jpg', description: 'Send image' },
    { command: 'omni chats messages <chat-id>', description: 'Read conversation' },
    { command: 'omni persons search "Felipe"', description: 'Find contact' },
  ]);

  let output = `
${c().bold('Status')}: ${status}

${c().bold('Commands')}:
${groupedCommands}

${c().dim(`Config: ${configSummary}`)}

${examples}`;

  // Add hidden commands hint
  if (!showAll && hiddenCount > 0) {
    output += `

${c().dim(`Hidden: ${hiddenCount} debug commands`)}
  ${c().dim('Use --all to show all commands')}`;
  } else if (showAll) {
    output += `

${c().dim('Showing all commands (--all flag active)')}`;
  }

  return output;
});

// Parse and execute
program.parse(process.argv);
