/**
 * Tests for thread-root linking (#889).
 *
 * 0048 added thread_root_message_id / reply_count / latest_reply_at with no
 * writer. linkThreadRoot fills them in at persist time; these tests pin down
 * its guard conditions and the SQL the service methods generate.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Database } from '@omni/db';
import { isSQLWrapper } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Services } from '../../services';
import { MessageService } from '../../services/messages';
import { linkThreadRoot } from '../message-persistence';

const REPLIED_AT = new Date('2026-09-07T12:00:00Z');

function makeServices(rootId: string | null, resolverError?: Error) {
  const resolveReplyToMessage = mock(async () => {
    if (resolverError) throw resolverError;
    return rootId;
  });
  const setThreadRoot = mock(async () => {});
  const recordThreadReply = mock(async () => {});
  const services = {
    messages: { resolveReplyToMessage, setThreadRoot, recordThreadReply },
  } as unknown as Services;
  return { services, resolveReplyToMessage, setThreadRoot, recordThreadReply };
}

describe('linkThreadRoot', () => {
  test('does nothing when the message is not in a thread', async () => {
    const { services, resolveReplyToMessage } = makeServices('root-uuid');

    await linkThreadRoot(services, 'chat-1', 'msg-uuid', '1725700000.000100', undefined, REPLIED_AT);

    expect(resolveReplyToMessage).not.toHaveBeenCalled();
  });

  test('does nothing for the root itself (thread_ts equals its own ts)', async () => {
    const { services, resolveReplyToMessage } = makeServices('root-uuid');

    await linkThreadRoot(services, 'chat-1', 'msg-uuid', '1725700000.000100', '1725700000.000100', REPLIED_AT);

    expect(resolveReplyToMessage).not.toHaveBeenCalled();
  });

  test('links the reply and bumps the root bookkeeping when the root exists', async () => {
    const { services, setThreadRoot, recordThreadReply } = makeServices('root-uuid');

    await linkThreadRoot(services, 'chat-1', 'msg-uuid', '1725700099.000200', '1725700000.000100', REPLIED_AT);

    expect(setThreadRoot).toHaveBeenCalledWith('msg-uuid', 'root-uuid');
    expect(recordThreadReply).toHaveBeenCalledWith('root-uuid', REPLIED_AT);
  });

  test('skips linking when the root was never stored (no backfill, 0048 decision)', async () => {
    const { services, setThreadRoot, recordThreadReply } = makeServices(null);

    await linkThreadRoot(services, 'chat-1', 'msg-uuid', '1725700099.000200', '1725700000.000100', REPLIED_AT);

    expect(setThreadRoot).not.toHaveBeenCalled();
    expect(recordThreadReply).not.toHaveBeenCalled();
  });

  test('swallows service errors — linking must never fail the persist', async () => {
    const { services } = makeServices('root-uuid', new Error('db down'));

    await expect(
      linkThreadRoot(services, 'chat-1', 'msg-uuid', '1725700099.000200', '1725700000.000100', REPLIED_AT),
    ).resolves.toBeUndefined();
  });
});

// ============================================================================
// MessageService.setThreadRoot / recordThreadReply — generated SQL
// ============================================================================

interface UpdateCapture {
  values?: Record<string, unknown>;
  whereSql?: string;
  whereParams?: unknown[];
}

function toQuery(condition: unknown): { sql: string; params: unknown[] } {
  if (!isSQLWrapper(condition)) {
    throw new Error('Expected a Drizzle SQLWrapper');
  }
  const query = new PgDialect().sqlToQuery(condition.getSQL());
  return { sql: query.sql.replace(/\s+/g, ' ').trim().toLowerCase(), params: query.params };
}

function createUpdateCaptureDb(capture: UpdateCapture) {
  const update = (_table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (condition: unknown) => {
        capture.values = values;
        const query = toQuery(condition);
        capture.whereSql = query.sql;
        capture.whereParams = query.params;
        return Promise.resolve();
      },
    }),
  });
  return { update } as unknown as Database;
}

describe('MessageService.setThreadRoot', () => {
  test('points the reply row at the root by primary key', async () => {
    const capture: UpdateCapture = {};
    const service = new MessageService(createUpdateCaptureDb(capture), null);

    await service.setThreadRoot('msg-uuid', 'root-uuid');

    expect(capture.values?.threadRootMessageId).toBe('root-uuid');
    expect(capture.whereSql).toContain('"id" =');
    expect(capture.whereParams).toEqual(['msg-uuid']);
  });
});

describe('MessageService.recordThreadReply', () => {
  test('increments reply_count and never drags latest_reply_at backwards', async () => {
    const capture: UpdateCapture = {};
    const service = new MessageService(createUpdateCaptureDb(capture), null);

    await service.recordThreadReply('root-uuid', REPLIED_AT);

    const replyCount = toQuery(capture.values?.replyCount);
    expect(replyCount.sql).toContain('reply_count');
    expect(replyCount.sql).toContain('+ 1');

    // GREATEST(COALESCE(latest_reply_at, $repliedAt), $repliedAt): an
    // out-of-order history-sync reply must not move the timestamp backwards.
    const latestReplyAt = toQuery(capture.values?.latestReplyAt);
    expect(latestReplyAt.sql).toContain('greatest');
    expect(latestReplyAt.sql).toContain('coalesce');
    expect(latestReplyAt.sql).toContain('latest_reply_at');
    expect(latestReplyAt.params).toEqual([REPLIED_AT, REPLIED_AT]);

    expect(capture.whereParams).toEqual(['root-uuid']);
  });
});
