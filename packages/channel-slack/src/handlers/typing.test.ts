/**
 * Tests for Slack typing indicator (assistant.threads.setStatus)
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import { clearTypingStatus, setSlackThreadStatus, setTypingStatus } from './typing';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
  } as unknown as Logger;
}

function makeClientWithAssistant() {
  const setStatusCalls: Array<{ channel_id: string; thread_ts: string; status: string; loading_messages?: string[] }> =
    [];
  const client = {
    assistant: {
      threads: {
        setStatus: mock(
          async (args: { channel_id: string; thread_ts: string; status: string; loading_messages?: string[] }) => {
            setStatusCalls.push(args);
          },
        ),
      },
    },
  };
  return { client, setStatusCalls };
}

function makeClientWithApiCall() {
  const apiCalls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const client = {
    apiCall: mock(async (method: string, args: Record<string, unknown>) => {
      apiCalls.push({ method, args });
    }),
  };
  return { client, apiCalls };
}

function makeClientWithoutAssistant() {
  return { client: {} };
}

// ─────────────────────────────────────────────────────────────
// setSlackThreadStatus tests
// ─────────────────────────────────────────────────────────────

describe('setSlackThreadStatus', () => {
  it('no-ops when threadTs is absent', async () => {
    const { client, setStatusCalls } = makeClientWithAssistant();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: undefined,
      status: 'is typing...',
      logger,
    });

    expect(result).toBe(false);
    expect(setStatusCalls.length).toBe(0);
  });

  it('calls assistant.threads.setStatus when available', async () => {
    const { client, setStatusCalls } = makeClientWithAssistant();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      loadingMessages: ['Checking context...', 'Calling tools...'],
      logger,
    });

    expect(result).toBe(true);
    expect(setStatusCalls.length).toBe(1);
    expect(setStatusCalls[0]).toEqual({
      channel_id: 'C12345',
      thread_ts: '1234567890.001',
      status: 'is typing...',
      loading_messages: ['Checking context...', 'Calling tools...'],
    });
  });

  it('falls back to apiCall when assistant.threads.setStatus is absent', async () => {
    const { client, apiCalls } = makeClientWithApiCall();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      logger,
    });

    expect(result).toBe(true);
    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0]?.method).toBe('assistant.threads.setStatus');
    expect(apiCalls[0]?.args).toEqual({
      channel_id: 'C12345',
      thread_ts: '1234567890.001',
      status: 'is typing...',
    });
  });

  it('does not throw when neither method is available', async () => {
    const { client } = makeClientWithoutAssistant();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      logger,
    });

    expect(result).toBe(false);
  });

  it('does not throw when API call fails', async () => {
    const { client } = makeClientWithAssistant();
    client.assistant.threads.setStatus = mock(async () => {
      throw new Error('not_allowed_token_type');
    });
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      logger,
    });

    expect(result).toBe(false);

    // Should have logged the failure
    const warnCalls = (logger.warn as ReturnType<typeof mock>).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
    expect(warnCalls[0]?.[1]).toMatchObject({ clearing: false, statusLength: 'is typing...'.length });
    expect(warnCalls[0]?.[1]).not.toHaveProperty('status');
  });

  it('can clear typing status with empty string', async () => {
    const { client, setStatusCalls } = makeClientWithAssistant();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: '',
      logger,
    });

    expect(result).toBe(true);
    expect(setStatusCalls[0]?.status).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// setTypingStatus / clearTypingStatus convenience helpers
// ─────────────────────────────────────────────────────────────

describe('setTypingStatus', () => {
  it('sets "is typing..." status', async () => {
    const { client, setStatusCalls } = makeClientWithAssistant();
    const logger = makeLogger();

    const result = await setTypingStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      logger,
    });

    expect(result).toBe(true);
    expect(setStatusCalls[0]?.status).toBe('is typing...');
  });

  it('no-ops when no threadTs', async () => {
    const { client, setStatusCalls } = makeClientWithAssistant();
    const logger = makeLogger();

    const result = await setTypingStatus({
      client: client as never,
      channelId: 'C12345',
      logger,
    });

    expect(result).toBe(false);
    expect(setStatusCalls.length).toBe(0);
  });
});

describe('clearTypingStatus', () => {
  it('clears status with empty string', async () => {
    const { client, setStatusCalls } = makeClientWithAssistant();
    const logger = makeLogger();

    const result = await clearTypingStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      logger,
    });

    expect(result).toBe(true);
    expect(setStatusCalls[0]?.status).toBe('');
  });
});
