/**
 * Poll message sender
 *
 * Handles creating and managing polls.
 */

import type { Client, DMChannel, PollLayoutType, TextChannel, ThreadChannel } from 'discord.js';
import type { PollOptions } from '../types';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Build poll data from options
 *
 * @param options - Poll configuration
 * @returns Poll data for Discord API
 */
export function buildPoll(options: PollOptions): {
  question: { text: string };
  answers: Array<{ text: string; emoji?: string }>;
  duration: number;
  allowMultiselect: boolean;
  layoutType: PollLayoutType;
} {
  return {
    question: { text: options.question },
    answers: options.answers.map((answer) => ({ text: answer })),
    duration: options.durationHours ?? 24, // Default to 24 hours
    allowMultiselect: options.multiSelect ?? false,
    layoutType: 1, // DEFAULT layout
  };
}

/**
 * Send a poll message
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param options - Poll options
 * @param replyToId - Optional message ID to reply to
 * @returns Message ID
 */
export async function sendPollMessage(
  client: Client,
  channelId: string,
  options: PollOptions,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const pollData = buildPoll(options);

  const messageOptions: Parameters<SendableChannel['send']>[0] = {
    poll: pollData,
  };

  if (replyToId) {
    messageOptions.reply = { messageReference: replyToId };
  }

  const result = await sendChannel.send(messageOptions);
  return result.id;
}

/**
 * End a poll immediately
 *
 * @param client - Discord client
 * @param channelId - Channel containing the poll
 * @param messageId - Message ID of the poll
 */
export async function endPoll(client: Client, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  if (!message.poll) {
    throw new Error('Message is not a poll');
  }

  await message.poll.end();
}

/**
 * Get poll results
 *
 * @param client - Discord client
 * @param channelId - Channel containing the poll
 * @param messageId - Message ID of the poll
 * @returns Poll results
 */
export async function getPollResults(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<{
  question: string;
  answers: Array<{ text: string; voteCount: number }>;
  totalVotes: number;
  finalized: boolean;
}> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  if (!message.poll) {
    throw new Error('Message is not a poll');
  }

  const poll = message.poll;
  const answers = poll.answers.map((answer) => ({
    text: answer.text ?? '',
    voteCount: answer.voteCount,
  }));

  const totalVotes = answers.reduce((sum, a) => sum + a.voteCount, 0);

  return {
    question: poll.question.text ?? '',
    answers,
    totalVotes,
    finalized: poll.resultsFinalized ?? false,
  };
}
