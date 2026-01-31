/**
 * Discord-specific types for the channel plugin
 */

import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  Message,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserContextMenuCommandInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';

// ─────────────────────────────────────────────────────────────
// Connection options
// ─────────────────────────────────────────────────────────────

/**
 * Discord connection options - passed per instance
 */
export interface DiscordConnectionOptions {
  /** Bot token (required for initial connect, then stored) */
  token?: string;
}

/**
 * Discord plugin configuration (global defaults)
 */
export interface DiscordConfig extends DiscordConnectionOptions {}

// ─────────────────────────────────────────────────────────────
// ID types (Discord Snowflakes)
// ─────────────────────────────────────────────────────────────

/** Discord Snowflake ID (19-digit string) */
export type DiscordId = string;

/** Guild (server) ID */
export type GuildId = DiscordId;

/** Channel ID */
export type ChannelId = DiscordId;

/** User ID */
export type UserId = DiscordId;

/** Message ID */
export type MessageId = DiscordId;

// ─────────────────────────────────────────────────────────────
// Embed types
// ─────────────────────────────────────────────────────────────

/**
 * Options for building an embed
 */
export interface EmbedOptions {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: Date | number;
  footer?: string | { text: string; iconUrl?: string };
  thumbnail?: string;
  image?: string;
  author?: { name: string; iconUrl?: string; url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

// ─────────────────────────────────────────────────────────────
// Poll types
// ─────────────────────────────────────────────────────────────

/**
 * Options for creating a poll
 */
export interface PollOptions {
  question: string;
  answers: string[];
  durationHours?: number;
  multiSelect?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Component types
// ─────────────────────────────────────────────────────────────

/**
 * Button style (matches Discord.js ButtonStyle)
 */
export type ButtonStyleType = 'Primary' | 'Secondary' | 'Success' | 'Danger' | 'Link';

/**
 * Options for building a button
 */
export interface ButtonOptions {
  customId: string;
  label: string;
  style?: ButtonStyleType;
  disabled?: boolean;
  emoji?: string;
  url?: string; // For Link buttons only
}

/**
 * Select menu option
 */
export interface SelectMenuOption {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
  default?: boolean;
}

/**
 * Options for building a select menu
 */
export interface SelectMenuOptions {
  customId: string;
  placeholder?: string;
  options: SelectMenuOption[];
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}

/**
 * Modal text input field
 */
export interface ModalField {
  customId: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
  value?: string;
}

/**
 * Options for building a modal
 */
export interface ModalOptions {
  customId: string;
  title: string;
  fields: ModalField[];
}

// ─────────────────────────────────────────────────────────────
// Command types
// ─────────────────────────────────────────────────────────────

/**
 * Slash command option type
 */
export type CommandOptionType =
  | 'string'
  | 'integer'
  | 'boolean'
  | 'user'
  | 'channel'
  | 'role'
  | 'mentionable'
  | 'number'
  | 'attachment';

/**
 * Slash command option definition
 */
export interface CommandOption {
  name: string;
  description: string;
  type: CommandOptionType;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
  autocomplete?: boolean;
  minValue?: number;
  maxValue?: number;
  minLength?: number;
  maxLength?: number;
}

/**
 * Slash command definition
 */
export interface SlashCommandDefinition {
  name: string;
  description: string;
  options?: CommandOption[];
  guildId?: string; // If set, only register in this guild
  defaultMemberPermissions?: string;
  dmPermission?: boolean;
}

/**
 * Context menu command definition
 */
export interface ContextMenuDefinition {
  name: string;
  type: 'user' | 'message';
  guildId?: string;
  defaultMemberPermissions?: string;
  dmPermission?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Interaction event payloads
// ─────────────────────────────────────────────────────────────

/**
 * Base interaction payload (common fields)
 */
export interface BaseInteractionPayload {
  instanceId: string;
  userId: UserId;
  channelId: ChannelId;
  guildId?: GuildId;
  interactionId: string;
  interactionToken: string;
}

/**
 * Slash command interaction payload
 */
export interface SlashCommandPayload extends BaseInteractionPayload {
  commandName: string;
  options: Record<string, unknown>;
}

/**
 * Context menu interaction payload
 */
export interface ContextMenuPayload extends BaseInteractionPayload {
  commandName: string;
  targetId: string;
  targetType: 'user' | 'message';
}

/**
 * Button click payload
 */
export interface ButtonPayload extends BaseInteractionPayload {
  customId: string;
  messageId: MessageId;
}

/**
 * Select menu payload
 */
export interface SelectMenuPayload extends BaseInteractionPayload {
  customId: string;
  values: string[];
}

/**
 * Modal submit payload
 */
export interface ModalSubmitPayload extends BaseInteractionPayload {
  customId: string;
  fields: Record<string, string>;
}

/**
 * Autocomplete payload
 */
export interface AutocompletePayload extends BaseInteractionPayload {
  commandName: string;
  focusedOption: { name: string; value: string };
}

// ─────────────────────────────────────────────────────────────
// Message content types
// ─────────────────────────────────────────────────────────────

/**
 * Extracted content from a Discord message
 */
export interface ExtractedContent {
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'reaction' | 'poll' | 'unknown';
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
  duration?: number;
  emoji?: string;
  targetMessageId?: string;
  stickerId?: string;
  poll?: {
    question: string;
    answers: string[];
    multiSelect: boolean;
    expiresAt?: Date;
  };
}

// ─────────────────────────────────────────────────────────────
// Webhook types
// ─────────────────────────────────────────────────────────────

/**
 * Discord webhook info
 */
export interface DiscordWebhookInfo {
  id: string;
  token: string;
  channelId: ChannelId;
  guildId?: GuildId;
  name?: string;
  avatar?: string;
}

/**
 * Send via webhook options
 */
export interface WebhookSendOptions {
  content?: string;
  username?: string;
  avatarUrl?: string;
  embeds?: EmbedOptions[];
  threadId?: string;
}

// ─────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────

/**
 * Check if interaction is a chat input command
 */
export function isChatInputCommand(interaction: unknown): interaction is ChatInputCommandInteraction {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'isChatInputCommand' in interaction &&
    typeof (interaction as { isChatInputCommand: () => boolean }).isChatInputCommand === 'function' &&
    (interaction as { isChatInputCommand: () => boolean }).isChatInputCommand()
  );
}

/**
 * Check if interaction is a button
 */
export function isButton(interaction: unknown): interaction is ButtonInteraction {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'isButton' in interaction &&
    typeof (interaction as { isButton: () => boolean }).isButton === 'function' &&
    (interaction as { isButton: () => boolean }).isButton()
  );
}

/**
 * Check if interaction is a string select menu
 */
export function isStringSelectMenu(interaction: unknown): interaction is StringSelectMenuInteraction {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'isStringSelectMenu' in interaction &&
    typeof (interaction as { isStringSelectMenu: () => boolean }).isStringSelectMenu === 'function' &&
    (interaction as { isStringSelectMenu: () => boolean }).isStringSelectMenu()
  );
}

/**
 * Check if interaction is any select menu
 */
export function isAnySelectMenu(
  interaction: unknown,
): interaction is
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'isAnySelectMenu' in interaction &&
    typeof (interaction as { isAnySelectMenu: () => boolean }).isAnySelectMenu === 'function' &&
    (interaction as { isAnySelectMenu: () => boolean }).isAnySelectMenu()
  );
}

/**
 * Check if interaction is a modal submit
 */
export function isModalSubmit(interaction: unknown): interaction is ModalSubmitInteraction {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'isModalSubmit' in interaction &&
    typeof (interaction as { isModalSubmit: () => boolean }).isModalSubmit === 'function' &&
    (interaction as { isModalSubmit: () => boolean }).isModalSubmit()
  );
}

/**
 * Check if interaction is a context menu command
 */
export function isContextMenuCommand(
  interaction: unknown,
): interaction is UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'isContextMenuCommand' in interaction &&
    typeof (interaction as { isContextMenuCommand: () => boolean }).isContextMenuCommand === 'function' &&
    (interaction as { isContextMenuCommand: () => boolean }).isContextMenuCommand()
  );
}

/**
 * Check if interaction is an autocomplete
 */
export function isAutocomplete(interaction: unknown): interaction is {
  isAutocomplete: () => boolean;
  options: { getFocused: (full: boolean) => { name: string; value: string } };
  commandName: string;
} {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'isAutocomplete' in interaction &&
    typeof (interaction as { isAutocomplete: () => boolean }).isAutocomplete === 'function' &&
    (interaction as { isAutocomplete: () => boolean }).isAutocomplete()
  );
}

// ─────────────────────────────────────────────────────────────
// Raw message type alias
// ─────────────────────────────────────────────────────────────

export type DiscordMessage = Message;
