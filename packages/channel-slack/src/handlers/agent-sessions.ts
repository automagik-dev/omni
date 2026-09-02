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
import { z } from 'zod';

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
 * External boundary: the `agent_session_stopped` payload as Slack sends it.
 * `channel` is the only field the handler cannot do without; everything else
 * is optional per Slack's reference. Unknown fields pass through untouched.
 */
const AgentSessionStoppedEventSchema = z
  .object({
    channel: z.string().min(1),
    thread_ts: z.string().optional(),
    user: z.string().optional(),
    event_ts: z.string().optional(),
    streaming_message_ts: z.array(z.string()).optional(),
  })
  .passthrough();

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
    // A stop with no channel cannot be routed to any run — bail quietly, as
    // before the schema existed. Any other malformed payload is worth a warn.
    const channelHint = (event as { channel?: unknown } | null | undefined)?.channel;
    if (typeof channelHint !== 'string' || channelHint.length === 0) return;

    const parsed = AgentSessionStoppedEventSchema.safeParse(event);
    if (!parsed.success) {
      logger.warn('Ignoring malformed agent_session_stopped event', {
        instanceId,
        channelId: channelHint,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
      return;
    }

    const channelId = parsed.data.channel;
    const threadTs = parsed.data.thread_ts;
    const userId = parsed.data.user;
    const eventTs = parsed.data.event_ts;
    const streamingMessageTs = parsed.data.streaming_message_ts ?? [];

    logger.info('Agent session stopped by user', { instanceId, channelId, threadTs, userId, streamingMessageTs });

    await callbacks.onSessionStopped(instanceId, { channelId, threadTs, userId, streamingMessageTs, eventTs });
  });

  logger.info('Agent session handlers registered', { instanceId });
}
