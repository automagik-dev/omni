/**
 * Agent session event handlers for Slack (Agent messaging experience, #914)
 *
 * Handles `agent_session_stopped` — fired when a user presses Slack's native
 * stop button while a session is in `processing`. Slack only shows that button
 * when the app subscribes to this event, and expects the app to stop its
 * in-progress work and transition the session out of `processing`.
 *
 * @see https://docs.slack.dev/reference/events/agent_session_stopped/
 */

import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';

export interface AgentSessionStoppedArgs {
  /** Channel the session lives in */
  channelId: string;
  /** Thread timestamp of the stopped session, when threaded */
  threadTs?: string;
  /** User who pressed stop */
  userId?: string;
  /** Timestamps of streaming messages Slack halted (empty if none) */
  streamingMessageTs: string[];
  /** Slack timestamp of the stop press ("seconds.micro"), for run-scoping */
  eventTs?: string;
}

export interface AgentSessionHandlerCallbacks {
  onSessionStopped: (instanceId: string, args: AgentSessionStoppedArgs) => Promise<void>;
}

/** Bolt's typed `event()` doesn't know `agent_session_stopped` yet (Bolt 4.x). */
type UntypedEventRegistrar = (eventName: string, listener: (args: { event: unknown }) => Promise<void>) => void;

/**
 * Set up agent session handlers on a Bolt.js app
 */
export function setupAgentSessionHandlers(
  app: App,
  instanceId: string,
  callbacks: AgentSessionHandlerCallbacks,
  logger: Logger,
): void {
  (app.event as unknown as UntypedEventRegistrar)('agent_session_stopped', async ({ event }) => {
    const evt = event as Record<string, unknown>;
    const channelId = evt.channel as string | undefined;
    if (!channelId) return;

    const threadTs = evt.thread_ts as string | undefined;
    const userId = evt.user as string | undefined;
    const eventTs = evt.event_ts as string | undefined;
    const streamingMessageTs = Array.isArray(evt.streaming_message_ts) ? (evt.streaming_message_ts as string[]) : [];

    logger.info('Agent session stopped by user', { instanceId, channelId, threadTs, userId, streamingMessageTs });

    await callbacks.onSessionStopped(instanceId, { channelId, threadTs, userId, streamingMessageTs, eventTs });
  });

  logger.info('Agent session handlers registered', { instanceId });
}
