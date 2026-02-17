/**
 * Tests for entity select menu builders
 */

import { describe, expect, test } from 'bun:test';
import {
  ChannelSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import {
  buildChannelSelectMenu,
  buildChannelSelectMenuRow,
  buildMentionableSelectMenu,
  buildMentionableSelectMenuRow,
  buildRoleSelectMenu,
  buildRoleSelectMenuRow,
  buildUserSelectMenu,
  buildUserSelectMenuRow,
  sendEphemeralReply,
} from '../components/entity-selects';

describe('Entity Select Menus', () => {
  describe('buildUserSelectMenu', () => {
    test('creates user select menu with customId', () => {
      const menu = buildUserSelectMenu({ customId: 'pick-user' });
      expect(menu).toBeInstanceOf(UserSelectMenuBuilder);
      expect(menu.toJSON().custom_id).toBe('pick-user');
    });

    test('sets placeholder', () => {
      const menu = buildUserSelectMenu({ customId: 'pick-user', placeholder: 'Select a user...' });
      expect(menu.toJSON().placeholder).toBe('Select a user...');
    });

    test('sets min/max values', () => {
      const menu = buildUserSelectMenu({ customId: 'pick-user', minValues: 1, maxValues: 3 });
      const json = menu.toJSON();
      expect(json.min_values).toBe(1);
      expect(json.max_values).toBe(3);
    });

    test('sets disabled state', () => {
      const menu = buildUserSelectMenu({ customId: 'pick-user', disabled: true });
      expect(menu.toJSON().disabled).toBe(true);
    });

    test('defaults to enabled', () => {
      const menu = buildUserSelectMenu({ customId: 'pick-user' });
      expect(menu.toJSON().disabled).toBe(false);
    });
  });

  describe('buildRoleSelectMenu', () => {
    test('creates role select menu with customId', () => {
      const menu = buildRoleSelectMenu({ customId: 'pick-role' });
      expect(menu).toBeInstanceOf(RoleSelectMenuBuilder);
      expect(menu.toJSON().custom_id).toBe('pick-role');
    });

    test('sets placeholder', () => {
      const menu = buildRoleSelectMenu({ customId: 'pick-role', placeholder: 'Select a role...' });
      expect(menu.toJSON().placeholder).toBe('Select a role...');
    });

    test('sets min/max values', () => {
      const menu = buildRoleSelectMenu({ customId: 'pick-role', minValues: 1, maxValues: 5 });
      const json = menu.toJSON();
      expect(json.min_values).toBe(1);
      expect(json.max_values).toBe(5);
    });

    test('defaults to enabled', () => {
      const menu = buildRoleSelectMenu({ customId: 'pick-role' });
      expect(menu.toJSON().disabled).toBe(false);
    });
  });

  describe('buildChannelSelectMenu', () => {
    test('creates channel select menu with customId', () => {
      const menu = buildChannelSelectMenu({ customId: 'pick-channel' });
      expect(menu).toBeInstanceOf(ChannelSelectMenuBuilder);
      expect(menu.toJSON().custom_id).toBe('pick-channel');
    });

    test('sets placeholder', () => {
      const menu = buildChannelSelectMenu({ customId: 'pick-channel', placeholder: 'Select a channel...' });
      expect(menu.toJSON().placeholder).toBe('Select a channel...');
    });

    test('sets min/max values', () => {
      const menu = buildChannelSelectMenu({ customId: 'pick-channel', minValues: 1, maxValues: 2 });
      const json = menu.toJSON();
      expect(json.min_values).toBe(1);
      expect(json.max_values).toBe(2);
    });

    test('sets channel types filter', () => {
      // ChannelType.GuildText = 0, ChannelType.GuildVoice = 2
      const menu = buildChannelSelectMenu({ customId: 'pick-channel', channelTypes: [0, 2] });
      const json = menu.toJSON();
      expect(json.channel_types).toEqual([0, 2]);
    });

    test('defaults to enabled', () => {
      const menu = buildChannelSelectMenu({ customId: 'pick-channel' });
      expect(menu.toJSON().disabled).toBe(false);
    });
  });

  describe('buildMentionableSelectMenu', () => {
    test('creates mentionable select menu with customId', () => {
      const menu = buildMentionableSelectMenu({ customId: 'pick-mentionable' });
      expect(menu).toBeInstanceOf(MentionableSelectMenuBuilder);
      expect(menu.toJSON().custom_id).toBe('pick-mentionable');
    });

    test('sets placeholder', () => {
      const menu = buildMentionableSelectMenu({ customId: 'pick-mentionable', placeholder: 'Select user or role...' });
      expect(menu.toJSON().placeholder).toBe('Select user or role...');
    });

    test('sets min/max values', () => {
      const menu = buildMentionableSelectMenu({ customId: 'pick-mentionable', minValues: 1, maxValues: 10 });
      const json = menu.toJSON();
      expect(json.min_values).toBe(1);
      expect(json.max_values).toBe(10);
    });

    test('defaults to enabled', () => {
      const menu = buildMentionableSelectMenu({ customId: 'pick-mentionable' });
      expect(menu.toJSON().disabled).toBe(false);
    });
  });

  describe('Action Row Builders', () => {
    test('buildUserSelectMenuRow wraps in action row', () => {
      const row = buildUserSelectMenuRow({ customId: 'user-row' });
      const json = row.toJSON();
      expect(json.components).toHaveLength(1);
      expect(json.components[0].custom_id).toBe('user-row');
    });

    test('buildRoleSelectMenuRow wraps in action row', () => {
      const row = buildRoleSelectMenuRow({ customId: 'role-row' });
      const json = row.toJSON();
      expect(json.components).toHaveLength(1);
      expect(json.components[0].custom_id).toBe('role-row');
    });

    test('buildChannelSelectMenuRow wraps in action row', () => {
      const row = buildChannelSelectMenuRow({ customId: 'channel-row' });
      const json = row.toJSON();
      expect(json.components).toHaveLength(1);
      expect(json.components[0].custom_id).toBe('channel-row');
    });

    test('buildMentionableSelectMenuRow wraps in action row', () => {
      const row = buildMentionableSelectMenuRow({ customId: 'mentionable-row' });
      const json = row.toJSON();
      expect(json.components).toHaveLength(1);
      expect(json.components[0].custom_id).toBe('mentionable-row');
    });
  });

  describe('sendEphemeralReply', () => {
    test('replies with ephemeral flag when not yet replied', async () => {
      let repliedWith: unknown = null;
      const interaction = {
        replied: false,
        deferred: false,
        reply: async (opts: unknown) => {
          repliedWith = opts;
        },
        followUp: async (_opts: unknown) => {},
      };

      await sendEphemeralReply(interaction, 'Secret message');
      expect(repliedWith).toEqual({ content: 'Secret message', ephemeral: true });
    });

    test('follows up when already replied', async () => {
      let followedUpWith: unknown = null;
      const interaction = {
        replied: true,
        deferred: false,
        reply: async (_opts: unknown) => {},
        followUp: async (opts: unknown) => {
          followedUpWith = opts;
        },
      };

      await sendEphemeralReply(interaction, 'Follow-up secret');
      expect(followedUpWith).toEqual({ content: 'Follow-up secret', ephemeral: true });
    });

    test('follows up when deferred', async () => {
      let followedUpWith: unknown = null;
      const interaction = {
        replied: false,
        deferred: true,
        reply: async (_opts: unknown) => {},
        followUp: async (opts: unknown) => {
          followedUpWith = opts;
        },
      };

      await sendEphemeralReply(interaction, 'Deferred secret');
      expect(followedUpWith).toEqual({ content: 'Deferred secret', ephemeral: true });
    });
  });
});
