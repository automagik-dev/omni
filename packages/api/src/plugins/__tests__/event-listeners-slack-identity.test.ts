/**
 * `instance.connected` persists the Slack workspace identity
 * (slack-personal-oauth).
 *
 * A manually created Slack instance has no `slack_team_id` until it connects:
 * the plugin reports the workspace it authenticated into, and this subscriber is
 * what writes it. Without that write nothing on the API side knows which
 * workspace a manual instance belongs to, so an OAuth re-authorization cannot
 * upsert by (team, user) and lands as a second instance instead.
 *
 * `slack_user_id` is written ONCE — on a row that has none. Re-pointing an
 * existing instance at whoever connected last would silently hand one member's
 * conversations to another, so an already-set value is never overwritten.
 */

import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { setupConnectionListener } from '../event-listeners';

interface Recorded {
  op: 'select' | 'update';
  patch?: Record<string, unknown>;
}

/**
 * Chainable Drizzle stand-in: every builder method returns itself and awaiting
 * it resolves to `rows`.
 */
function chain<T>(rows: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) => Promise.resolve(rows).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

function makeDb(recorded: Recorded[], existingRow: Record<string, unknown>): Database {
  const handle = {
    select: () => {
      recorded.push({ op: 'select' });
      return chain([existingRow]);
    },
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        recorded.push({ op: 'update', patch });
        return chain([]);
      },
    }),
    execute: async () => [],
  };
  const db = {
    ...handle,
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(handle),
  };
  return db as unknown as Database;
}

async function fireConnected(
  payload: Record<string, unknown>,
  existingRow: Record<string, unknown> = { slackUserId: null },
): Promise<Recorded[]> {
  const recorded: Recorded[] = [];
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const bus = {
    subscribe: async (eventType: string, cb: (event: unknown) => Promise<void>) => {
      handlers.set(eventType, cb);
      return { unsubscribe: async () => {} };
    },
    subscribePattern: async () => ({ unsubscribe: async () => {} }),
    publish: async () => ({ id: 'evt-1' }),
  } as unknown as EventBus;

  await setupConnectionListener(bus, makeDb(recorded, existingRow));
  const handler = handlers.get('instance.connected');
  if (!handler) throw new Error('no instance.connected handler registered');
  await handler({
    payload: { instanceId: 'inst-1', channelType: 'slack', ...payload },
    metadata: { correlationId: 'corr-1', instanceId: 'inst-1' },
  });
  return recorded;
}

const patchOf = (recorded: Recorded[]): Record<string, unknown> => {
  const write = recorded.find((entry) => entry.op === 'update');
  if (!write?.patch) throw new Error(`no update recorded; saw ${JSON.stringify(recorded)}`);
  return write.patch;
};

describe('instance.connected → Slack identity columns', () => {
  test('writes slack_team_id from the payload, alongside the usual connection fields', async () => {
    const recorded = await fireConnected({ teamId: 'T_WORKSPACE', profileName: 'omni' });

    const patch = patchOf(recorded);
    expect(patch.slackTeamId).toBe('T_WORKSPACE');
    expect(patch.isActive).toBe(true);
    expect(patch.profileName).toBe('omni');
    // No acting user in the payload ⇒ no user id written.
    expect(patch.slackUserId).toBeUndefined();
  });

  test('writes slack_user_id when the row has none', async () => {
    const recorded = await fireConnected({ teamId: 'T_WORKSPACE', actingUserId: 'U_ANA' }, { slackUserId: null });

    const patch = patchOf(recorded);
    expect(patch.slackTeamId).toBe('T_WORKSPACE');
    expect(patch.slackUserId).toBe('U_ANA');
  });

  test('never overwrites an existing slack_user_id', async () => {
    const recorded = await fireConnected({ teamId: 'T_WORKSPACE', actingUserId: 'U_BEN' }, { slackUserId: 'U_ANA' });

    const patch = patchOf(recorded);
    expect(patch.slackTeamId).toBe('T_WORKSPACE');
    expect(patch.slackUserId).toBeUndefined();
  });

  test('a payload without a workspace leaves both identity columns untouched', async () => {
    const recorded = await fireConnected({ profileName: 'telegram-bot' });

    const patch = patchOf(recorded);
    expect(patch.slackTeamId).toBeUndefined();
    expect(patch.slackUserId).toBeUndefined();
    expect(patch.isActive).toBe(true);
  });
});
