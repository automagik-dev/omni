/**
 * Tests for chat.scheduleMessage / chat.deleteScheduledMessage (#889).
 */

import { describe, expect, it } from 'bun:test';
import type { WebClient } from '@slack/web-api';
import { MAX_SCHEDULE_AHEAD_MS, cancelScheduledSlackMessage, scheduleTextMessage } from '../senders/text';
import { SlackError } from '../types';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop } as never;

interface ScheduleCall {
  channel?: string;
  text?: string;
  post_at?: number;
  thread_ts?: string;
  reply_broadcast?: boolean;
}

function makeClient(
  result: Record<string, unknown> = { scheduled_message_id: 'Q123' },
  capture?: { schedule?: ScheduleCall; del?: Record<string, unknown> },
) {
  return {
    chat: {
      scheduleMessage: async (args: ScheduleCall) => {
        if (capture) capture.schedule = args;
        return result;
      },
      deleteScheduledMessage: async (args: Record<string, unknown>) => {
        if (capture) capture.del = args;
        return { ok: true };
      },
    },
  } as unknown as WebClient;
}

const IN_ONE_HOUR = () => new Date(Date.now() + 60 * 60 * 1000);

describe('scheduleTextMessage', () => {
  it('returns the scheduled_message_id as the cancellation handle', async () => {
    const id = await scheduleTextMessage(
      makeClient(),
      { channelId: 'C1', text: 'oi', postAt: IN_ONE_HOUR() },
      noopLogger,
    );
    expect(id).toBe('Q123');
  });

  it('sends post_at in whole seconds, not milliseconds', async () => {
    const capture: { schedule?: ScheduleCall } = {};
    const at = IN_ONE_HOUR();
    await scheduleTextMessage(makeClient(undefined, capture), { channelId: 'C1', text: 'oi', postAt: at }, noopLogger);

    expect(capture.schedule?.post_at).toBe(Math.floor(at.getTime() / 1000));
    // Guards the classic bug: passing ms would schedule ~55k years out.
    expect(capture.schedule?.post_at).toBeLessThan(at.getTime());
  });

  it('converts markdown to mrkdwn by default', async () => {
    const capture: { schedule?: ScheduleCall } = {};
    await scheduleTextMessage(
      makeClient(undefined, capture),
      { channelId: 'C1', text: '**bold**', postAt: IN_ONE_HOUR() },
      noopLogger,
    );
    expect(capture.schedule?.text).toBe('*bold*');
  });

  it('honours passthrough format mode', async () => {
    const capture: { schedule?: ScheduleCall } = {};
    await scheduleTextMessage(
      makeClient(undefined, capture),
      { channelId: 'C1', text: '**bold**', postAt: IN_ONE_HOUR(), formatMode: 'passthrough' },
      noopLogger,
    );
    expect(capture.schedule?.text).toBe('**bold**');
  });

  it('forwards thread_ts and reply_broadcast (quote in thread vs in channel)', async () => {
    const capture: { schedule?: ScheduleCall } = {};
    await scheduleTextMessage(
      makeClient(undefined, capture),
      { channelId: 'C1', text: 'oi', postAt: IN_ONE_HOUR(), threadTs: '111.222', replyBroadcast: true },
      noopLogger,
    );
    expect(capture.schedule?.thread_ts).toBe('111.222');
    expect(capture.schedule?.reply_broadcast).toBe(true);
  });

  it('rejects a postAt in the past', async () => {
    const call = scheduleTextMessage(
      makeClient(),
      { channelId: 'C1', text: 'oi', postAt: new Date(Date.now() - 1000) },
      noopLogger,
    );
    await expect(call).rejects.toThrow(/in the past/);
  });

  it('rejects a postAt beyond the 120-day platform limit', async () => {
    const call = scheduleTextMessage(
      makeClient(),
      { channelId: 'C1', text: 'oi', postAt: new Date(Date.now() + MAX_SCHEDULE_AHEAD_MS + 60_000) },
      noopLogger,
    );
    await expect(call).rejects.toThrow(/at most 120/);
  });

  it('rejects over-long text instead of chunking it', async () => {
    // Chunking would create several scheduled messages with separate handles,
    // so a later cancel could half-fire. Rejecting is the safe behaviour.
    const call = scheduleTextMessage(
      makeClient(),
      { channelId: 'C1', text: 'x'.repeat(4001), postAt: IN_ONE_HOUR() },
      noopLogger,
    );
    await expect(call).rejects.toThrow(/over Slack's 4000 limit/);
  });

  it('fails loudly when Slack returns no scheduled_message_id', async () => {
    // Without a handle the message would fire and never be cancellable.
    const call = scheduleTextMessage(
      makeClient({ ok: true }),
      { channelId: 'C1', text: 'oi', postAt: IN_ONE_HOUR() },
      noopLogger,
    );
    await expect(call).rejects.toThrow(/no scheduled_message_id/);
  });

  it('wraps transport failures as SEND_FAILED', async () => {
    const client = {
      chat: {
        scheduleMessage: async () => {
          throw new Error('boom');
        },
      },
    } as unknown as WebClient;

    const call = scheduleTextMessage(client, { channelId: 'C1', text: 'oi', postAt: IN_ONE_HOUR() }, noopLogger);

    await expect(call).rejects.toThrow(/Failed to schedule message: boom/);
    await call.catch((error: unknown) => {
      // SlackError normalizes SEND_FAILED to the cross-channel code.
      expect(error).toBeInstanceOf(SlackError);
      expect((error as { code?: string }).code).toBe('CHANNEL_SEND_FAILED');
    });
  });
});

describe('cancelScheduledSlackMessage', () => {
  it('passes channel and scheduled_message_id through', async () => {
    const capture: { del?: Record<string, unknown> } = {};
    await cancelScheduledSlackMessage(makeClient(undefined, capture), 'C1', 'Q123', noopLogger);

    expect(capture.del).toEqual({ channel: 'C1', scheduled_message_id: 'Q123' });
  });
});
