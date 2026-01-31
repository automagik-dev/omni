/**
 * Context menu command registration
 *
 * Handles registering right-click context menu commands.
 */

import {
  ApplicationCommandType,
  type Client,
  REST,
  type RESTPostAPIApplicationCommandsJSONBody,
  Routes,
} from 'discord.js';
import type { ContextMenuDefinition } from '../types';

/**
 * Build context menu command data for Discord API
 */
export function buildContextMenuCommand(definition: ContextMenuDefinition): RESTPostAPIApplicationCommandsJSONBody {
  const command: RESTPostAPIApplicationCommandsJSONBody = {
    name: definition.name,
    type: definition.type === 'user' ? ApplicationCommandType.User : ApplicationCommandType.Message,
  };

  if (definition.defaultMemberPermissions) {
    command.default_member_permissions = definition.defaultMemberPermissions;
  }

  if (definition.dmPermission !== undefined) {
    command.dm_permission = definition.dmPermission;
  }

  return command;
}

/**
 * Register context menu commands globally
 *
 * @param client - Discord client
 * @param commands - Array of context menu definitions
 */
export async function registerGlobalContextMenus(client: Client, commands: ContextMenuDefinition[]): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in before registering commands');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  const commandData = commands.filter((cmd) => !cmd.guildId).map(buildContextMenuCommand);

  // Get existing commands to merge with
  const existingCommands = await client.application.commands.fetch();
  const existingData = existingCommands.map((cmd) => ({
    name: cmd.name,
    type: cmd.type,
    description: cmd.description,
    options: cmd.options,
    default_member_permissions: cmd.defaultMemberPermissions?.bitfield.toString(),
    dm_permission: cmd.dmPermission,
  }));

  // Merge: keep existing slash commands, add new context menus
  const slashCommands = existingData.filter((cmd) => cmd.type === ApplicationCommandType.ChatInput);

  await rest.put(Routes.applicationCommands(client.application.id), {
    body: [...slashCommands, ...commandData],
  });
}

/**
 * Register context menu commands for a specific guild
 *
 * @param client - Discord client
 * @param guildId - Guild ID
 * @param commands - Array of context menu definitions
 */
export async function registerGuildContextMenus(
  client: Client,
  guildId: string,
  commands: ContextMenuDefinition[],
): Promise<void> {
  if (!client.application) {
    throw new Error('Client must be logged in before registering commands');
  }

  const rest = new REST({ version: '10' }).setToken(client.token!);
  const commandData = commands.map(buildContextMenuCommand);

  // Get existing guild commands to merge with
  const guild = await client.guilds.fetch(guildId);
  const existingCommands = await guild.commands.fetch();
  const existingData = existingCommands.map((cmd) => ({
    name: cmd.name,
    type: cmd.type,
    description: cmd.description,
    options: cmd.options,
    default_member_permissions: cmd.defaultMemberPermissions?.bitfield.toString(),
    dm_permission: cmd.dmPermission,
  }));

  // Merge: keep existing slash commands, add new context menus
  const slashCommands = existingData.filter((cmd) => cmd.type === ApplicationCommandType.ChatInput);

  await rest.put(Routes.applicationGuildCommands(client.application.id, guildId), {
    body: [...slashCommands, ...commandData],
  });
}

/**
 * Create a user context menu command definition
 *
 * @param name - Command name (shown in right-click menu)
 * @param options - Additional options
 */
export function createUserContextMenu(
  name: string,
  options: Partial<Omit<ContextMenuDefinition, 'name' | 'type'>> = {},
): ContextMenuDefinition {
  return {
    name,
    type: 'user',
    ...options,
  };
}

/**
 * Create a message context menu command definition
 *
 * @param name - Command name (shown in right-click menu)
 * @param options - Additional options
 */
export function createMessageContextMenu(
  name: string,
  options: Partial<Omit<ContextMenuDefinition, 'name' | 'type'>> = {},
): ContextMenuDefinition {
  return {
    name,
    type: 'message',
    ...options,
  };
}
