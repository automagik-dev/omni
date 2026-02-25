/**
 * Tests for reply filtering and WhatsApp mention/reply normalization.
 */

import { describe, expect, test } from 'bun:test';
import type { Database, Instance } from '@omni/db';
import { isSQLWrapper } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type MessageContext, shouldAgentReply } from '../agent-runner';
import { buildWhatsAppMessageContext, extractPhoneFromJid } from '../message-context';
import { MessageService } from '../messages';

// ============================================================================
// shouldAgentReply – onReply condition
// ============================================================================

describe('shouldAgentReply – onReply', () => {
  const filteredOnReply = {
    mode: 'filtered' as const,
    conditions: { onDm: false, onMention: false, onReply: true, onNameMatch: false },
  };

  const baseContext: MessageContext = {
    isDirectMessage: false,
    mentionsBot: false,
    isReplyToBot: false,
    text: 'hello',
  };

  test('returns true when isReplyToBot is true', () => {
    expect(shouldAgentReply(filteredOnReply, { ...baseContext, isReplyToBot: true })).toBe(true);
  });

  test('returns false when isReplyToBot is false', () => {
    expect(shouldAgentReply(filteredOnReply, { ...baseContext, isReplyToBot: false })).toBe(false);
  });
});

// ============================================================================
// shouldAgentReply – combined onMention + onReply (Slack typical config)
// ============================================================================

describe('shouldAgentReply – Slack mention+reply config', () => {
  const slackFilter = {
    mode: 'filtered' as const,
    conditions: { onDm: false, onMention: true, onReply: true, onNameMatch: false },
  };

  const base: MessageContext = {
    isDirectMessage: false,
    mentionsBot: false,
    isReplyToBot: false,
    text: 'hi',
  };

  test('triggers on @mention even without thread reply', () => {
    expect(shouldAgentReply(slackFilter, { ...base, mentionsBot: true })).toBe(true);
  });

  test('triggers on thread reply even without mention', () => {
    expect(shouldAgentReply(slackFilter, { ...base, isReplyToBot: true })).toBe(true);
  });

  test('does not trigger on plain channel message', () => {
    expect(shouldAgentReply(slackFilter, base)).toBe(false);
  });
});

// ============================================================================
// WhatsApp JID normalization (Group D)
// ============================================================================

describe('extractPhoneFromJid', () => {
  test('extracts phone from device-suffixed JID', () => {
    expect(extractPhoneFromJid('551151986804:4@s.whatsapp.net')).toBe('551151986804');
  });

  test('extracts phone from canonical @s.whatsapp.net JID', () => {
    expect(extractPhoneFromJid('551151986804@s.whatsapp.net')).toBe('551151986804');
  });

  test('extracts phone from @lid JID', () => {
    expect(extractPhoneFromJid('551151986804@lid')).toBe('551151986804');
  });
});

describe('buildWhatsAppMessageContext with ownerIdentifier containing :N', () => {
  const instance = {
    ownerIdentifier: '551151986804:4@s.whatsapp.net',
  } as unknown as Instance;

  test('detects @mention when ownerIdentifier has :N and incoming mention has no suffix', () => {
    const context = buildWhatsAppMessageContext(
      {
        isGroup: true,
        mentionedJids: ['551151986804@s.whatsapp.net'],
      },
      '120363000000000000@g.us',
      instance,
      'Oi @551151986804',
    );

    expect(context.mentionsBot).toBe(true);
    expect(context.isReplyToBot).toBe(false);
  });

  test('detects reply when ownerIdentifier has :N and quoted participant has no suffix', () => {
    const context = buildWhatsAppMessageContext(
      {
        isGroup: true,
        quotedMessage: { participant: '551151986804@s.whatsapp.net' },
      },
      '120363000000000000@g.us',
      instance,
      'resposta',
    );

    expect(context.isReplyToBot).toBe(true);
  });
});

// ============================================================================
// MessageService.hasBotRepliedInThread
// ============================================================================

interface ThreadProbeRow {
  id: string;
  chatId: string;
  isFromMe: boolean;
  replyToExternalId: string | null;
  externalId: string;
}

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

function createHasBotRepliedDbMock(rows: ThreadProbeRow[] = [], capture?: QueryCapture) {
  const where = (condition: unknown) => {
    const query = toWhereQuery(condition);
    if (capture) {
      capture.whereSql = query.sql;
      capture.whereParams = query.params;
    }

    return {
      limit: (limitValue: number) => {
        if (capture) capture.limitArg = limitValue;

        const [chatId, isFromMe, threadViaReply, threadViaExternal] = query.params;
        const result = rows
          .filter((row) => {
            if (row.chatId !== chatId) return false;
            if (row.isFromMe !== isFromMe) return false;
            return row.replyToExternalId === threadViaReply || row.externalId === threadViaExternal;
          })
          .slice(0, limitValue)
          .map((row) => ({ id: row.id }));

        return Promise.resolve(result);
      },
    };
  };

  const from = (_table: unknown) => ({ where });
  const select = (_selection: unknown) => ({ from });
  return { select } as unknown as Database;
}

describe('MessageService.hasBotRepliedInThread', () => {
  test('returns true when bot replied in thread via replyToExternalId', async () => {
    const db = createHasBotRepliedDbMock([
      {
        id: 'msg-1',
        chatId: 'chat-1',
        isFromMe: true,
        replyToExternalId: 'thread-1',
        externalId: 'msg-bot-1',
      },
    ]);
    const service = new MessageService(db, null);

    const replied = await service.hasBotRepliedInThread('chat-1', 'thread-1');

    expect(replied).toBe(true);
  });

  test('returns true when bot started thread via externalId', async () => {
    const db = createHasBotRepliedDbMock([
      {
        id: 'msg-root',
        chatId: 'chat-1',
        isFromMe: true,
        replyToExternalId: null,
        externalId: 'thread-root',
      },
    ]);
    const service = new MessageService(db, null);

    const replied = await service.hasBotRepliedInThread('chat-1', 'thread-root');

    expect(replied).toBe(true);
  });

  test('returns false when rows do not satisfy chat/fromMe/thread filters', async () => {
    const db = createHasBotRepliedDbMock([
      {
        id: 'wrong-chat',
        chatId: 'chat-2',
        isFromMe: true,
        replyToExternalId: 'thread-1',
        externalId: 'thread-1',
      },
      {
        id: 'not-from-bot',
        chatId: 'chat-1',
        isFromMe: false,
        replyToExternalId: 'thread-1',
        externalId: 'thread-1',
      },
      {
        id: 'wrong-thread',
        chatId: 'chat-1',
        isFromMe: true,
        replyToExternalId: 'other-thread',
        externalId: 'other-thread',
      },
    ]);
    const service = new MessageService(db, null);

    const replied = await service.hasBotRepliedInThread('chat-1', 'thread-1');

    expect(replied).toBe(false);
  });

  test('builds where query with expected filters and OR branch, then applies limit(1)', async () => {
    const capture: QueryCapture = {};
    const db = createHasBotRepliedDbMock(
      [
        {
          id: 'msg-1',
          chatId: 'chat-99',
          isFromMe: true,
          replyToExternalId: 'thread-99',
          externalId: 'thread-99',
        },
      ],
      capture,
    );
    const service = new MessageService(db, null);

    await service.hasBotRepliedInThread('chat-99', 'thread-99');

    expect(capture.limitArg).toBe(1);
    expect(capture.whereParams).toEqual(['chat-99', true, 'thread-99', 'thread-99']);
    expect(capture.whereSql).toContain('"messages"."chat_id" =');
    expect(capture.whereSql).toContain('"messages"."is_from_me" =');
    expect(capture.whereSql).toContain('"messages"."reply_to_external_id" =');
    expect(capture.whereSql).toContain('"messages"."external_id" =');
    expect(capture.whereSql).toContain(' or ');
  });
});
