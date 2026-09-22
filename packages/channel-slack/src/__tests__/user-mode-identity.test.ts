/**
 * Tests for the identity a Slack instance presents (#889).
 *
 * A user-mode instance acts AS the authorizing human, so `instances status`,
 * the `instance.connected` event and `getProfile` must name that human — not
 * the workspace bot, which is never the actor that spoke. Bot mode is
 * unchanged, and both branches go through the one helper that all four
 * presentation sites in the plugin now read from.
 */

import { describe, expect, it } from 'bun:test';
import { resolveActingUserName } from '../connection/bolt-client';
import { type SlackIdentitySource, resolvePresentedIdentity } from '../plugin';

const BOT: Pick<SlackIdentitySource, 'botUserId' | 'botName'> = {
  botUserId: 'U0C3SF1QGLU',
  botName: 'omni3',
};

describe('resolvePresentedIdentity', () => {
  it('presents the acting human in user mode', () => {
    const presented = resolvePresentedIdentity({
      ...BOT,
      authMode: 'user',
      actingUserId: 'U05J8EZQ1S7',
      actingUserName: 'felipe',
    });

    expect(presented).toEqual({ profileName: 'felipe', ownerIdentifier: 'U05J8EZQ1S7' });
  });

  it('presents the bot in bot mode, exactly as before', () => {
    const presented = resolvePresentedIdentity({
      ...BOT,
      authMode: 'bot',
      actingUserId: undefined,
      actingUserName: undefined,
    });

    expect(presented).toEqual({ profileName: 'omni3', ownerIdentifier: 'U0C3SF1QGLU' });
  });

  it('never borrows the bot name for the human when no display name resolved', () => {
    const presented = resolvePresentedIdentity({
      ...BOT,
      authMode: 'user',
      actingUserId: 'U05J8EZQ1S7',
      actingUserName: undefined,
    });

    // The acting user id is still the human; the bot name would be a lie.
    expect(presented).toEqual({ profileName: 'U05J8EZQ1S7', ownerIdentifier: 'U05J8EZQ1S7' });
  });

  it('keeps the bot identity when a user-mode attachment has no acting user', () => {
    const presented = resolvePresentedIdentity({
      ...BOT,
      authMode: 'user',
      actingUserId: undefined,
      actingUserName: undefined,
    });

    expect(presented).toEqual({ profileName: 'omni3', ownerIdentifier: 'U0C3SF1QGLU' });
  });

  it('leaves profileName unset when the bot has no display name', () => {
    const presented = resolvePresentedIdentity({
      botUserId: 'U0C3SF1QGLU',
      botName: undefined,
      authMode: 'bot',
      actingUserId: undefined,
      actingUserName: undefined,
    });

    expect(presented).toEqual({ profileName: undefined, ownerIdentifier: 'U0C3SF1QGLU' });
  });
});

describe('resolveActingUserName', () => {
  const HUMAN = 'U05J8EZQ1S7';

  /** A user client whose users.info answers with `respond` and records its arguments. */
  function userClient(respond: () => Promise<unknown>): {
    client: Parameters<typeof resolveActingUserName>[0];
    calls: unknown[];
  } {
    const calls: unknown[] = [];
    const client = {
      users: {
        info: (args: unknown) => {
          calls.push(args);
          return respond();
        },
      },
    } as unknown as Parameters<typeof resolveActingUserName>[0];
    return { client, calls };
  }

  it('presents the profile display name, not the auth.test username', async () => {
    const { client, calls } = userClient(() =>
      Promise.resolve({
        ok: true,
        user: {
          id: HUMAN,
          name: 'felipe',
          profile: { display_name: 'Felipe Rosa', real_name: 'Felipe Rosa da Silva' },
        },
      }),
    );

    expect(await resolveActingUserName(client, HUMAN, 'felipe')).toBe('Felipe Rosa');
    expect(calls).toEqual([{ user: HUMAN }]);
  });

  it('falls back to the real name when the display name is empty', async () => {
    const { client } = userClient(() =>
      Promise.resolve({
        ok: true,
        user: { id: HUMAN, name: 'felipe', profile: { display_name: '', real_name: 'Felipe Rosa da Silva' } },
      }),
    );

    expect(await resolveActingUserName(client, HUMAN, 'felipe')).toBe('Felipe Rosa da Silva');
  });

  it('keeps the username when the profile carries no name', async () => {
    const { client } = userClient(() =>
      Promise.resolve({ ok: true, user: { id: HUMAN, name: 'felipe', profile: {} } }),
    );

    expect(await resolveActingUserName(client, HUMAN, 'felipe')).toBe('felipe');
  });

  it('keeps the username when users.info fails', async () => {
    const { client } = userClient(() => Promise.reject(new Error('missing_scope')));

    expect(await resolveActingUserName(client, HUMAN, 'felipe')).toBe('felipe');
  });
});
