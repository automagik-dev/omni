/**
 * #1235: the Slack OAuth upsert when a concurrent callback wins the insert.
 * The lookup misses, `createSlackOAuth` hits the identity index's ON CONFLICT
 * and returns null, and the upsert must update the winner's row instead of
 * inserting a second one.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Instance } from '@omni/db';
import { type UpsertSlackOAuthInstanceDeps, upsertSlackOAuthInstance } from '../slack-oauth';

const INPUT = {
  mode: 'user' as const,
  teamId: 'T0123456789',
  teamName: 'Acme',
  userId: 'U0123456789',
  userToken: 'xoxp-fresh',
  appToken: 'xapp-1',
  signingSecret: 'secret',
};

function harness(winner: Instance | undefined) {
  const findBySlackIdentity = mock(async (): Promise<Instance | undefined> => undefined);
  // First lookup misses (the other callback has not committed), the re-find sees the winner.
  findBySlackIdentity.mockImplementationOnce(async () => undefined).mockImplementation(async () => winner);
  const instances = {
    findBySlackIdentity,
    createSlackOAuth: mock(async () => null),
    update: mock(async (id: string, data: Partial<Instance>) => ({ ...winner, ...data, id }) as Instance),
  };
  const connect = mock(async () => undefined);
  const deps = {
    instances,
    channelRegistry: { get: () => ({ connect }) },
  } as unknown as UpsertSlackOAuthInstanceDeps;
  return { deps, instances, connect };
}

describe('upsertSlackOAuthInstance identity conflict', () => {
  test('a lost insert race updates the winning row', async () => {
    const winner = { id: 'winner-id', profileMetadata: null } as unknown as Instance;
    const h = harness(winner);

    const result = await upsertSlackOAuthInstance(h.deps, INPUT);

    expect(result).toEqual({ instanceId: 'winner-id', created: false });
    expect(h.instances.findBySlackIdentity).toHaveBeenCalledTimes(2);
    expect(h.instances.findBySlackIdentity).toHaveBeenLastCalledWith('T0123456789', 'U0123456789');
    expect(h.instances.createSlackOAuth).toHaveBeenCalledTimes(1);
    expect(h.instances.update).toHaveBeenCalledTimes(1);
    expect(h.instances.update.mock.calls[0]?.[1]).toMatchObject({ slackUserToken: 'xoxp-fresh' });
    expect(h.connect).toHaveBeenCalledTimes(1);
  });

  test('bot mode looks the identity up by workspace alone', async () => {
    const h = harness({ id: 'bot-id', profileMetadata: null } as unknown as Instance);

    await upsertSlackOAuthInstance(h.deps, { ...INPUT, mode: 'bot', botToken: 'xoxb-1' });

    expect(h.instances.findBySlackIdentity).toHaveBeenCalledWith('T0123456789', null);
  });

  test('a conflict with no row to re-find fails instead of reporting success', async () => {
    const h = harness(undefined);

    await expect(upsertSlackOAuthInstance(h.deps, INPUT)).rejects.toThrow('identity conflict');
    expect(h.connect).not.toHaveBeenCalled();
  });
});
