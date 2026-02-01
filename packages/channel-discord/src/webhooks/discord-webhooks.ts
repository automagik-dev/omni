/**
 * Discord webhook management
 *
 * Handles creating and using Discord webhooks.
 */

import type { Client, NewsChannel, TextChannel, WebhookMessageCreateOptions } from 'discord.js';
import { buildEmbed } from '../senders/embeds';
import type { DiscordWebhookInfo, WebhookSendOptions } from '../types';

type WebhookableChannel = TextChannel | NewsChannel;

/**
 * Create a webhook for a channel
 *
 * @param client - Discord client
 * @param channelId - Channel to create webhook for
 * @param name - Webhook name
 * @param avatar - Optional avatar URL
 * @returns Webhook info
 */
export async function createWebhook(
  client: Client,
  channelId: string,
  name: string,
  avatar?: string,
): Promise<DiscordWebhookInfo> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('createWebhook' in channel)) {
    throw new Error(`Channel ${channelId} does not support webhooks`);
  }

  const webhookChannel = channel as WebhookableChannel;
  const webhook = await webhookChannel.createWebhook({
    name,
    avatar,
    reason: 'Created by Omni Discord plugin',
  });

  // Newly created webhooks should always have a token
  if (!webhook.token) {
    throw new Error('Created webhook has no token - this is unexpected');
  }

  return {
    id: webhook.id,
    token: webhook.token,
    channelId: webhook.channelId,
    guildId: webhook.guildId ?? undefined,
    name: webhook.name ?? undefined,
    avatar: webhook.avatar ?? undefined,
  };
}

/**
 * Get webhook info
 *
 * @param client - Discord client
 * @param webhookId - Webhook ID
 * @param token - Webhook token (optional, but allows more operations)
 * @returns Webhook info or null if not found
 */
export async function getWebhook(
  client: Client,
  webhookId: string,
  token?: string,
): Promise<DiscordWebhookInfo | null> {
  try {
    const webhook = token ? await client.fetchWebhook(webhookId, token) : await client.fetchWebhook(webhookId);

    return {
      id: webhook.id,
      token: webhook.token ?? '',
      channelId: webhook.channelId,
      guildId: webhook.guildId ?? undefined,
      name: webhook.name ?? undefined,
      avatar: webhook.avatar ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * List webhooks for a channel
 *
 * @param client - Discord client
 * @param channelId - Channel ID
 * @returns Array of webhook info
 */
export async function listChannelWebhooks(client: Client, channelId: string): Promise<DiscordWebhookInfo[]> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('fetchWebhooks' in channel)) {
    throw new Error(`Channel ${channelId} does not support webhooks`);
  }

  const webhookChannel = channel as WebhookableChannel;
  const webhooks = await webhookChannel.fetchWebhooks();

  return webhooks.map((webhook) => ({
    id: webhook.id,
    token: webhook.token ?? '',
    channelId: webhook.channelId,
    guildId: webhook.guildId ?? undefined,
    name: webhook.name ?? undefined,
    avatar: webhook.avatar ?? undefined,
  }));
}

/**
 * Delete a webhook
 *
 * @param client - Discord client
 * @param webhookId - Webhook ID
 * @param token - Webhook token (optional)
 */
export async function deleteWebhook(client: Client, webhookId: string, token?: string): Promise<void> {
  const webhook = token ? await client.fetchWebhook(webhookId, token) : await client.fetchWebhook(webhookId);

  await webhook.delete('Deleted by Omni Discord plugin');
}

/**
 * Send a message via webhook
 *
 * @param client - Discord client
 * @param webhookId - Webhook ID
 * @param token - Webhook token
 * @param options - Message options
 * @returns Message ID
 */
export async function sendWebhookMessage(
  client: Client,
  webhookId: string,
  token: string,
  options: WebhookSendOptions,
): Promise<string> {
  const webhook = await client.fetchWebhook(webhookId, token);

  const messageOptions: WebhookMessageCreateOptions = {};

  if (options.content) {
    messageOptions.content = options.content;
  }

  if (options.username) {
    messageOptions.username = options.username;
  }

  if (options.avatarUrl) {
    messageOptions.avatarURL = options.avatarUrl;
  }

  if (options.embeds) {
    messageOptions.embeds = options.embeds.map(buildEmbed);
  }

  if (options.threadId) {
    messageOptions.threadId = options.threadId;
  }

  const message = await webhook.send(messageOptions);
  return message.id;
}

/**
 * Edit a webhook message
 *
 * @param client - Discord client
 * @param webhookId - Webhook ID
 * @param token - Webhook token
 * @param messageId - Message ID to edit
 * @param options - New message options
 */
export async function editWebhookMessage(
  client: Client,
  webhookId: string,
  token: string,
  messageId: string,
  options: Partial<WebhookSendOptions>,
): Promise<void> {
  const webhook = await client.fetchWebhook(webhookId, token);

  const editOptions: { content?: string; embeds?: ReturnType<typeof buildEmbed>[] } = {};

  if (options.content !== undefined) {
    editOptions.content = options.content;
  }

  if (options.embeds) {
    editOptions.embeds = options.embeds.map(buildEmbed);
  }

  await webhook.editMessage(messageId, editOptions);
}

/**
 * Delete a webhook message
 *
 * @param client - Discord client
 * @param webhookId - Webhook ID
 * @param token - Webhook token
 * @param messageId - Message ID to delete
 */
export async function deleteWebhookMessage(
  client: Client,
  webhookId: string,
  token: string,
  messageId: string,
): Promise<void> {
  const webhook = await client.fetchWebhook(webhookId, token);
  await webhook.deleteMessage(messageId);
}

/**
 * Update webhook settings
 *
 * @param client - Discord client
 * @param webhookId - Webhook ID
 * @param token - Webhook token
 * @param options - New settings
 */
export async function updateWebhook(
  client: Client,
  webhookId: string,
  token: string | undefined,
  options: { name?: string; avatar?: string; channelId?: string },
): Promise<void> {
  const webhook = token ? await client.fetchWebhook(webhookId, token) : await client.fetchWebhook(webhookId);

  await webhook.edit({
    name: options.name,
    avatar: options.avatar,
    channel: options.channelId,
    reason: 'Updated by Omni Discord plugin',
  });
}
