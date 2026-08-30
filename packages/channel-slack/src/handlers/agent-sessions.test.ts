/**
 * Tests for the agent_session_stopped handler (#914)
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';
import { type AgentSessionStoppedArgs, setupAgentSessionHandlers } from './agent-sessions';

function makeLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
  } as unknown as Logger;
}

/** Minimal Bolt app double that records event registrations. */
function makeApp() {
  const listeners = new Map<string, (args: { event: unknown }) => Promise<void>>();
  const app = {
    event: mock((name: string, listener: (args: { event: unknown }) => Promise<void>) => {
      listeners.set(name, listener);
    }),
  };
  return { app: app as unknown as App, listeners };
}

describe('setupAgentSessionHandlers', () => {
  it('registers a listener for agent_session_stopped', () => {
    const { app, listeners } = makeApp();
    setupAgentSessionHandlers(app, 'inst-1', { onSessionStopped: mock(async () => {}) }, makeLogger());

    expect(listeners.has('agent_session_stopped')).toBe(true);
  });

  it('maps the Slack payload into the callback args', async () => {
    const { app, listeners } = makeApp();
    const stops: Array<{ instanceId: string; args: AgentSessionStoppedArgs }> = [];
    setupAgentSessionHandlers(
      app,
      'inst-1',
      {
        onSessionStopped: async (instanceId, args) => {
          stops.push({ instanceId, args });
        },
      },
      makeLogger(),
    );

    await listeners.get('agent_session_stopped')?.({
      event: {
        type: 'agent_session_stopped',
        channel: 'C0123ABC456',
        thread_ts: '1782234671.392669',
        user: 'U123ABC456',
        streaming_message_ts: ['1782234987.693923'],
        event_ts: '1783536983.783769',
      },
    });

    expect(stops).toEqual([
      {
        instanceId: 'inst-1',
        args: {
          channelId: 'C0123ABC456',
          threadTs: '1782234671.392669',
          userId: 'U123ABC456',
          streamingMessageTs: ['1782234987.693923'],
        },
      },
    ]);
  });

  it('ignores events without a channel', async () => {
    const { app, listeners } = makeApp();
    const onSessionStopped = mock(async () => {});
    setupAgentSessionHandlers(app, 'inst-1', { onSessionStopped }, makeLogger());

    await listeners.get('agent_session_stopped')?.({ event: { type: 'agent_session_stopped' } });

    expect(onSessionStopped).not.toHaveBeenCalled();
  });

  it('tolerates a missing streaming_message_ts array', async () => {
    const { app, listeners } = makeApp();
    const stops: AgentSessionStoppedArgs[] = [];
    setupAgentSessionHandlers(
      app,
      'inst-1',
      {
        onSessionStopped: async (_instanceId, args) => {
          stops.push(args);
        },
      },
      makeLogger(),
    );

    await listeners.get('agent_session_stopped')?.({
      event: { type: 'agent_session_stopped', channel: 'C0123ABC456', user: 'U123ABC456' },
    });

    expect(stops[0]?.streamingMessageTs).toEqual([]);
    expect(stops[0]?.threadTs).toBeUndefined();
  });
});
