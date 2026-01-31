/**
 * Slash command registration
 *
 * Handles registering slash commands with Discord.
 */

import {
  type APIApplicationCommandOption,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  type Client,
  REST,
  type RESTPostAPIApplicationCommandsJSONBody,
  Routes,
} from 'discord.js';
import type { CommandOption, CommandOptionType, SlashCommandDefinition } from '../types';

/**
 * Map command option type to Discord's ApplicationCommandOptionType
 */
function mapOptionType(type: CommandOptionType): ApplicationCommandOptionType {
  switch (type) {
    case 'string':
      return ApplicationCommandOptionType.String;
    case 'integer':
      return ApplicationCommandOptionType.Integer;
    case 'boolean':
      return ApplicationCommandOptionType.Boolean;
    case 'user':
      return ApplicationCommandOptionType.User;
    case 'channel':
      return ApplicationCommandOptionType.Channel;
    case 'role':
      return ApplicationCommandOptionType.Role;
    case 'mentionable':
      return ApplicationCommandOptionType.Mentionable;
    case 'number':
      return ApplicationCommandOptionType.Number;
    case 'attachment':
      return ApplicationCommandOptionType.Attachment;
    default:
      return ApplicationCommandOptionType.String;
  }
}

/**
 * Build command option for Discord API
 */
function buildOption(option: CommandOption): APIApplicationCommandOption {
  const result: Record<string, unknown> = {
    name: option.name,
    description: option.description,
    type: mapOptionType(option.type),
    required: option.required ?? false,
  };

  if (option.choices) {
    result.choices = option.choices;
  }

  if (option.autocomplete) {
    result.autocomplete = true;
  }

  if (option.minValue !== undefined) {
    result.min_value = option.minValue;
  }

  if (option.maxValue !== undefined) {
    result.max_value = option.maxValue;
  }

  if (option.minLength !== undefined) {
    result.min_length = option.minLength;
  }

  if (option.maxLength !== undefined) {
    result.max_length = option.maxLength;
  }

  return result as unknown as APIApplicationCommandOption;
}

/**
 * Build slash command data for Discord API
 */
export function buildSlashCommand(definition: SlashCommandDefinition): RESTPostAPIApplicationCommandsJSONBody {
  const command: RESTPostAPIApplicationCommandsJSONBody = {
    name: definition.name,
    description: definition.description,
    type: ApplicationCommandType.ChatInput,
  };

  if (definition.options) {
    command.options = definition.options.map(buildOption);
  }

  if (definition.defaultMemberPermissions) {
    command.default_member_permissions = definition.defaultMemberPermissions;
  }

  if (definition.dmPermission !== undefined) {
    command.dm_permission = definition.dmPermission;
  }

  return command;
}

/**
 * Register slash commands globally (for all guilds)
 *
 * @param client - Discord client (must be logged in)
 * @param commands - Array of command definitions
 */
export async function registerGlobalCommands(client: Client, commands: SlashCommandDefinition[]): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in before registering commands');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  const commandData = commands.filter((cmd) => !cmd.guildId).map(buildSlashCommand);

  await rest.put(Routes.applicationCommands(client.application.id), {
    body: commandData,
  });
}

/**
 * Register slash commands for a specific guild
 *
 * @param client - Discord client
 * @param guildId - Guild to register commands in
 * @param commands - Array of command definitions
 */
export async function registerGuildCommands(
  client: Client,
  guildId: string,
  commands: SlashCommandDefinition[],
): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in before registering commands');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  const commandData = commands.map(buildSlashCommand);

  await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), {
    body: commandData,
  });
}

/**
 * Register all commands (routes guild-specific and global appropriately)
 *
 * @param client - Discord client
 * @param commands - Array of command definitions
 */
export async function registerCommands(client: Client, commands: SlashCommandDefinition[]): Promise<void> {
  // Separate guild-specific and global commands
  const globalCommands = commands.filter((cmd) => !cmd.guildId);
  const guildCommands = commands.filter((cmd) => cmd.guildId);

  // Register global commands
  if (globalCommands.length > 0) {
    await registerGlobalCommands(client, globalCommands);
  }

  // Group and register guild commands
  const guildMap = new Map<string, SlashCommandDefinition[]>();
  for (const cmd of guildCommands) {
    const list = guildMap.get(cmd.guildId!) ?? [];
    list.push(cmd);
    guildMap.set(cmd.guildId!, list);
  }

  for (const [guildId, cmds] of guildMap) {
    await registerGuildCommands(client, guildId, cmds);
  }
}

/**
 * Delete a global command
 *
 * @param client - Discord client
 * @param commandId - Command ID to delete
 */
export async function deleteGlobalCommand(client: Client, commandId: string): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  await rest.delete(Routes.applicationCommand(client.application.id, commandId));
}

/**
 * Delete a guild command
 *
 * @param client - Discord client
 * @param guildId - Guild ID
 * @param commandId - Command ID to delete
 */
export async function deleteGuildCommand(client: Client, guildId: string, commandId: string): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  await rest.delete(Routes.applicationGuildCommand(client.application.id, guildId, commandId));
}

/**
 * Clear all global commands
 *
 * @param client - Discord client
 */
export async function clearGlobalCommands(client: Client): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  await rest.put(Routes.applicationCommands(client.application.id), { body: [] });
}

/**
 * Clear all commands for a guild
 *
 * @param client - Discord client
 * @param guildId - Guild ID
 */
export async function clearGuildCommands(client: Client, guildId: string): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), { body: [] });
}
