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
import { Command, Option } from 'commander';
import { createAccessCommand } from './commands/access.js';
import { createRoutesCommand } from './commands/agent-routes.js';
import { createAgentsCommand } from './commands/agents.js';
import { createAuthCommand } from './commands/auth.js';
import { createAutomationsCommand } from './commands/automations.js';
import { createBatchCommand } from './commands/batch.js';
import { createChannelsCommand } from './commands/channels.js';
import { createChatsCommand } from './commands/chats.js';
import { createCloseCommand } from './commands/close.js';
import { createCompletionsCommand } from './commands/completions.js';
import { createConfigCommand } from './commands/config.js';
import { createConnectCommand } from './commands/connect.js';
import { createDeadLettersCommand } from './commands/dead-letters.js';
import { createDoneCommand } from './commands/done.js';
import { createEventsCommand } from './commands/events.js';
import { createFilmCommand } from './commands/film.js';
import { createImagineCommand } from './commands/imagine.js';
import { createInstallCommand } from './commands/install.js';
import { createInstancesCommand } from './commands/instances.js';
import { createJourneyCommand } from './commands/journey.js';
import { createKeysCommand } from './commands/keys.js';
import { createListenCommand } from './commands/listen.js';
import { createLogsCommand } from './commands/logs.js';
import { createMediaCommand } from './commands/media.js';
import { createMessagesCommand } from './commands/messages.js';
import { createOpenCommand } from './commands/open.js';
import { createPayloadsCommand } from './commands/payloads.js';
import { createPersonsCommand } from './commands/persons.js';
import { createPromptsCommand } from './commands/prompts.js';
import { createProvidersCommand } from './commands/providers.js';
import { createReactCommand } from './commands/react.js';
import { createReplayCommand } from './commands/replay.js';
import { createRestartCommand } from './commands/restart.js';
import { createResyncCommand } from './commands/resync.js';
import { createSayCommand } from './commands/say.js';
import { createSeeCommand } from './commands/see.js';
import { createSendCommand } from './commands/send.js';
import { createSettingsCommand } from './commands/settings.js';
import { createSpeakCommand } from './commands/speak.js';
import { createStartCommand } from './commands/start.js';
import { createStatusCommand } from './commands/status.js';
import { createStopCommand } from './commands/stop.js';
import { createTtsCommand } from './commands/tts.js';
import { createUpdateCommand } from './commands/update.js';
import { createUseCommand } from './commands/use.js';
import { createWebhooksCommand } from './commands/webhooks.js';
import { createWhereCommand } from './commands/where.js';
import { type CommandCategory, loadConfig, setRuntimeFormat } from './config.js';
import { type CommandInfo, formatCommandGroups, formatExamples } from './help.js';
import { areColorsEnabled, disableColors, flushStdout } from './output.js';

// Handle --json flag early (before Commander) so it works anywhere in argv
if (process.argv.includes('--json')) {
  setRuntimeFormat('json');
  // Remove --json from argv so Commander doesn't choke on it in subcommands
  const idx = process.argv.indexOf('--json');
  process.argv.splice(idx, 1);
}
import { getConfigSummary, getInlineStatus } from './status.js';
import { captureCliError, flushTelemetry } from './telemetry.js';
import { VERSION, fetchServerVersion, formatCliVersionLine } from './version.js';

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
  {
    create: createSayCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Send text to open chat (verb command)',
  },
  {
    create: createReactCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'React to a message with emoji (verb command)',
  },
  {
    create: createListenCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Transcribe audio to text (verb command)',
  },
  {
    create: createImagineCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Generate an image from a prompt (Gemini Nano Banana, verb command)',
  },
  {
    create: createFilmCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Generate a video from a prompt (Gemini Veo 3.1, verb command)',
  },
  {
    create: createSpeakCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Synthesize text to speech and send as voice note (verb command)',
  },
  {
    create: createSeeCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Describe an image or video via Gemini Vision (verb command)',
  },
  { create: createChatsCommand, category: 'core', helpGroup: 'Core', helpDescription: 'List and manage conversations' },
  {
    create: createMessagesCommand,
    category: 'standard',
    helpGroup: 'Core',
    helpDescription: 'Message actions (read receipts)',
  },
  {
    create: createTtsCommand,
    category: 'standard',
    helpGroup: 'Core',
    helpDescription: 'Text-to-speech operations',
  },
  {
    create: createOpenCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Open conversation context (set active chat)',
  },
  {
    create: createCloseCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Clear active conversation context',
  },
  {
    create: createUseCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Set active instance for verb commands',
  },
  {
    create: createWhereCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Show current context (instance, chat)',
  },
  {
    create: createDoneCommand,
    category: 'core',
    helpGroup: 'Core',
    helpDescription: 'Close turn (send final message + emit turn.done)',
  },

  // Management group - Configuration and setup
  {
    create: createChannelsCommand,
    category: 'core',
    helpGroup: 'Management',
    helpDescription: 'Channel types, add instances, status overview',
  },
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
    create: createAgentsCommand,
    category: 'core',
    helpGroup: 'Management',
    helpDescription: 'AI agent entity management',
  },
  {
    create: createProvidersCommand,
    category: 'core',
    helpGroup: 'Management',
    helpDescription: 'AI/LLM providers configuration',
  },
  {
    create: createConnectCommand,
    category: 'core',
    helpGroup: 'Management',
    helpDescription: 'Connect instance to genie agent via NATS',
  },
  {
    create: createRoutesCommand,
    category: 'standard',
    helpGroup: 'Management',
    helpDescription: 'Agent routing configuration',
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
    create: createUpdateCommand,
    category: 'standard',
    helpGroup: 'System',
    helpDescription: 'Update CLI to latest version',
  },
  {
    create: createStartCommand,
    category: 'core',
    helpGroup: 'System',
    helpDescription: 'Start Omni services (API + NATS)',
  },
  {
    create: createStopCommand,
    category: 'core',
    helpGroup: 'System',
    helpDescription: 'Stop Omni services',
  },
  {
    create: createRestartCommand,
    category: 'core',
    helpGroup: 'System',
    helpDescription: 'Restart Omni services',
  },
  {
    create: createInstallCommand,
    category: 'standard',
    helpGroup: 'System',
    helpDescription: 'Interactive setup wizard (bootstrap Omni server)',
  },
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
  {
    create: createReplayCommand,
    category: 'standard',
    helpGroup: 'System',
    helpDescription: 'Replay missed messages for an agent instance',
  },

  // Performance/tracing
  {
    create: createJourneyCommand,
    category: 'standard',
    helpGroup: 'System',
    helpDescription: 'Message journey tracing & latency',
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
  .description('CLI for Omni - Universal Omnichannel Platform')
  .version(VERSION, '-V, --version', 'output the version number')
  .enablePositionalOptions()
  .passThroughOptions()
  .option('--no-color', 'Disable colored output')
  .option('--all', 'Show all commands including debug commands')
  .hook('preAction', (_thisCommand, actionCommand) => {
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

/**
 * Add --instance-ids (and --instances) as hidden aliases for all commands
 * that accept --instance or --instances options.
 * A preAction hook remaps alias values to the primary attribute name.
 */
function addInstanceIdAliases(cmd: Command): void {
  for (const subcmd of cmd.commands) {
    const hasInstanceIds = subcmd.options.some((o) => o.long === '--instance-ids');
    const snapshot = [...subcmd.options];
    for (const opt of snapshot) {
      if (opt.long === '--instance' && !hasInstanceIds) {
        opt.description += ' (aliases: --instance-ids, --instances)';
        subcmd.addOption(new Option('--instance-ids <id>').hideHelp());
        if (!subcmd.options.some((o) => o.long === '--instances')) {
          subcmd.addOption(new Option('--instances <id>').hideHelp());
        }
      } else if (opt.long === '--instances' && !hasInstanceIds) {
        opt.description += ' (alias: --instance-ids)';
        subcmd.addOption(new Option('--instance-ids <ids>').hideHelp());
      }
    }
    addInstanceIdAliases(subcmd);
  }
}

addInstanceIdAliases(program);

// Remap alias option values to primary attribute names before action handlers run
program.hook('preAction', (_thisCmd, actionCmd) => {
  const opts = actionCmd.opts();
  if (opts.instanceIds !== undefined) {
    if (opts.instance === undefined) actionCmd.setOptionValue('instance', opts.instanceIds);
    if (opts.instances === undefined) actionCmd.setOptionValue('instances', opts.instanceIds);
  }
  if (opts.instances !== undefined && opts.instance === undefined) {
    actionCmd.setOptionValue('instance', opts.instances);
  }
});

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

${c().bold('Global Flags')}:
  --json         Output in JSON format (works with any command)
  --no-color     Disable colored output
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

// ---------------------------------------------------------------------------
// Error telemetry: capture unknown commands, unknown flags, and failures
// ---------------------------------------------------------------------------

// Hook Commander's error output to capture CLI errors for Sentry telemetry.
// We wrap writeErr so Commander still prints errors and exits normally.
const originalWriteErr = program.configureOutput()?.writeErr ?? ((str: string) => process.stderr.write(str));
program.configureOutput({
  writeErr: (str: string) => {
    // Commander error messages start with "error:" — capture them as telemetry
    if (str.startsWith('error:')) {
      const message = str.replace(/^error:\s*/, '').trim();
      const err = new Error(message);
      err.name = 'CommanderError';
      captureCliError(err);
    }
    originalWriteErr(str);
  },
});

// Parse and execute
const argv = process.argv.slice(2);
const isRootVersionOnly = argv.length > 0 && argv.every((arg) => arg === '--version' || arg === '-V');

if (isRootVersionOnly) {
  const config = loadConfig();
  const apiUrl = config.apiUrl ?? 'http://localhost:8882';
  const serverVersion = await fetchServerVersion(apiUrl);
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(formatCliVersionLine(VERSION, serverVersion));
  process.exit(0);
}

await program.parseAsync(process.argv);

// Flush Sentry events + stdout before exit
await Promise.all([flushTelemetry(), flushStdout()]);
