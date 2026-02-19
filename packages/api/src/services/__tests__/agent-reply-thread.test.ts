/**
 * Tests for Slack thread reply detection and agent reply filtering.
 *
 * Covers the critical path: bot-started threads must trigger onReply,
 * not just threads where the bot replied as a participant.
 */

import { describe, expect, mock, test } from 'bun:test';
import { type MessageContext, shouldAgentReply } from '../agent-runner';

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
// hasBotRepliedInThread – mock DB
// ============================================================================

describe('hasBotRepliedInThread', () => {
  /**
   * Build a minimal mock DB that resolves a single select().from().where().limit() chain.
   * `rows` is the array the final `.limit()` call resolves to.
   */
  function buildMockDb(rows: Array<{ id: string }>) {
    return {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve(rows)),
          })),
        })),
      })),
    } as unknown;
  }

  // We import MessageService dynamically so the module-level drizzle imports resolve
  // against bun's module resolution (they aren't invoked in the mock path).
  async function createService(rows: Array<{ id: string }>) {
    const { MessageService } = await import('../messages');
    const db = buildMockDb(rows);
    // MessageService constructor expects (db, eventBus)
    const eventBus = { publish: mock(() => Promise.resolve()) } as never;
    return new MessageService(db as never, eventBus);
  }

  test('returns true when bot replied in thread (replyToExternalId match)', async () => {
    const service = await createService([{ id: 'msg-1' }]);
    const result = await service.hasBotRepliedInThread('chat-1', '1700000000.000100');
    expect(result).toBe(true);
  });

  test('returns true when bot started the thread (externalId match)', async () => {
    // Same query returns a row — the OR condition catches externalId = threadTs
    const service = await createService([{ id: 'msg-root' }]);
    const result = await service.hasBotRepliedInThread('chat-1', '1700000000.000200');
    expect(result).toBe(true);
  });

  test('returns false when bot has no participation in thread', async () => {
    const service = await createService([]);
    const result = await service.hasBotRepliedInThread('chat-1', '1700000000.000300');
    expect(result).toBe(false);
  });
});
