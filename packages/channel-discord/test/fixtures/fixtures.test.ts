/**
 * Discord Fixtures Tests
 *
 * Validates that real Discord gateway payloads can be parsed correctly.
 * These fixtures were captured using DEBUG_PAYLOADS=true.
 */

import { describe, expect, it } from 'bun:test';
import fixtures from './real-payloads.json';

describe('Discord Fixtures', () => {
  describe('connection', () => {
    it('should have READY event with bot user info', () => {
      const ready = fixtures.connection.READY[0];
      expect(ready).toBeDefined();
      expect(ready.payload.user).toBeDefined();
      expect(ready.payload.user.bot).toBe(true);
      expect(ready.payload.user.id).toBeDefined();
      expect(ready.payload.guilds).toBeArray();
    });
  });

  describe('messages', () => {
    it('should have MESSAGE_CREATE with content', () => {
      const messages = fixtures.messages.MESSAGE_CREATE;
      expect(messages.length).toBeGreaterThan(0);

      const msg = messages[0];
      expect(msg.payload.id).toBeDefined();
      expect(msg.payload.channel_id).toBeDefined();
      expect(msg.payload.author).toBeDefined();
      expect(msg.payload.author.id).toBeDefined();
    });

    it('should have MESSAGE_UPDATE for edits', () => {
      const updates = fixtures.messages.MESSAGE_UPDATE;
      expect(updates.length).toBeGreaterThan(0);

      const update = updates[0];
      expect(update.payload.id).toBeDefined();
      expect(update.payload.channel_id).toBeDefined();
    });

    it('should have MESSAGE_DELETE', () => {
      const deletes = fixtures.messages.MESSAGE_DELETE;
      expect(deletes.length).toBeGreaterThan(0);

      const del = deletes[0];
      expect(del.payload.id).toBeDefined();
      expect(del.payload.channel_id).toBeDefined();
    });
  });

  describe('reactions', () => {
    it('should have MESSAGE_REACTION_ADD with emoji', () => {
      const reactions = fixtures.reactions.MESSAGE_REACTION_ADD;
      expect(reactions.length).toBeGreaterThan(0);

      const reaction = reactions[0];
      expect(reaction.payload.message_id).toBeDefined();
      expect(reaction.payload.channel_id).toBeDefined();
      expect(reaction.payload.user_id).toBeDefined();
      expect(reaction.payload.emoji).toBeDefined();
    });

    it('should have MESSAGE_REACTION_REMOVE', () => {
      const reactions = fixtures.reactions.MESSAGE_REACTION_REMOVE;
      expect(reactions.length).toBeGreaterThan(0);

      const reaction = reactions[0];
      expect(reaction.payload.message_id).toBeDefined();
      expect(reaction.payload.emoji).toBeDefined();
    });
  });

  describe('channels', () => {
    it('should have CHANNEL_CREATE', () => {
      const channels = fixtures.channels.CHANNEL_CREATE;
      expect(channels.length).toBeGreaterThan(0);

      const channel = channels[0];
      expect(channel.payload.id).toBeDefined();
      expect(channel.payload.type).toBeDefined();
    });

    it('should have CHANNEL_DELETE', () => {
      const channels = fixtures.channels.CHANNEL_DELETE;
      expect(channels.length).toBeGreaterThan(0);

      const channel = channels[0];
      expect(channel.payload.id).toBeDefined();
    });

    it('should have CHANNEL_UPDATE', () => {
      const channels = fixtures.channels.CHANNEL_UPDATE;
      expect(channels.length).toBeGreaterThan(0);
    });
  });

  describe('threads', () => {
    it('should have THREAD_CREATE', () => {
      const threads = fixtures.threads.THREAD_CREATE;
      expect(threads.length).toBeGreaterThan(0);

      const thread = threads[0];
      expect(thread.payload.id).toBeDefined();
      expect(thread.payload.name).toBeDefined();
      expect(thread.payload.parent_id).toBeDefined();
    });
  });

  describe('voice', () => {
    it('should have VOICE_STATE_UPDATE for join/leave', () => {
      const states = fixtures.voice.VOICE_STATE_UPDATE;
      expect(states.length).toBeGreaterThan(0);

      const state = states[0];
      expect(state.payload.user_id).toBeDefined();
      expect(state.payload.guild_id).toBeDefined();
    });

    it('should have VOICE_CHANNEL_STATUS_UPDATE', () => {
      const statuses = fixtures.voice.VOICE_CHANNEL_STATUS_UPDATE;
      expect(statuses.length).toBeGreaterThan(0);

      const status = statuses[0];
      expect(status.payload.id).toBeDefined();
      expect(status.payload.guild_id).toBeDefined();
    });
  });

  describe('presence', () => {
    it('should have PRESENCE_UPDATE', () => {
      const presences = fixtures.presence.PRESENCE_UPDATE;
      expect(presences.length).toBeGreaterThan(0);

      const presence = presences[0];
      expect(presence.payload.user).toBeDefined();
      expect(presence.payload.status).toBeDefined();
    });

    it('should have TYPING_START', () => {
      const typings = fixtures.presence.TYPING_START;
      expect(typings.length).toBeGreaterThan(0);

      const typing = typings[0];
      expect(typing.payload.channel_id).toBeDefined();
      expect(typing.payload.user_id).toBeDefined();
    });
  });

  describe('polls', () => {
    it('should have MESSAGE_POLL_VOTE_ADD', () => {
      const votes = fixtures.polls.MESSAGE_POLL_VOTE_ADD;
      expect(votes.length).toBeGreaterThan(0);

      const vote = votes[0];
      expect(vote.payload.message_id).toBeDefined();
      expect(vote.payload.channel_id).toBeDefined();
      expect(vote.payload.user_id).toBeDefined();
      expect(vote.payload.answer_id).toBeDefined();
    });

    it('should have MESSAGE_POLL_VOTE_REMOVE', () => {
      const votes = fixtures.polls.MESSAGE_POLL_VOTE_REMOVE;
      expect(votes.length).toBeGreaterThan(0);

      const vote = votes[0];
      expect(vote.payload.message_id).toBeDefined();
      expect(vote.payload.answer_id).toBeDefined();
    });
  });

  describe('guild', () => {
    it('should have GUILD_CREATE with full guild info', () => {
      const guilds = fixtures.guild.GUILD_CREATE;
      expect(guilds.length).toBeGreaterThan(0);

      const guild = guilds[0];
      expect(guild.payload.id).toBeDefined();
      expect(guild.payload.name).toBeDefined();
      expect(guild.payload.channels).toBeArray();
      expect(guild.payload.members).toBeArray();
      expect(guild.payload.roles).toBeArray();
    });
  });
});
