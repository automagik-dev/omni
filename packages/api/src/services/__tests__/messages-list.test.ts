import { describe, expect, test } from 'bun:test';
import type { Database, Message } from '@omni/db';
import { isSQLWrapper } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { MessageService } from '../messages';

interface QueryCapture {
  whereSql?: string;
  whereParams?: unknown[];
  limitArg?: number;
}

function toWhereQuery(condition: unknown): { sql: string; params: unknown[] } {
  if (!isSQLWrapper(condition)) {
    throw new Error('Expected a Drizzle SQLWrapper in where()');
  }

  const query = new PgDialect().sqlToQuery(condition.getSQL());
  return {
    sql: query.sql.replace(/\s+/g, ' ').trim().toLowerCase(),
    params: query.params,
  };
}

function createListDbMock(capture: QueryCapture): Database {
  const where = (condition: unknown) => {
    const query = toWhereQuery(condition);
    capture.whereSql = query.sql;
    capture.whereParams = query.params;

    return {
      orderBy: () => ({
        limit: (limitValue: number) => {
          capture.limitArg = limitValue;
          return Promise.resolve([] as Array<{ messages: Message }>);
        },
      }),
    };
  };

  const from = () => ({ where });
  const select = () => ({ from });
  return { select } as unknown as Database;
}

describe('MessageService.list', () => {
  test('filters externalId as an exact column match, not text search', async () => {
    const capture: QueryCapture = {};
    const service = new MessageService(createListDbMock(capture), null);

    await service.list({ externalId: '3EB029FAF90BE7AB265311', includeHidden: true });

    expect(capture.limitArg).toBe(51);
    expect(capture.whereParams).toContain('3EB029FAF90BE7AB265311');
    expect(capture.whereSql).toContain('"messages"."external_id" =');
    expect(capture.whereSql).not.toContain('"messages"."text_content"');
    expect(capture.whereSql).not.toContain('"messages"."transcription"');
    expect(capture.whereSql).not.toContain('"messages"."image_description"');
    expect(capture.whereSql).not.toContain('"messages"."document_extraction"');
  });
});
