/**
 * Discord application commands
 *
 * Provides registration and management of slash commands and context menus.
 */

// Slash commands
export {
  buildSlashCommand,
  registerGlobalCommands,
  registerGuildCommands,
  registerCommands,
  deleteGlobalCommand,
  deleteGuildCommand,
  clearGlobalCommands,
  clearGuildCommands,
} from './slash';

// Context menu commands
export {
  buildContextMenuCommand,
  registerGlobalContextMenus,
  registerGuildContextMenus,
  createUserContextMenu,
  createMessageContextMenu,
} from './context';

// Types
export type {
  SlashCommandDefinition,
  ContextMenuDefinition,
  CommandOption,
  CommandOptionType,
} from './types';
