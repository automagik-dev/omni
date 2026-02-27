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
import type { Client, GuildMember, Interaction, MessageComponentInteraction } from 'discord.js';
import { checkInteractionAuth } from '../auth/interaction-auth';
import { getComponentRegistry } from '../components/registry';
import type { DiscordPlugin } from '../plugin';
import {
  isAutocomplete,
  isButton,
  isChannelSelectMenu,
  isChatInputCommand,
  isContextMenuCommand,
  isMentionableSelectMenu,
  isModalSubmit,
  isRoleSelectMenu,
  isStringSelectMenu,
  isUserSelectMenu,
} from '../types';

const log = createLogger('discord:interactions');

/**
 * Extract user role IDs from an interaction for auth checking.
 * Handles both GuildMember (cache-backed) and APIInteractionGuildMember (string[]).
 */
function getUserRoleIds(interaction: Interaction): string[] {
  const member = interaction.member;
  if (!member) return [];
  return Array.isArray(member.roles)
    ? member.roles // APIInteractionGuildMember: string[]
    : [...(member as GuildMember).roles.cache.keys()]; // GuildMember: Collection
}

/**
 * Check component interaction authorization.
 *
 * Returns true if the interaction is allowed.
 * When denied, defers the interaction silently (so Discord doesn't show "failed")
 * and returns false — callers should return immediately.
 */
async function isComponentInteractionAuthorized(
  plugin: DiscordPlugin,
  instanceId: string,
  interaction: Interaction,
): Promise<boolean> {
  const authResult = checkInteractionAuth(
    {
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
      userRoleIds: getUserRoleIds(interaction),
    },
    plugin.getInteractionAuthConfig(instanceId),
  );

  if (!authResult.allowed) {
    log.debug('Component interaction denied by auth', {
      instanceId,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      reason: authResult.reason,
    });
    // Acknowledge silently so Discord doesn't show "Interaction failed".
    // Component interactions (buttons/selects) use deferUpdate; modal submits use deferReply.
    try {
      if ('deferUpdate' in interaction && typeof interaction.deferUpdate === 'function') {
        await (interaction as MessageComponentInteraction).deferUpdate();
      } else if (isModalSubmit(interaction)) {
        await interaction.deferReply({ ephemeral: true });
      }
    } catch (_) {
      // Ignore if already replied
    }
    return false;
  }

  return true;
}

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
  if (!(await isComponentInteractionAuthorized(plugin, instanceId, interaction))) return;
  if (!(await enforceRegistryTTL(instanceId, interaction, 'button'))) return;

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
  if (!(await isComponentInteractionAuthorized(plugin, instanceId, interaction))) return;
  if (!(await enforceRegistryTTL(instanceId, interaction, 'string select'))) return;

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
 * Enforce registry TTL for a component interaction.
 * Unregistered components (legacy) always pass through for backward compatibility.
 * Only components that were previously registered and have since expired are rate-limited.
 * Returns true if the interaction should proceed, false if suppressed.
 */
async function enforceRegistryTTL(instanceId: string, interaction: Interaction, label: string): Promise<boolean> {
  const messageId = (interaction as { message?: { id: string } }).message?.id;
  if (!messageId) return true;

  const registry = getComponentRegistry();
  if (registry.has(instanceId, messageId)) {
    // Active registered component — consume and proceed
    registry.resolve(instanceId, messageId);
    return true;
  }

  // Not in registry — check if it was previously registered (expired/consumed)
  // Legacy components that were never registered always pass through
  if (!registry.wasRegistered(instanceId, messageId)) {
    return true;
  }

  // Was registered but expired/consumed — always block (even if rate limit not triggered)
  const userId = interaction.user.id;
  log.debug(`Blocking stale ${label} interaction (expired/consumed)`, {
    instanceId,
    userId,
    messageId,
  });
  try {
    const ci = interaction as MessageComponentInteraction;
    if (!ci.replied && !ci.deferred) {
      await ci.deferUpdate();
    }
  } catch (_) {
    // Ignore
  }
  return false;
}

/**
 * Resolve the entity select menu type and extract values from the interaction.
 * Returns null if the interaction is not a recognized entity select menu.
 */
function resolveEntitySelectType(
  interaction: Interaction,
): { selectType: 'user' | 'role' | 'channel' | 'mentionable'; customId: string; values: string[] } | null {
  if (isUserSelectMenu(interaction)) {
    return { selectType: 'user', customId: interaction.customId, values: interaction.values.map(String) };
  }
  if (isRoleSelectMenu(interaction)) {
    return { selectType: 'role', customId: interaction.customId, values: interaction.values.map(String) };
  }
  if (isChannelSelectMenu(interaction)) {
    return { selectType: 'channel', customId: interaction.customId, values: interaction.values.map(String) };
  }
  if (isMentionableSelectMenu(interaction)) {
    return {
      selectType: 'mentionable',
      customId: interaction.customId,
      values: [...interaction.users.keys(), ...interaction.roles.keys()],
    };
  }
  return null;
}

/**
 * Process entity select menu interaction (user, role, channel, mentionable)
 */
async function processEntitySelectMenu(
  plugin: DiscordPlugin,
  instanceId: string,
  interaction: Interaction,
): Promise<void> {
  if (!(await isComponentInteractionAuthorized(plugin, instanceId, interaction))) return;
  if (!(await enforceRegistryTTL(instanceId, interaction, 'entity select'))) return;

  const base = extractBasePayload(interaction, instanceId);
  const resolved = resolveEntitySelectType(interaction);
  if (!resolved) return;

  await plugin.handleEntitySelectMenu({
    ...base,
    ...resolved,
  });

  // Defer update
  try {
    const ci = interaction as MessageComponentInteraction;
    if (!ci.replied && !ci.deferred) {
      await ci.deferUpdate();
    }
  } catch (error) {
    log.warn('Failed to defer entity select menu update', { instanceId, error });
  }
}

/**
 * Process modal submission interaction
 */
async function processModalSubmit(plugin: DiscordPlugin, instanceId: string, interaction: Interaction): Promise<void> {
  if (!isModalSubmit(interaction)) return;
  if (!(await isComponentInteractionAuthorized(plugin, instanceId, interaction))) return;

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
  if (
    isUserSelectMenu(interaction) ||
    isRoleSelectMenu(interaction) ||
    isChannelSelectMenu(interaction) ||
    isMentionableSelectMenu(interaction)
  ) {
    await processEntitySelectMenu(plugin, instanceId, interaction);
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
