/**
 * Slack thread typing indicator helper
 *
 * Uses assistant.threads.setStatus to show/clear typing status in Slack threads.
 * Only works for thread messages — channel-level messages are a no-op.
 *
 * Requires the "Agents & AI Apps" feature flag on the Slack App.
 * Failures are swallowed gracefully — typing never blocks message processing.
 *
 * @see https://api.slack.com/methods/assistant.threads.setStatus
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
  logger: Logger;
}): Promise<void> {
  const { client, channelId, threadTs, status, logger } = params;

  // Thread-only guard
  if (!threadTs) return;

  const payload = {
    channel_id: channelId,
    thread_ts: threadTs,
    status,
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
      return;
    }

    if (typeof clientAny.apiCall === 'function') {
      await clientAny.apiCall('assistant.threads.setStatus', payload);
    }
  } catch (err) {
    logger.warn('setSlackThreadStatus: failed', {
      channelId,
      threadTs,
      status,
      error: String(err),
    });
  }
}

/**
 * Set "is typing..." status on a Slack thread.
 */
export async function setTypingStatus(params: {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  logger: Logger;
}): Promise<void> {
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
}): Promise<void> {
  return setSlackThreadStatus({ ...params, status: CLEAR_STATUS });
}
