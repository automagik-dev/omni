/**
 * Tests for Slack thread status (agents.sessions.setStatus with
 * assistant.threads.setStatus fallback, #914)
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

/** Slack platform error as the WebClient throws it. */
function slackError(code: string): Error & { data: { error: string } } {
  return Object.assign(new Error(`An API error occurred: ${code}`), { data: { error: code } });
}

/** Client whose apiCall supports the Agent Sessions API. */
function makeAgentApiClient() {
  const apiCalls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const client = {
    apiCall: mock(async (method: string, args: Record<string, unknown>) => {
      apiCalls.push({ method, args });
    }),
  };
  return { client, apiCalls };
}

/** Client where agents.sessions.setStatus fails; other methods succeed. */
function makeAgentApiFailingClient(code: string) {
  const apiCalls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const client = {
    apiCall: mock(async (method: string, args: Record<string, unknown>) => {
      apiCalls.push({ method, args });
      if (method === 'agents.sessions.setStatus') throw slackError(code);
    }),
  };
  return { client, apiCalls };
}

/** Legacy client: typed assistant.threads.setStatus, no generic apiCall. */
function makeLegacyAssistantClient() {
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

function makeBareClient() {
  return { client: {} };
}

// ─────────────────────────────────────────────────────────────
// setSlackThreadStatus tests
// ─────────────────────────────────────────────────────────────

describe('setSlackThreadStatus', () => {
  it('no-ops when threadTs is absent, but logs the bail (#914)', async () => {
    const { client, apiCalls } = makeAgentApiClient();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: undefined,
      status: 'is typing...',
      logger,
    });

    expect(result.delivered).toBe(false);
    expect(apiCalls.length).toBe(0);

    const debugCalls = (logger.debug as ReturnType<typeof mock>).mock.calls;
    expect(debugCalls.length).toBeGreaterThan(0);
    expect(debugCalls[0]?.[1]).toMatchObject({ reason: 'no_thread_ts' });
  });

  it('prefers agents.sessions.setStatus, mapping a non-empty status to processing', async () => {
    const { client, apiCalls } = makeAgentApiClient();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      logger,
    });

    expect(result).toEqual({ delivered: true, method: 'agents.sessions.setStatus' });
    expect(apiCalls).toEqual([
      {
        method: 'agents.sessions.setStatus',
        args: { channel_id: 'C12345', thread_ts: '1234567890.001', status: 'processing' },
      },
    ]);
  });

  it('maps an empty status (clear) to session status active', async () => {
    const { client, apiCalls } = makeAgentApiClient();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: '',
      logger,
    });

    expect(result).toEqual({ delivered: true, method: 'agents.sessions.setStatus' });
    expect(apiCalls[0]?.args.status).toBe('active');
  });

  it('falls back to assistant.threads.setStatus when the Agent Sessions API is unavailable', async () => {
    const { client, apiCalls } = makeAgentApiFailingClient('unknown_method');
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      loadingMessages: ['Checking context...'],
      logger,
    });

    expect(result).toEqual({ delivered: true, method: 'assistant.threads.setStatus' });
    expect(apiCalls.length).toBe(2);
    expect(apiCalls[1]).toEqual({
      method: 'assistant.threads.setStatus',
      args: {
        channel_id: 'C12345',
        thread_ts: '1234567890.001',
        status: 'is typing...',
        loading_messages: ['Checking context...'],
      },
    });

    // The unavailability is memoized per client: the next call skips the
    // Agent Sessions attempt entirely.
    const second = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      logger,
    });
    expect(second.method).toBe('assistant.threads.setStatus');
    expect(apiCalls.length).toBe(3);
    expect(apiCalls[2]?.method).toBe('assistant.threads.setStatus');
  });

  it('does not fall back on transient agents.sessions.setStatus errors', async () => {
    const { client, apiCalls } = makeAgentApiFailingClient('channel_not_found');
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      logger,
    });

    expect(result).toEqual({ delivered: false, method: 'agents.sessions.setStatus' });
    expect(apiCalls.length).toBe(1);

    // Failure is logged without leaking the raw status string
    const warnCalls = (logger.warn as ReturnType<typeof mock>).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
    expect(warnCalls[0]?.[1]).toMatchObject({ clearing: false, statusLength: 'is typing...'.length });
    expect(warnCalls[0]?.[1]).not.toHaveProperty('status');
  });

  it('uses typed assistant.threads.setStatus when there is no generic apiCall', async () => {
    const { client, setStatusCalls } = makeLegacyAssistantClient();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      loadingMessages: ['Checking context...', 'Calling tools...'],
      logger,
    });

    expect(result).toEqual({ delivered: true, method: 'assistant.threads.setStatus' });
    expect(setStatusCalls[0]).toEqual({
      channel_id: 'C12345',
      thread_ts: '1234567890.001',
      status: 'is typing...',
      loading_messages: ['Checking context...', 'Calling tools...'],
    });
  });

  it('does not throw when neither method is available', async () => {
    const { client } = makeBareClient();
    const logger = makeLogger();

    const result = await setSlackThreadStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      status: 'is typing...',
      logger,
    });

    expect(result.delivered).toBe(false);
  });

  it('does not throw when the legacy API call fails, and keeps the status out of logs', async () => {
    const { client } = makeLegacyAssistantClient();
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

    expect(result.delivered).toBe(false);

    const warnCalls = (logger.warn as ReturnType<typeof mock>).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
    expect(warnCalls[0]?.[1]).toMatchObject({ clearing: false, statusLength: 'is typing...'.length });
    expect(warnCalls[0]?.[1]).not.toHaveProperty('status');
  });
});

// ─────────────────────────────────────────────────────────────
// setTypingStatus / clearTypingStatus convenience helpers
// ─────────────────────────────────────────────────────────────

describe('setTypingStatus', () => {
  it('sets processing status', async () => {
    const { client, apiCalls } = makeAgentApiClient();
    const logger = makeLogger();

    const result = await setTypingStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      logger,
    });

    expect(result.delivered).toBe(true);
    expect(apiCalls[0]?.args.status).toBe('processing');
  });

  it('no-ops when no threadTs', async () => {
    const { client, apiCalls } = makeAgentApiClient();
    const logger = makeLogger();

    const result = await setTypingStatus({
      client: client as never,
      channelId: 'C12345',
      logger,
    });

    expect(result.delivered).toBe(false);
    expect(apiCalls.length).toBe(0);
  });
});

describe('clearTypingStatus', () => {
  it('clears status back to active', async () => {
    const { client, apiCalls } = makeAgentApiClient();
    const logger = makeLogger();

    const result = await clearTypingStatus({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      logger,
    });

    expect(result.delivered).toBe(true);
    expect(apiCalls[0]?.args.status).toBe('active');
  });
});
