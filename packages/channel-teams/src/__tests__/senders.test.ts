/**
 * Group 4 acceptance tests for the Teams outbound senders.
 *
 * Each test pushes activities through a fake `TeamsSendContext` so we can
 * assert the exact Bot Framework activity shape without booting the AAD
 * token cache or hitting the Connector REST endpoint. The fake records every
 * `sendActivity` call and lets the test inject failures.
 *
 * Coverage:
 *   - text: chunking, threading on first chunk only, format mode passthrough
 *   - media: URL attachment, buffered (data: URL) attachment, oversized
 *     buffer rejection, missing payload rejection, attachment shape per kind
 *   - reaction: emoji mapping (named + Slack alias + Unicode), unknown
 *     emoji fallback to `like`, missing target / emoji rejection,
 *     add-vs-remove activity shape
 *   - typing: emits a `typing` activity, threads with replyToId, wraps
 *     transport errors in `TeamsError`
 *   - context bridge: routes through `BotFrameworkClient.sendActivity` vs
 *     `replyToActivity` based on `replyToId`
 */

import { describe, expect, it, mock } from 'bun:test';

import type { Logger } from '@omni/channel-sdk';

import { createBotFrameworkSendContext } from '../senders/context';
import { sendMediaMessage } from '../senders/media';
import { mapEmojiToTeamsReaction, sendReaction } from '../senders/reaction';
import { sendTextMessage } from '../senders/text';
import type { TeamsOutboundActivity, TeamsResourceResponse, TeamsSendContext } from '../senders/types';
import { sendTyping } from '../senders/typing';
import { TeamsError, TeamsErrorCode } from '../types';

// ─────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────

interface RecordingContext extends TeamsSendContext {
  calls: TeamsOutboundActivity[];
}

function makeContext(
  responder: (
    activity: TeamsOutboundActivity,
    callIndex: number,
  ) => TeamsResourceResponse | Promise<TeamsResourceResponse> = (_, i) => ({ id: `activity-${i}` }),
): RecordingContext {
  const calls: TeamsOutboundActivity[] = [];
  return {
    calls,
    async sendActivity(activity) {
      calls.push(activity);
      return responder(activity, calls.length - 1);
    },
  };
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

// ─────────────────────────────────────────────────────────────
// Text sender
// ─────────────────────────────────────────────────────────────

describe('sendTextMessage', () => {
  it('emits a single message activity for short text and returns the activity id', async () => {
    const ctx = makeContext();
    const id = await sendTextMessage(ctx, { text: 'hello world' }, silentLogger);
    expect(id).toBe('activity-0');
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({ type: 'message', text: 'hello world', textFormat: 'markdown' });
  });

  it('threads only the first chunk when replyToId is set', async () => {
    const ctx = makeContext();
    const text = `${'a'.repeat(4_000)}\n\n${'b'.repeat(4_000)}`;
    await sendTextMessage(ctx, { text, replyToId: 'parent-1' }, silentLogger);
    expect(ctx.calls.length).toBeGreaterThanOrEqual(2);
    expect(ctx.calls[0]?.replyToId).toBe('parent-1');
    for (let i = 1; i < ctx.calls.length; i++) {
      expect(ctx.calls[i]?.replyToId).toBeUndefined();
    }
  });

  it('returns the id of the last chunk', async () => {
    const ctx = makeContext((_a, i) => ({ id: `chunk-${i}` }));
    const text = `${'a'.repeat(4_000)}\n\n${'b'.repeat(4_000)}`;
    const id = await sendTextMessage(ctx, { text }, silentLogger);
    expect(id).toBe(`chunk-${ctx.calls.length - 1}`);
  });

  it('honors passthrough format mode and emits textFormat=plain', async () => {
    const ctx = makeContext();
    await sendTextMessage(ctx, { text: '*literal* asterisks', formatMode: 'passthrough' }, silentLogger);
    expect(ctx.calls[0]?.textFormat).toBe('plain');
    expect(ctx.calls[0]?.text).toBe('*literal* asterisks');
  });

  it('rejects empty text with a typed TeamsError', async () => {
    const ctx = makeContext();
    await expect(sendTextMessage(ctx, { text: '' }, silentLogger)).rejects.toBeInstanceOf(TeamsError);
  });

  it('wraps transport errors in TeamsError(SEND_FAILED)', async () => {
    const ctx = makeContext(() => {
      throw new Error('connector exploded');
    });
    let captured: unknown;
    try {
      await sendTextMessage(ctx, { text: 'hi' }, silentLogger);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(TeamsError);
    expect((captured as TeamsError).channelCode).toBe(TeamsErrorCode.SEND_FAILED);
  });
});

// ─────────────────────────────────────────────────────────────
// Media sender
// ─────────────────────────────────────────────────────────────

describe('sendMediaMessage', () => {
  it('builds a URL attachment with derived MIME for image kind', async () => {
    const ctx = makeContext();
    await sendMediaMessage(
      ctx,
      { kind: 'image', mediaUrl: 'https://cdn.example/cat.png', filename: 'cat.png' },
      silentLogger,
    );
    expect(ctx.calls[0]?.attachments).toEqual([
      {
        contentType: 'image/png',
        contentUrl: 'https://cdn.example/cat.png',
        name: 'cat.png',
      },
    ]);
  });

  it('uses the supplied mimeType over the kind default', async () => {
    const ctx = makeContext();
    await sendMediaMessage(
      ctx,
      { kind: 'image', mediaUrl: 'https://x/y', mimeType: 'image/webp', filename: 'y.webp' },
      silentLogger,
    );
    expect(ctx.calls[0]?.attachments?.[0]?.contentType).toBe('image/webp');
  });

  it('encodes buffered content as a data URL attachment', async () => {
    const ctx = makeContext();
    const buf = Buffer.from('hello');
    await sendMediaMessage(
      ctx,
      { kind: 'document', content: buf, mimeType: 'text/plain', filename: 'note.txt' },
      silentLogger,
    );
    const attachment = ctx.calls[0]?.attachments?.[0];
    expect(attachment?.contentType).toBe('text/plain');
    expect(attachment?.name).toBe('note.txt');
    expect(attachment?.contentUrl).toBe(`data:text/plain;base64,${buf.toString('base64')}`);
  });

  it('rejects oversized buffers with TeamsError(ATTACHMENT_FAILED)', async () => {
    const ctx = makeContext();
    const tooBig = Buffer.alloc(8);
    let captured: unknown;
    try {
      await sendMediaMessage(
        ctx,
        { kind: 'document', content: tooBig, mimeType: 'application/pdf', maxBufferBytes: 4 },
        silentLogger,
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(TeamsError);
    expect((captured as TeamsError).channelCode).toBe(TeamsErrorCode.ATTACHMENT_FAILED);
  });

  it('rejects when neither mediaUrl nor content is supplied', async () => {
    const ctx = makeContext();
    await expect(sendMediaMessage(ctx, { kind: 'image', filename: 'x.png' }, silentLogger)).rejects.toBeInstanceOf(
      TeamsError,
    );
  });

  it('attaches caption as text alongside the attachment', async () => {
    const ctx = makeContext();
    await sendMediaMessage(ctx, { kind: 'image', mediaUrl: 'https://cdn/x.png', caption: 'check this' }, silentLogger);
    expect(ctx.calls[0]?.text).toBe('check this');
    expect(ctx.calls[0]?.textFormat).toBe('markdown');
  });

  it('threads media via replyToId', async () => {
    const ctx = makeContext();
    await sendMediaMessage(ctx, { kind: 'video', mediaUrl: 'https://cdn/v.mp4', replyToId: 'parent-7' }, silentLogger);
    expect(ctx.calls[0]?.replyToId).toBe('parent-7');
  });

  it('wraps transport errors as ATTACHMENT_FAILED', async () => {
    const ctx = makeContext(() => {
      throw new Error('upload broke');
    });
    let captured: unknown;
    try {
      await sendMediaMessage(ctx, { kind: 'image', mediaUrl: 'https://cdn/x.png' }, silentLogger);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(TeamsError);
    expect((captured as TeamsError).channelCode).toBe(TeamsErrorCode.ATTACHMENT_FAILED);
  });
});

// ─────────────────────────────────────────────────────────────
// Reaction sender
// ─────────────────────────────────────────────────────────────

describe('sendReaction', () => {
  it('maps a named reaction to a messageReaction activity with reactionsAdded', async () => {
    const ctx = makeContext();
    const id = await sendReaction(ctx, { targetActivityId: 'target-1', emoji: 'heart' }, silentLogger);
    expect(id).toBe('target-1');
    expect(ctx.calls[0]).toMatchObject({
      type: 'messageReaction',
      replyToId: 'target-1',
      reactionsAdded: [{ type: 'heart' }],
    });
    expect(ctx.calls[0]?.reactionsRemoved).toBeUndefined();
  });

  it('emits reactionsRemoved when add=false', async () => {
    const ctx = makeContext();
    await sendReaction(ctx, { targetActivityId: 'target-1', emoji: 'like', add: false }, silentLogger);
    expect(ctx.calls[0]?.reactionsRemoved).toEqual([{ type: 'like' }]);
    expect(ctx.calls[0]?.reactionsAdded).toBeUndefined();
  });

  it('rejects when the target activity id is missing', async () => {
    const ctx = makeContext();
    await expect(sendReaction(ctx, { targetActivityId: '', emoji: 'like' }, silentLogger)).rejects.toBeInstanceOf(
      TeamsError,
    );
  });

  it('rejects when the emoji is missing', async () => {
    const ctx = makeContext();
    await expect(sendReaction(ctx, { targetActivityId: 'target', emoji: '' }, silentLogger)).rejects.toBeInstanceOf(
      TeamsError,
    );
  });

  it('falls back to like for unknown emoji and warns', async () => {
    const warnSpy = mock(() => {});
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const ctx = makeContext();
    await sendReaction(ctx, { targetActivityId: 'target', emoji: '🦄' }, logger);
    expect(ctx.calls[0]?.reactionsAdded).toEqual([{ type: 'like' }]);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('mapEmojiToTeamsReaction', () => {
  it.each([
    ['like', 'like'],
    ['heart', 'heart'],
    ['laugh', 'laugh'],
    ['surprised', 'surprised'],
    ['sad', 'sad'],
    ['angry', 'angry'],
    ['+1', 'like'],
    ['thumbsup', 'like'],
    [':+1:', 'like'],
    ['joy', 'laugh'],
    ['rage', 'angry'],
    ['👍', 'like'],
    ['❤️', 'heart'],
    ['😂', 'laugh'],
    ['😮', 'surprised'],
    ['😢', 'sad'],
    ['😡', 'angry'],
  ])('maps %s → %s', (input, expected) => {
    const result = mapEmojiToTeamsReaction(input);
    expect(result.type).toBe(expected as ReturnType<typeof mapEmojiToTeamsReaction>['type']);
    expect(result.matched).toBe(true);
  });

  it('marks unknown input as unmatched and falls back to like', () => {
    const result = mapEmojiToTeamsReaction('🦄');
    expect(result.type).toBe('like');
    expect(result.matched).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Typing sender
// ─────────────────────────────────────────────────────────────

describe('sendTyping', () => {
  it('emits a single typing activity', async () => {
    const ctx = makeContext();
    await sendTyping(ctx, {}, silentLogger);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.type).toBe('typing');
    expect(ctx.calls[0]?.text).toBeUndefined();
  });

  it('inherits replyToId for thread context', async () => {
    const ctx = makeContext();
    await sendTyping(ctx, { replyToId: 'parent-9' }, silentLogger);
    expect(ctx.calls[0]?.replyToId).toBe('parent-9');
  });

  it('wraps transport errors as TeamsError(SEND_FAILED)', async () => {
    const ctx = makeContext(() => {
      throw new Error('typing broke');
    });
    let captured: unknown;
    try {
      await sendTyping(ctx, {}, silentLogger);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(TeamsError);
    expect((captured as TeamsError).channelCode).toBe(TeamsErrorCode.SEND_FAILED);
  });
});

// ─────────────────────────────────────────────────────────────
// Context bridge — `createBotFrameworkSendContext`
// ─────────────────────────────────────────────────────────────

describe('createBotFrameworkSendContext', () => {
  type SendCall = [string, string, Record<string, unknown>];
  type ReplyCall = [string, string, string, Record<string, unknown>];

  function makeFakeClient(): {
    sendCalls: SendCall[];
    replyCalls: ReplyCall[];
    client: {
      sendActivity: (...args: SendCall) => Promise<{ activityId: string }>;
      replyToActivity: (...args: ReplyCall) => Promise<{ activityId: string }>;
    };
  } {
    const sendCalls: SendCall[] = [];
    const replyCalls: ReplyCall[] = [];
    return {
      sendCalls,
      replyCalls,
      client: {
        async sendActivity(serviceUrl, conversationId, activity) {
          sendCalls.push([serviceUrl, conversationId, activity]);
          return { activityId: 'srv-1' };
        },
        async replyToActivity(serviceUrl, conversationId, activityId, activity) {
          replyCalls.push([serviceUrl, conversationId, activityId, activity]);
          return { activityId: 'srv-reply' };
        },
      },
    };
  }

  it('routes activities without replyToId through sendActivity', async () => {
    const fake = makeFakeClient();
    const ctx = createBotFrameworkSendContext({
      client: fake.client as never,
      serviceUrl: 'https://smba.example/teams/',
      conversationId: 'conv-1',
    });

    const result = await ctx.sendActivity({ type: 'message', text: 'hi' });
    expect(result.id).toBe('srv-1');
    expect(fake.sendCalls).toHaveLength(1);
    expect(fake.replyCalls).toHaveLength(0);
    const [serviceUrl, conversationId, activity] = fake.sendCalls[0]!;
    expect(serviceUrl).toBe('https://smba.example/teams/');
    expect(conversationId).toBe('conv-1');
    expect(activity).toMatchObject({ type: 'message', text: 'hi' });
  });

  it('routes activities with replyToId through replyToActivity', async () => {
    const fake = makeFakeClient();
    const ctx = createBotFrameworkSendContext({
      client: fake.client as never,
      serviceUrl: 'https://smba.example/teams/',
      conversationId: 'conv-1',
    });

    const result = await ctx.sendActivity({ type: 'message', text: 'reply', replyToId: 'parent-1' });
    expect(result.id).toBe('srv-reply');
    expect(fake.replyCalls).toHaveLength(1);
    expect(fake.sendCalls).toHaveLength(0);
    const [, , activityId, activity] = fake.replyCalls[0]!;
    expect(activityId).toBe('parent-1');
    expect(activity).toMatchObject({ type: 'message', text: 'reply', replyToId: 'parent-1' });
  });

  it('maps attachments and reactions onto the wire payload shape', async () => {
    const fake = makeFakeClient();
    const ctx = createBotFrameworkSendContext({
      client: fake.client as never,
      serviceUrl: 'https://smba.example/teams/',
      conversationId: 'conv-1',
    });

    await ctx.sendActivity({
      type: 'message',
      attachments: [
        { contentType: 'image/png', contentUrl: 'https://cdn/x.png', name: 'x.png', thumbnailUrl: 'thumb' },
      ],
      reactionsAdded: [{ type: 'heart' }],
    });

    const [, , activity] = fake.sendCalls[0]!;
    const wire = activity as { attachments?: Array<Record<string, unknown>>; reactionsAdded?: unknown };
    expect(wire.attachments).toEqual([
      { contentType: 'image/png', contentUrl: 'https://cdn/x.png', name: 'x.png', content: undefined },
    ]);
    expect(wire.reactionsAdded).toEqual([{ type: 'heart' }]);
  });
});
