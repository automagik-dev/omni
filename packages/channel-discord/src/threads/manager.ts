/**
 * Thread lifecycle management
 *
 * Create, archive, and manage Discord threads programmatically.
 * Supports public/private threads, forum posts, and member management.
 *
 * Defaults to PublicThread for standalone threads (matching OpenClaw fix).
 */

import { createLogger } from '@omni/core';
import { type BaseGuildTextChannel, ChannelType, type Client, type ForumChannel, type ThreadChannel } from 'discord.js';

const log = createLogger('discord:threads');

/**
 * Thread type options
 */
export type ThreadType = 'public' | 'private';

/**
 * Options for creating a thread
 */
export interface CreateThreadOptions {
  /** Name of the thread */
  name: string;
  /** Thread type (default: 'public') */
  type?: ThreadType;
  /** Auto-archive duration in minutes (60, 1440, 4320, 10080) */
  autoArchiveMinutes?: 60 | 1440 | 4320 | 10080;
  /** Reason for audit log */
  reason?: string;
  /** Message to start the thread from (creates thread on message) */
  startMessageId?: string;
}

/**
 * Options for creating a forum post
 */
export interface CreateForumPostOptions {
  /** Post title (thread name) */
  name: string;
  /** Starter message content */
  content: string;
  /** Tag IDs to apply to the forum post */
  tags?: string[];
  /** Auto-archive duration in minutes */
  autoArchiveMinutes?: 60 | 1440 | 4320 | 10080;
}

/**
 * Map thread type string to Discord ChannelType
 */
function mapThreadType(type: ThreadType): ChannelType.PublicThread | ChannelType.PrivateThread {
  return type === 'private' ? ChannelType.PrivateThread : ChannelType.PublicThread;
}

/**
 * Create a thread in a text channel.
 *
 * Defaults to PublicThread for standalone threads.
 *
 * @param client - Discord client
 * @param channelId - Parent channel ID
 * @param options - Thread creation options
 * @returns Created thread channel
 */
export async function createThread(
  client: Client,
  channelId: string,
  options: CreateThreadOptions,
): Promise<ThreadChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new Error(`Channel ${channelId} does not support threads (must be a text or announcement channel)`);
  }

  const textChannel = channel as BaseGuildTextChannel;
  const threadType = mapThreadType(options.type ?? 'public');

  log.debug('Creating thread', {
    channelId,
    name: options.name,
    type: options.type ?? 'public',
    startMessageId: options.startMessageId,
  });

  if (options.startMessageId && options.type) {
    log.warn('Thread type option is ignored when startMessageId is provided — thread type is determined by Discord', {
      channelId,
      startMessageId: options.startMessageId,
      requestedType: options.type,
    });
  }

  if (options.startMessageId) {
    // Create thread from existing message
    const message = await textChannel.messages.fetch(options.startMessageId);
    const thread = await message.startThread({
      name: options.name,
      autoArchiveDuration: options.autoArchiveMinutes,
      reason: options.reason,
    });
    return thread;
  }

  // Create standalone thread
  const thread = await textChannel.threads.create({
    name: options.name,
    type: threadType,
    autoArchiveDuration: options.autoArchiveMinutes,
    reason: options.reason,
  });

  return thread;
}

/**
 * Create a forum post (thread with starter message in a forum channel).
 *
 * @param client - Discord client
 * @param channelId - Forum channel ID
 * @param options - Forum post options
 * @returns Created thread channel
 */
export async function createForumPost(
  client: Client,
  channelId: string,
  options: CreateForumPostOptions,
): Promise<ThreadChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    throw new Error(`Channel ${channelId} is not a forum channel`);
  }

  const forumChannel = channel as ForumChannel;

  log.debug('Creating forum post', {
    channelId,
    name: options.name,
    tags: options.tags,
  });

  const thread = await forumChannel.threads.create({
    name: options.name,
    autoArchiveDuration: options.autoArchiveMinutes,
    message: { content: options.content },
    appliedTags: options.tags,
  });

  return thread;
}

/**
 * Archive a thread.
 *
 * @param client - Discord client
 * @param threadId - Thread channel ID to archive
 */
export async function archiveThread(client: Client, threadId: string): Promise<void> {
  const channel = await client.channels.fetch(threadId);
  if (!channel || !('setArchived' in channel)) {
    throw new Error(`Channel ${threadId} is not a thread`);
  }

  const thread = channel as ThreadChannel;

  log.debug('Archiving thread', { threadId, name: thread.name });

  await thread.setArchived(true);
}

/**
 * Add a user to a thread.
 *
 * @param client - Discord client
 * @param threadId - Thread channel ID
 * @param userId - User ID to add
 */
export async function addThreadMember(client: Client, threadId: string, userId: string): Promise<void> {
  const channel = await client.channels.fetch(threadId);
  if (!channel || !channel.isThread()) {
    throw new Error(`Channel ${threadId} is not a thread`);
  }

  const thread = channel as ThreadChannel;

  log.debug('Adding member to thread', { threadId, userId });

  await thread.members.add(userId);
}
