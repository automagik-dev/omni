/**
 * Tests for per-channel message filtering in setupMessageHandlers
 *
 * Group 3: Per-Channel Message Filtering
 */

import { describe, expect, it } from 'bun:test';

import type { ChannelFilterConfig, MessageHandlerCallbacks } from '../handlers/messages';
import { setupMessageHandlers } from '../handlers/messages';

// ─────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop };

/** Minimal mock of Bolt App that triggers the message handler synchronously */
function makeApp(onRegister: (handler: (ctx: { message: unknown }) => Promise<void>) => void) {
  return {
    message: (handler: (ctx: { message: unknown }) => Promise<void>) => {
      onRegister(handler);
    },
  } as never;
}

function makeMsg(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'C123',
    ts: '1234567890.123456',
    user: 'U999',
    text: 'hello',
    channel_type: 'channel',
    ...overrides,
  };
}

async function callHandler(
  filterConfig: ChannelFilterConfig | undefined,
  msg: Record<string, unknown>,
  botUserId?: string,
): Promise<{ received: boolean; rawPayload?: Record<string, unknown> }> {
  let captured: { rawPayload?: Record<string, unknown> } = {};
  let handlerFn: ((ctx: { message: unknown }) => Promise<void>) | undefined;

  const callbacks: MessageHandlerCallbacks = {
    onMessage: async (_inst, _extId, _chatId, _from, _content, _replyTo, rawPayload) => {
      captured = { rawPayload };
    },
  };

  const app = makeApp((fn) => {
    handlerFn = fn;
  });

  setupMessageHandlers(app, 'instance-1', botUserId, callbacks, { policy: 'open' }, noopLogger as never, filterConfig);

  if (!handlerFn) throw new Error('handler not registered');
  await handlerFn({ message: msg });

  return { received: captured.rawPayload !== undefined, rawPayload: captured.rawPayload };
}

// ─────────────────────────────────────────────────────────────
// Channel allowlist
// ─────────────────────────────────────────────────────────────

describe('channelAllowlist filtering', () => {
  it('allows messages in allowlisted channels', async () => {
    const result = await callHandler({ channelAllowlist: ['C123', 'C456'] }, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(true);
  });

  it('drops messages from channels not in allowlist', async () => {
    const result = await callHandler({ channelAllowlist: ['C456', 'C789'] }, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(false);
  });

  it('passes all channels when allowlist is empty', async () => {
    const result = await callHandler({ channelAllowlist: [] }, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(true);
  });

  it('passes all channels when allowlist is undefined', async () => {
    const result = await callHandler({}, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Channel blocklist
// ─────────────────────────────────────────────────────────────

describe('channelBlocklist filtering', () => {
  it('drops messages from blocklisted channels', async () => {
    const result = await callHandler({ channelBlocklist: ['C123'] }, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(false);
  });

  it('allows messages from channels not in blocklist', async () => {
    const result = await callHandler({ channelBlocklist: ['C456'] }, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(true);
  });

  it('allows all channels when blocklist is undefined', async () => {
    const result = await callHandler({}, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-channel requireMention
// ─────────────────────────────────────────────────────────────

describe('per-channel requireMention', () => {
  const BOT_ID = 'UBOT123';

  it('drops channel message when requireMention is true and bot is not mentioned', async () => {
    const result = await callHandler(
      { channels: { C123: { requireMention: true } } },
      makeMsg({ channel: 'C123', text: 'hello', user: 'U999' }),
      BOT_ID,
    );
    expect(result.received).toBe(false);
  });

  it('passes channel message when requireMention is true and bot is mentioned', async () => {
    const result = await callHandler(
      { channels: { C123: { requireMention: true } } },
      makeMsg({ channel: 'C123', text: `<@${BOT_ID}> hello`, user: 'U999' }),
      BOT_ID,
    );
    expect(result.received).toBe(true);
  });

  it('passes channel message when requireMention is false', async () => {
    const result = await callHandler(
      { channels: { C123: { requireMention: false } } },
      makeMsg({ channel: 'C123', text: 'hello', user: 'U999' }),
      BOT_ID,
    );
    expect(result.received).toBe(true);
  });

  it('does not apply requireMention to DMs', async () => {
    const result = await callHandler(
      { channels: { D123: { requireMention: true } } },
      makeMsg({ channel: 'D123', text: 'hello', user: 'U999', channel_type: 'im' }),
      BOT_ID,
    );
    // DMs bypass the mention requirement
    expect(result.received).toBe(true);
  });

  it('applies default behavior (no requireMention) for channels without per-channel config', async () => {
    const result = await callHandler(
      { channels: { C456: { requireMention: true } } }, // C123 has no config
      makeMsg({ channel: 'C123', text: 'hello', user: 'U999' }),
      BOT_ID,
    );
    expect(result.received).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-channel allowedUsers
// ─────────────────────────────────────────────────────────────

describe('per-channel allowedUsers', () => {
  it('drops message from user not in allowedUsers', async () => {
    const result = await callHandler(
      { channels: { C123: { allowedUsers: ['U789'] } } },
      makeMsg({ channel: 'C123', user: 'U456' }),
    );
    expect(result.received).toBe(false);
  });

  it('passes message from user in allowedUsers', async () => {
    const result = await callHandler(
      { channels: { C123: { allowedUsers: ['U789', 'U456'] } } },
      makeMsg({ channel: 'C123', user: 'U456' }),
    );
    expect(result.received).toBe(true);
  });

  it('passes all users when allowedUsers is empty', async () => {
    const result = await callHandler(
      { channels: { C123: { allowedUsers: [] } } },
      makeMsg({ channel: 'C123', user: 'U456' }),
    );
    expect(result.received).toBe(true);
  });

  it('passes all users when no allowedUsers is set', async () => {
    const result = await callHandler({ channels: { C123: {} } }, makeMsg({ channel: 'C123', user: 'U456' }));
    expect(result.received).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-channel tools/skills in rawPayload
// ─────────────────────────────────────────────────────────────

describe('per-channel tools and skills in rawPayload', () => {
  it('passes tools from per-channel config to rawPayload', async () => {
    const result = await callHandler(
      { channels: { C123: { tools: ['search', 'calculator'] } } },
      makeMsg({ channel: 'C123' }),
    );
    expect(result.received).toBe(true);
    expect(result.rawPayload?.tools).toEqual(['search', 'calculator']);
  });

  it('passes skills from per-channel config to rawPayload', async () => {
    const result = await callHandler(
      { channels: { C123: { skills: ['coding', 'writing'] } } },
      makeMsg({ channel: 'C123' }),
    );
    expect(result.received).toBe(true);
    expect(result.rawPayload?.skills).toEqual(['coding', 'writing']);
  });

  it('does not set tools/skills in rawPayload when not configured', async () => {
    const result = await callHandler({ channels: { C123: {} } }, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(true);
    expect(result.rawPayload?.tools).toBeUndefined();
    expect(result.rawPayload?.skills).toBeUndefined();
  });

  it('sets both tools and skills together', async () => {
    const result = await callHandler(
      {
        channels: {
          C123: { tools: ['web'], skills: ['research'] },
        },
      },
      makeMsg({ channel: 'C123' }),
    );
    expect(result.received).toBe(true);
    expect(result.rawPayload?.tools).toEqual(['web']);
    expect(result.rawPayload?.skills).toEqual(['research']);
  });
});

// ─────────────────────────────────────────────────────────────
// Default behavior (no filter config)
// ─────────────────────────────────────────────────────────────

describe('default behavior (no filterConfig)', () => {
  it('passes all messages when filterConfig is undefined', async () => {
    const result = await callHandler(undefined, makeMsg({ channel: 'C123' }));
    expect(result.received).toBe(true);
  });

  it('skips bot messages regardless of filter config', async () => {
    const result = await callHandler({}, makeMsg({ channel: 'C123', bot_id: 'B123', user: undefined }));
    expect(result.received).toBe(false);
  });
});
