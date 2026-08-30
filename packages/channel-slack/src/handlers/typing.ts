/**
 * Slack thread status helper — Agent Sessions API with legacy fallback
 *
 * Prefers `agents.sessions.setStatus` (the Agent messaging experience, #914):
 * a non-empty status maps to session status `processing`, an empty status to
 * `active`, per Slack's migration guide. Workspaces/apps where the Agent
 * Sessions API is unavailable fall back to the deprecated
 * `assistant.threads.setStatus` (works through Slack's compatibility bridge
 * until `assistant_view` is retired in February 2027).
 *
 * Requires a Slack thread timestamp; for top-level channel messages, use the
 * source message timestamp as the thread timestamp.
 *
 * Requires Slack Web API scope `chat:write`.
 * Failures are swallowed gracefully — status never blocks message processing.
 *
 * @see https://docs.slack.dev/reference/methods/agents.sessions.setStatus/
 * @see https://docs.slack.dev/ai/migrating-to-agent-messaging/
 */

import type { Logger } from '@omni/channel-sdk';
import type { WebClient } from '@slack/web-api';

const TYPING_STATUS = 'is typing...';
const CLEAR_STATUS = '';

/** Which Slack API actually handled a status call. */
export type SlackStatusMethod = 'agents.sessions.setStatus' | 'assistant.threads.setStatus';

export interface SlackStatusResult {
  delivered: boolean;
  /** Set when a Slack API call was attempted; absent on the no-thread bail. */
  method?: SlackStatusMethod;
}

/**
 * Error codes that mean the Agent Sessions API is not available for this
 * app/workspace (not yet rolled out, feature disabled, or method unknown to
 * the workspace). Any of these flips the client to the legacy fallback.
 */
const AGENT_API_UNAVAILABLE_ERRORS = new Set(['unknown_method', 'feature_disabled', 'method_deprecated']);

/**
 * Clients where `agents.sessions.setStatus` has failed with an
 * availability error — skip straight to the legacy API for these.
 */
const agentApiUnavailable = new WeakSet<object>();

/** Extract the Slack platform error code (e.g. 'unknown_method') if present. */
function slackErrorCode(err: unknown): string | undefined {
  return (err as { data?: { error?: string } } | undefined)?.data?.error;
}

type LegacyStatusClient = {
  assistant?: {
    threads?: {
      setStatus?: (args: Record<string, unknown>) => Promise<unknown>;
    };
  };
  apiCall?: (method: string, args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Set or clear the Slack thread status.
 *
 * No-op when `threadTs` is absent (Slack sessions/status are thread-scoped;
 * there is no status surface for bare channel-level messages).
 */
export async function setSlackThreadStatus(params: {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  status: string;
  loadingMessages?: string[];
  logger: Logger;
  instanceId?: string;
}): Promise<SlackStatusResult> {
  const { client, channelId, threadTs, status, loadingMessages, logger, instanceId } = params;

  // Thread-only guard — logged so a silent no-status situation is diagnosable (#914)
  if (!threadTs) {
    logger.debug('setSlackThreadStatus: skipped, no thread timestamp', {
      instanceId,
      channelId,
      reason: 'no_thread_ts',
      clearing: status.length === 0,
    });
    return { delivered: false };
  }

  const clearing = status.length === 0;
  const logContext = {
    instanceId,
    channelId,
    threadTs,
    clearing,
    statusLength: status.length,
    loadingMessageCount: loadingMessages?.length ?? 0,
  };

  // ── Agent Sessions API (preferred) ──
  if (typeof client.apiCall === 'function' && !agentApiUnavailable.has(client)) {
    try {
      await client.apiCall('agents.sessions.setStatus', {
        channel_id: channelId,
        thread_ts: threadTs,
        // The new API takes a lifecycle enum, not a freeform string:
        // non-empty legacy status → 'processing', clear → 'active'.
        status: clearing ? 'active' : 'processing',
      });
      return { delivered: true, method: 'agents.sessions.setStatus' };
    } catch (err) {
      const code = slackErrorCode(err);
      if (code && AGENT_API_UNAVAILABLE_ERRORS.has(code)) {
        agentApiUnavailable.add(client);
        logger.info('agents.sessions.setStatus unavailable, falling back to assistant.threads.setStatus', {
          instanceId,
          channelId,
          error: code,
        });
      } else {
        logger.warn('agents.sessions.setStatus failed', { ...logContext, error: String(err) });
        return { delivered: false, method: 'agents.sessions.setStatus' };
      }
    }
  }

  // ── Legacy fallback (assistant_view compatibility bridge, gone Feb 2027) ──
  const payload = {
    channel_id: channelId,
    thread_ts: threadTs,
    status,
    ...(loadingMessages?.length ? { loading_messages: loadingMessages } : {}),
  };

  try {
    const legacyClient = client as unknown as LegacyStatusClient;

    if (typeof legacyClient.assistant?.threads?.setStatus === 'function') {
      await legacyClient.assistant.threads.setStatus(payload);
      return { delivered: true, method: 'assistant.threads.setStatus' };
    }

    if (typeof legacyClient.apiCall === 'function') {
      await legacyClient.apiCall('assistant.threads.setStatus', payload);
      return { delivered: true, method: 'assistant.threads.setStatus' };
    }
  } catch (err) {
    logger.warn('setSlackThreadStatus: failed', { ...logContext, error: String(err) });
  }

  return { delivered: false, method: 'assistant.threads.setStatus' };
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
}): Promise<SlackStatusResult> {
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
}): Promise<SlackStatusResult> {
  return setSlackThreadStatus({ ...params, status: CLEAR_STATUS });
}
