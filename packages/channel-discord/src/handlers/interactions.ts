/**
 * Interaction event handlers for Discord client
 *
 * Handles Discord interactions:
 * - Slash commands
 * - Context menu commands
 * - Button clicks
 * - Select menu selections
 * - Modal submissions
 * - Autocomplete
 */

import { createLogger } from '@omni/core';
import type { Client, Interaction } from 'discord.js';
import type { DiscordPlugin } from '../plugin';
import {
  isAutocomplete,
  isButton,
  isChatInputCommand,
  isContextMenuCommand,
  isModalSubmit,
  isStringSelectMenu,
} from '../types';

const log = createLogger('discord:interactions');

/**
 * Extract common base payload from interaction
 */
function extractBasePayload(interaction: Interaction, instanceId: string) {
  return {
    instanceId,
    userId: interaction.user.id,
    channelId: interaction.channelId ?? '',
    guildId: interaction.guildId ?? undefined,
    interactionId: interaction.id,
    interactionToken: interaction.token,
  };
}

/**
 * Process slash command interaction
 */
async function processSlashCommand(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<void> {
  if (!isChatInputCommand(interaction)) return;

  const base = extractBasePayload(interaction, instanceId);

  // Extract options as key-value pairs
  const options: Record<string, unknown> = {};
  for (const option of interaction.options.data) {
    options[option.name] = option.value;
  }

  await plugin.handleSlashCommand({
    ...base,
    commandName: interaction.commandName,
    options,
  });

  // Defer reply to give time for processing
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }
  } catch (error) {
    log.warn('Failed to defer slash command reply', { instanceId, error });
  }
}

/**
 * Process context menu command interaction
 */
async function processContextMenu(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<void> {
  if (!isContextMenuCommand(interaction)) return;

  const base = extractBasePayload(interaction, instanceId);

  // Determine target type from interaction type
  const isUserCommand = interaction.isUserContextMenuCommand();

  await plugin.handleContextMenu({
    ...base,
    commandName: interaction.commandName,
    targetId: interaction.targetId,
    targetType: isUserCommand ? 'user' : 'message',
  });

  // Defer reply
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }
  } catch (error) {
    log.warn('Failed to defer context menu reply', { instanceId, error });
  }
}

/**
 * Process button click interaction
 */
async function processButton(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<void> {
  if (!isButton(interaction)) return;

  const base = extractBasePayload(interaction, instanceId);

  await plugin.handleButtonClick({
    ...base,
    customId: interaction.customId,
    messageId: interaction.message.id,
  });

  // Defer update to acknowledge the interaction
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }
  } catch (error) {
    log.warn('Failed to defer button update', { instanceId, error });
  }
}

/**
 * Process select menu interaction
 */
async function processSelectMenu(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<void> {
  if (!isStringSelectMenu(interaction)) return;

  const base = extractBasePayload(interaction, instanceId);

  await plugin.handleSelectMenu({
    ...base,
    customId: interaction.customId,
    values: interaction.values,
  });

  // Defer update
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }
  } catch (error) {
    log.warn('Failed to defer select menu update', { instanceId, error });
  }
}

/**
 * Process modal submission interaction
 */
async function processModalSubmit(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<void> {
  if (!isModalSubmit(interaction)) return;

  const base = extractBasePayload(interaction, instanceId);

  // Extract field values using the fields property (only text inputs have value)
  const fields: Record<string, string> = {};
  for (const [customId, field] of interaction.fields.fields) {
    // Only TextInputModalData has the 'value' property
    if ('value' in field && typeof field.value === 'string') {
      fields[customId] = field.value;
    }
  }

  await plugin.handleModalSubmit({
    ...base,
    customId: interaction.customId,
    fields,
  });

  // Defer reply for modal submit
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }
  } catch (error) {
    log.warn('Failed to defer modal reply', { instanceId, error });
  }
}

/**
 * Process autocomplete interaction
 */
async function processAutocomplete(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<void> {
  if (!isAutocomplete(interaction)) return;

  const base = extractBasePayload(interaction, instanceId);
  const focused = interaction.options.getFocused(true);

  await plugin.handleAutocomplete({
    ...base,
    commandName: interaction.commandName,
    focusedOption: {
      name: focused.name,
      value: String(focused.value),
    },
  });

  // Note: Autocomplete needs immediate response via callback
  // The plugin should respond using respondToAutocomplete
}

/**
 * Route interaction to appropriate handler
 */
async function routeInteraction(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<boolean> {
  if (isChatInputCommand(interaction)) {
    await processSlashCommand(plugin, instanceId, interaction);
    return true;
  }
  if (isContextMenuCommand(interaction)) {
    await processContextMenu(plugin, instanceId, interaction);
    return true;
  }
  if (isButton(interaction)) {
    await processButton(plugin, instanceId, interaction);
    return true;
  }
  if (isStringSelectMenu(interaction)) {
    await processSelectMenu(plugin, instanceId, interaction);
    return true;
  }
  if (isModalSubmit(interaction)) {
    await processModalSubmit(plugin, instanceId, interaction);
    return true;
  }
  if (isAutocomplete(interaction)) {
    await processAutocomplete(plugin, instanceId, interaction);
    return true;
  }
  return false;
}

/**
 * Set up interaction event handlers for a Discord client
 *
 * @param client - Discord.js Client instance
 * @param plugin - Discord plugin instance
 * @param instanceId - Instance identifier
 */
export function setupInteractionHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  client.on('interactionCreate', async (interaction) => {
    try {
      const handled = await routeInteraction(plugin, instanceId, interaction);
      if (!handled) {
        log.debug('Unhandled interaction type', { instanceId, type: interaction.type });
      }
    } catch (error) {
      log.error('Error processing interaction', {
        instanceId,
        interactionId: interaction.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
