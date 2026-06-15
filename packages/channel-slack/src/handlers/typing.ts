/**
 * Slack thread typing indicator helper
 *
 * Uses assistant.threads.setStatus to show/clear typing status in Slack threads.
 * Requires a Slack thread timestamp; for top-level channel messages, use the
 * source message timestamp as the thread timestamp.
 *
 * Requires Slack Web API scope `chat:write`. The legacy `assistant:write` scope
 * is also accepted by Slack during their transition period.
 * Failures are swallowed gracefully — typing never blocks message processing.
 *
 * @see https://docs.slack.dev/reference/methods/assistant.threads.setStatus/
 */

import type { Logger } from '@omni/channel-sdk';
import type { WebClient } from '@slack/web-api';

const TYPING_STATUS = 'is typing...';
const CLEAR_STATUS = '';

/**
 * Set or clear the Slack thread typing status.
 *
 * No-op when `threadTs` is absent (channel-level messages have no typing API).
 */
export async function setSlackThreadStatus(params: {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  status: string;
  loadingMessages?: string[];
  logger: Logger;
  instanceId?: string;
}): Promise<boolean> {
  const { client, channelId, threadTs, status, loadingMessages, logger, instanceId } = params;

  // Thread-only guard
  if (!threadTs) return false;

  const payload = {
    channel_id: channelId,
    thread_ts: threadTs,
    status,
    ...(loadingMessages?.length ? { loading_messages: loadingMessages } : {}),
  };

  try {
    const clientAny = client as unknown as {
      assistant?: {
        threads?: {
          setStatus?: (args: typeof payload) => Promise<unknown>;
        };
      };
      apiCall?: (method: string, args: typeof payload) => Promise<unknown>;
    };

    if (typeof clientAny.assistant?.threads?.setStatus === 'function') {
      await clientAny.assistant.threads.setStatus(payload);
      return true;
    }

    if (typeof clientAny.apiCall === 'function') {
      await clientAny.apiCall('assistant.threads.setStatus', payload);
      return true;
    }
  } catch (err) {
    logger.warn('setSlackThreadStatus: failed', {
      instanceId,
      channelId,
      threadTs,
      clearing: status.length === 0,
      statusLength: status.length,
      loadingMessageCount: loadingMessages?.length ?? 0,
      error: String(err),
    });
  }

  return false;
}

/**
 * Set "is typing..." status on a Slack thread.
 */
export async function setTypingStatus(params: {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  logger: Logger;
  instanceId?: string;
}): Promise<boolean> {
  return setSlackThreadStatus({ ...params, status: TYPING_STATUS });
}

/**
 * Clear the typing status on a Slack thread.
 */
export async function clearTypingStatus(params: {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  logger: Logger;
  instanceId?: string;
}): Promise<boolean> {
  return setSlackThreadStatus({ ...params, status: CLEAR_STATUS });
}
