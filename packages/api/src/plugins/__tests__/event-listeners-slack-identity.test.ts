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
 * conversations to another, so an already-set value is never overwritten. The
 * rule lives in the UPDATE predicate rather than in a preceding read: every API
 * process runs its own unqueued consumer for this event, so two handlers can
 * read `NULL` at the same time and the later write would win.
 *
 * The fake handle therefore records the table and the rendered predicate of
 * every write, and refuses to answer a `select` at all — a return to
 * read-then-write fails here rather than passing on a proxy that answers
 * anything. (The handler's detached agent-replay read lands on the same
 * refusal; it is fire-and-forget, so it is logged and dropped.)
 */

import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { type SQL, and, eq, getTableName, isNull } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { setupConnectionListener } from '../event-listeners';

const dialect = new PgDialect();

interface RenderedQuery {
  sql: string;
  params: unknown[];
}

interface Recorded {
  table: string;
  patch: Record<string, unknown>;
  where: RenderedQuery;
}

/** The predicate as SQL text + parameters, so a test can compare shapes. */
function render(predicate: SQL | undefined): RenderedQuery {
  if (!predicate) return { sql: '<no predicate>', params: [] };
  const query = dialect.sqlToQuery(predicate);
  return { sql: query.sql, params: query.params };
}

function makeDb(recorded: Recorded[]): Database {
  const handle = {
    select: () => {
      throw new Error('unexpected select: the Slack identity write must not read the row first');
    },
    update: (table: typeof instances) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (predicate: SQL | undefined) => {
          recorded.push({ table: getTableName(table), patch, where: render(predicate) });
          return [];
        },
      }),
    }),
    execute: async () => [],
  };
  const db = {
    ...handle,
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(handle),
  };
  return db as unknown as Database;
}

async function fireConnected(payload: Record<string, unknown>): Promise<Recorded[]> {
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

  await setupConnectionListener(bus, makeDb(recorded));
  const handler = handlers.get('instance.connected');
  if (!handler) throw new Error('no instance.connected handler registered');
  await handler({
    payload: { instanceId: 'inst-1', channelType: 'slack', ...payload },
    metadata: { correlationId: 'corr-1', instanceId: 'inst-1' },
  });
  return recorded;
}

/** The connection-state write: the one keyed on the instance id alone. */
const connectionWrite = (recorded: Recorded[]): Recorded => {
  const write = recorded[0];
  if (!write) throw new Error('no update recorded');
  return write;
};

const BY_ID = render(eq(instances.id, 'inst-1'));
const BY_ID_AND_UNCLAIMED = render(and(eq(instances.id, 'inst-1'), isNull(instances.slackUserId)));

describe('instance.connected → Slack identity columns', () => {
  test('writes slack_team_id from the payload, alongside the usual connection fields', async () => {
    const recorded = await fireConnected({ teamId: 'T_WORKSPACE', profileName: 'omni' });

    expect(recorded).toHaveLength(1);
    const write = connectionWrite(recorded);
    expect(write.table).toBe('instances');
    expect(write.where).toEqual(BY_ID);
    expect(write.patch.slackTeamId).toBe('T_WORKSPACE');
    expect(write.patch.isActive).toBe(true);
    expect(write.patch.profileName).toBe('omni');
    // No acting user in the payload ⇒ no user id written, by any statement.
    expect(write.patch.slackUserId).toBeUndefined();
  });

  test('claims slack_user_id in a second, conditional UPDATE keyed on IS NULL', async () => {
    const recorded = await fireConnected({ teamId: 'T_WORKSPACE', actingUserId: 'U_ANA' });

    expect(recorded).toHaveLength(2);

    // The connection-state patch carries the workspace but never the identity.
    const connection = connectionWrite(recorded);
    expect(connection.where).toEqual(BY_ID);
    expect(connection.patch.slackTeamId).toBe('T_WORKSPACE');
    expect(connection.patch.slackUserId).toBeUndefined();

    // The identity write is its own statement, guarded by the predicate: a row
    // that already names someone is left alone by the database, not by a
    // preceding read this handler did.
    const identity = recorded[1];
    expect(identity?.table).toBe('instances');
    expect(identity?.patch).toEqual({ slackUserId: 'U_ANA' });
    expect(identity?.where).toEqual(BY_ID_AND_UNCLAIMED);
    expect(identity?.where.sql).toContain('"slack_user_id" is null');
    expect(identity?.where.params).toEqual(['inst-1']);
  });

  test('a payload without an acting user issues no identity write at all', async () => {
    const recorded = await fireConnected({ teamId: 'T_WORKSPACE' });
    expect(recorded).toHaveLength(1);
    expect(connectionWrite(recorded).where).toEqual(BY_ID);
  });

  test('a payload without a workspace leaves both identity columns untouched', async () => {
    const recorded = await fireConnected({ profileName: 'telegram-bot' });

    expect(recorded).toHaveLength(1);
    const write = connectionWrite(recorded);
    expect(write.patch.slackTeamId).toBeUndefined();
    expect(write.patch.slackUserId).toBeUndefined();
    expect(write.patch.isActive).toBe(true);
  });
});
