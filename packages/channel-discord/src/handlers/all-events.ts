/**
 * Additional event handlers for Discord client
 *
 * Handles events beyond core messaging:
 * - Typing indicators
 * - Presence updates
 * - Thread events
 * - Guild events
 */

import { createLogger } from '@omni/core';
import type { Client, GuildMember, PartialGuildMember, Presence, ThreadChannel, Typing } from 'discord.js';
import type { DiscordPlugin } from '../plugin';

const log = createLogger('discord:events');

/**
 * Set up typing event handlers
 */
function setupTypingHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  client.on('typingStart', (typing: Typing) => {
    // Skip bot typing
    if (typing.user.bot) return;

    plugin.handleTypingStart(instanceId, typing.channel.id, typing.user.id);
  });
}

/**
 * Set up presence event handlers
 */
function setupPresenceHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  client.on('presenceUpdate', (oldPresence: Presence | null, newPresence: Presence) => {
    // Skip if no status change
    if (oldPresence?.status === newPresence.status) return;

    plugin.handlePresenceUpdate(instanceId, newPresence.userId, newPresence.status, newPresence.guild?.id);
  });
}

/**
 * Set up thread event handlers
 */
function setupThreadHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  // Thread created
  client.on('threadCreate', (thread: ThreadChannel, newlyCreated: boolean) => {
    if (newlyCreated) {
      plugin.handleThreadCreate(instanceId, thread.id, thread.name, thread.parentId ?? undefined);
    }
  });

  // Thread deleted
  client.on('threadDelete', (thread: ThreadChannel) => {
    plugin.handleThreadDelete(instanceId, thread.id);
  });

  // Thread updated (name change, archive, etc.)
  client.on('threadUpdate', (oldThread: ThreadChannel, newThread: ThreadChannel) => {
    plugin.handleThreadUpdate(instanceId, newThread.id, {
      name: newThread.name !== oldThread.name ? newThread.name : undefined,
      archived: newThread.archived !== oldThread.archived ? (newThread.archived ?? undefined) : undefined,
      locked: newThread.locked !== oldThread.locked ? (newThread.locked ?? undefined) : undefined,
    });
  });

  // Thread members updated (join/leave)
  client.on('threadMembersUpdate', (addedMembers, removedMembers, thread) => {
    const added = addedMembers.map((m) => m.id);
    const removed = removedMembers.map((m) => m.id);

    if (added.length > 0 || removed.length > 0) {
      plugin.handleThreadMembersUpdate(instanceId, thread.id, added, removed);
    }
  });
}

/**
 * Set up guild member event handlers
 */
function setupGuildMemberHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  // Member joined guild
  client.on('guildMemberAdd', (member: GuildMember) => {
    plugin.handleMemberJoin(instanceId, member.guild.id, member.id, member.user.tag);
  });

  // Member left guild
  client.on('guildMemberRemove', (member: GuildMember | PartialGuildMember) => {
    plugin.handleMemberLeave(instanceId, member.guild.id, member.id);
  });
}

/**
 * Set up channel event handlers
 */
function setupChannelHandlers(client: Client, _plugin: DiscordPlugin, instanceId: string): void {
  // Channel created
  client.on('channelCreate', (channel) => {
    log.debug('Channel created', {
      instanceId,
      channelId: channel.id,
      type: channel.type,
    });
  });

  // Channel deleted
  client.on('channelDelete', (channel) => {
    log.debug('Channel deleted', {
      instanceId,
      channelId: channel.id,
    });
  });
}

/**
 * Set up guild event handlers
 */
function setupGuildHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  // Bot joined a guild
  client.on('guildCreate', (guild) => {
    log.info('Bot joined guild', {
      instanceId,
      guildId: guild.id,
      guildName: guild.name,
      memberCount: guild.memberCount,
    });
    plugin.handleGuildJoin(instanceId, guild.id, guild.name);
  });

  // Bot left/kicked from a guild
  client.on('guildDelete', (guild) => {
    log.info('Bot left guild', {
      instanceId,
      guildId: guild.id,
      guildName: guild.name,
    });
    plugin.handleGuildLeave(instanceId, guild.id);
  });
}

/**
 * Set up ALL additional event handlers for a Discord client
 *
 * @param client - Discord.js Client instance
 * @param plugin - Discord plugin instance
 * @param instanceId - Instance identifier
 */
export function setupAllEventHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  setupTypingHandlers(client, plugin, instanceId);
  setupPresenceHandlers(client, plugin, instanceId);
  setupThreadHandlers(client, plugin, instanceId);
  setupGuildMemberHandlers(client, plugin, instanceId);
  setupChannelHandlers(client, plugin, instanceId);
  setupGuildHandlers(client, plugin, instanceId);
}
