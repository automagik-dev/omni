/**
 * Shell Completions Command
 *
 * omni completions bash
 * omni completions zsh
 * omni completions fish
 */

import { Command } from 'commander';
import * as output from '../output.js';

const BASH_COMPLETIONS = `
# Omni CLI bash completion
_omni_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="auth config instances send chats events persons settings status completions"
    local auth_commands="login status logout"
    local config_commands="list get set unset"
    local instances_commands="list get create delete status qr pair connect disconnect restart logout sync syncs"
    local chats_commands="list get create update delete archive unarchive messages participants"
    local events_commands="list search timeline"
    local persons_commands="search get presence"
    local settings_commands="list get set"
    local completions_commands="bash zsh fish"

    case "\${cword}" in
        1)
            COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
            ;;
        2)
            case "\${prev}" in
                auth)
                    COMPREPLY=( $(compgen -W "\${auth_commands}" -- "\${cur}") )
                    ;;
                config)
                    COMPREPLY=( $(compgen -W "\${config_commands}" -- "\${cur}") )
                    ;;
                instances)
                    COMPREPLY=( $(compgen -W "\${instances_commands}" -- "\${cur}") )
                    ;;
                chats)
                    COMPREPLY=( $(compgen -W "\${chats_commands}" -- "\${cur}") )
                    ;;
                events)
                    COMPREPLY=( $(compgen -W "\${events_commands}" -- "\${cur}") )
                    ;;
                persons)
                    COMPREPLY=( $(compgen -W "\${persons_commands}" -- "\${cur}") )
                    ;;
                settings)
                    COMPREPLY=( $(compgen -W "\${settings_commands}" -- "\${cur}") )
                    ;;
                completions)
                    COMPREPLY=( $(compgen -W "\${completions_commands}" -- "\${cur}") )
                    ;;
            esac
            ;;
    esac
}

complete -F _omni_completions omni
`.trim();

const ZSH_COMPLETIONS = `
#compdef omni

_omni() {
    local -a commands
    commands=(
        'auth:Manage API authentication'
        'config:Manage CLI configuration'
        'instances:Manage channel instances'
        'send:Send messages'
        'chats:Manage chats'
        'events:Query events'
        'persons:Search and manage persons'
        'settings:Manage API settings'
        'status:Show API health and connection info'
        'completions:Generate shell completions'
    )

    local -a auth_commands
    auth_commands=(
        'login:Save API credentials'
        'status:Show current authentication status'
        'logout:Clear stored credentials'
    )

    local -a config_commands
    config_commands=(
        'list:List all configuration values'
        'get:Get a configuration value'
        'set:Set a configuration value'
        'unset:Remove a configuration value'
    )

    local -a instances_commands
    instances_commands=(
        'list:List all instances'
        'get:Get instance details'
        'create:Create a new instance'
        'delete:Delete an instance'
        'status:Get instance connection status'
        'qr:Get QR code for WhatsApp instances'
        'pair:Request pairing code'
        'connect:Connect an instance'
        'disconnect:Disconnect an instance'
        'restart:Restart an instance'
        'logout:Logout and clear session data'
        'sync:Start a sync operation'
        'syncs:List sync jobs or get job status'
    )

    local -a chats_commands
    chats_commands=(
        'list:List chats'
        'get:Get chat details'
        'create:Create a chat record'
        'update:Update a chat'
        'delete:Delete a chat'
        'archive:Archive a chat'
        'unarchive:Unarchive a chat'
        'messages:Get chat messages'
        'participants:List or manage chat participants'
    )

    _arguments -C \\
        '--no-color[Disable colored output]' \\
        '--help[Show help]' \\
        '--version[Show version]' \\
        '1: :->cmd' \\
        '2: :->subcmd' \\
        '*::arg:->args'

    case "\$state" in
        cmd)
            _describe 'command' commands
            ;;
        subcmd)
            case "\$words[1]" in
                auth)
                    _describe 'auth command' auth_commands
                    ;;
                config)
                    _describe 'config command' config_commands
                    ;;
                instances)
                    _describe 'instances command' instances_commands
                    ;;
                chats)
                    _describe 'chats command' chats_commands
                    ;;
                events)
                    _describe 'events command' '(list search timeline)'
                    ;;
                persons)
                    _describe 'persons command' '(search get presence)'
                    ;;
                settings)
                    _describe 'settings command' '(list get set)'
                    ;;
                completions)
                    _describe 'shell' '(bash zsh fish)'
                    ;;
            esac
            ;;
    esac
}

_omni "\$@"
`.trim();

const FISH_COMPLETIONS = `
# Omni CLI fish completion

# Top-level commands
complete -c omni -n "__fish_use_subcommand" -a "auth" -d "Manage API authentication"
complete -c omni -n "__fish_use_subcommand" -a "config" -d "Manage CLI configuration"
complete -c omni -n "__fish_use_subcommand" -a "instances" -d "Manage channel instances"
complete -c omni -n "__fish_use_subcommand" -a "send" -d "Send messages"
complete -c omni -n "__fish_use_subcommand" -a "chats" -d "Manage chats"
complete -c omni -n "__fish_use_subcommand" -a "events" -d "Query events"
complete -c omni -n "__fish_use_subcommand" -a "persons" -d "Search and manage persons"
complete -c omni -n "__fish_use_subcommand" -a "settings" -d "Manage API settings"
complete -c omni -n "__fish_use_subcommand" -a "status" -d "Show API health and connection info"
complete -c omni -n "__fish_use_subcommand" -a "completions" -d "Generate shell completions"

# Auth subcommands
complete -c omni -n "__fish_seen_subcommand_from auth" -a "login" -d "Save API credentials"
complete -c omni -n "__fish_seen_subcommand_from auth" -a "status" -d "Show current authentication status"
complete -c omni -n "__fish_seen_subcommand_from auth" -a "logout" -d "Clear stored credentials"

# Config subcommands
complete -c omni -n "__fish_seen_subcommand_from config" -a "list" -d "List all configuration values"
complete -c omni -n "__fish_seen_subcommand_from config" -a "get" -d "Get a configuration value"
complete -c omni -n "__fish_seen_subcommand_from config" -a "set" -d "Set a configuration value"
complete -c omni -n "__fish_seen_subcommand_from config" -a "unset" -d "Remove a configuration value"

# Instances subcommands
complete -c omni -n "__fish_seen_subcommand_from instances" -a "list" -d "List all instances"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "get" -d "Get instance details"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "create" -d "Create a new instance"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "delete" -d "Delete an instance"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "status" -d "Get instance connection status"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "qr" -d "Get QR code"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "pair" -d "Request pairing code"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "connect" -d "Connect an instance"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "disconnect" -d "Disconnect an instance"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "restart" -d "Restart an instance"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "logout" -d "Logout and clear session"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "sync" -d "Start a sync operation"
complete -c omni -n "__fish_seen_subcommand_from instances" -a "syncs" -d "List sync jobs"

# Chats subcommands
complete -c omni -n "__fish_seen_subcommand_from chats" -a "list" -d "List chats"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "get" -d "Get chat details"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "create" -d "Create a chat record"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "update" -d "Update a chat"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "delete" -d "Delete a chat"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "archive" -d "Archive a chat"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "unarchive" -d "Unarchive a chat"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "messages" -d "Get chat messages"
complete -c omni -n "__fish_seen_subcommand_from chats" -a "participants" -d "Manage participants"

# Events subcommands
complete -c omni -n "__fish_seen_subcommand_from events" -a "list" -d "List events"
complete -c omni -n "__fish_seen_subcommand_from events" -a "search" -d "Search events"
complete -c omni -n "__fish_seen_subcommand_from events" -a "timeline" -d "Show person timeline"

# Persons subcommands
complete -c omni -n "__fish_seen_subcommand_from persons" -a "search" -d "Search for persons"
complete -c omni -n "__fish_seen_subcommand_from persons" -a "get" -d "Get person details"
complete -c omni -n "__fish_seen_subcommand_from persons" -a "presence" -d "Get person presence"

# Settings subcommands
complete -c omni -n "__fish_seen_subcommand_from settings" -a "list" -d "List all settings"
complete -c omni -n "__fish_seen_subcommand_from settings" -a "get" -d "Get a setting value"
complete -c omni -n "__fish_seen_subcommand_from settings" -a "set" -d "Update a setting value"

# Completions subcommands
complete -c omni -n "__fish_seen_subcommand_from completions" -a "bash" -d "Bash completions"
complete -c omni -n "__fish_seen_subcommand_from completions" -a "zsh" -d "Zsh completions"
complete -c omni -n "__fish_seen_subcommand_from completions" -a "fish" -d "Fish completions"
`.trim();

export function createCompletionsCommand(): Command {
  const completions = new Command('completions')
    .description('Generate shell completions')
    .argument('[shell]', 'Shell type (bash, zsh, fish)')
    .action((shell?: string) => {
      if (!shell) {
        output.info('Generate shell completions for omni CLI');
        output.raw('\nAvailable shells:');
        output.raw('  bash  - Bash completions');
        output.raw('  zsh   - Zsh completions');
        output.raw('  fish  - Fish completions');
        output.raw('\nUsage:');
        output.raw('  omni completions bash >> ~/.bashrc');
        output.raw('  omni completions zsh >> ~/.zshrc');
        output.raw('  omni completions fish > ~/.config/fish/completions/omni.fish');
        return;
      }

      switch (shell.toLowerCase()) {
        case 'bash':
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.log(BASH_COMPLETIONS);
          break;
        case 'zsh':
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.log(ZSH_COMPLETIONS);
          break;
        case 'fish':
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.log(FISH_COMPLETIONS);
          break;
        default:
          output.error(`Unknown shell: ${shell}`, {
            validShells: ['bash', 'zsh', 'fish'],
          });
      }
    });

  return completions;
}
