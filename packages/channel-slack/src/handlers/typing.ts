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
 * Both methods require a bot token, so an `authMode: 'user'` attachment skips
 * them entirely rather than attempting a call that can only ever come back
 * `not_allowed_token_type` (#889).
 *
 * Requires Slack Web API scope `chat:write`.
 * Failures are swallowed gracefully — status never blocks message processing.
 *
 * @see https://docs.slack.dev/reference/methods/agents.sessions.setStatus/
 * @see https://docs.slack.dev/ai/migrating-to-agent-messaging/
 */

import type { Logger } from '@omni/channel-sdk';
import type { WebClient } from '@slack/web-api';
import type { SlackAttachment } from '../connection/app-receiver';

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
 * Error codes after which retrying `agents.sessions.setStatus` with this
 * client can never succeed — the API isn't rolled out / enabled
 * (`unknown_method`, `feature_disabled`, `method_deprecated`), the app lacks
 * the grant (`missing_scope`), or the token is the wrong kind
 * (`not_allowed_token_type`: the method requires a granular bot token, which
 * an `authMode: 'user'` acting client is not). These memoize the client onto
 * the legacy path. Every OTHER error still falls through to the legacy API
 * for that call — it just doesn't write the client off.
 */
const AGENT_API_UNAVAILABLE_ERRORS = new Set([
  'unknown_method',
  'feature_disabled',
  'method_deprecated',
  'missing_scope',
  'not_allowed_token_type',
]);

/**
 * Callers where `agents.sessions.setStatus` has failed with an
 * availability error — skip straight to the legacy API for these.
 *
 * The memo is keyed on the caller's `attachment` when there is one and on the
 * WebClient object otherwise, and is never cleared by itself, so it sticks for
 * the lifetime of that object — i.e. until the instance detaches and a fresh
 * attachment (with fresh acting clients) is built. Under the shared receiver
 * several instances hand the same bot client around, so keying on the client
 * alone would let one workspace's missing scope mute another's; the attachment
 * is the narrower identity. A WeakSet lets the old entry be collected, and
 * {@link forgetStatusMemo} drops it eagerly on detach.
 *
 * Keying this way is safe because every memoized error is a property of the
 * app/token, not of the moment: an unknown method, a disabled feature, a
 * missing scope, or the wrong token type only change when the Slack app is
 * re-installed or re-authorized, which produces a new attachment anyway.
 * Re-probing per call would just cost a failing round-trip each time.
 */
const agentApiUnavailable = new WeakSet<object>();

/**
 * The object the availability memo is keyed on: the attachment when the caller
 * has one, the client otherwise (the shape the standalone helpers still take).
 */
function memoKeyFor(params: { client: WebClient; attachment?: SlackAttachment }): object {
  return params.attachment ?? params.client;
}

/**
 * Drop a detached attachment's memoized Agent-API availability.
 *
 * The plugin calls this when an instance detaches: the next attach gets a
 * clean probe rather than inheriting a verdict about a token it no longer uses.
 */
export function forgetStatusMemo(target: object): void {
  agentApiUnavailable.delete(target);
}

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
  /**
   * The attachment acting here, when the caller has one. Only narrows what the
   * Agent-API availability memo is keyed on; the call itself still goes through
   * `client`, so callers without an attachment behave exactly as before.
   */
  attachment?: SlackAttachment;
}): Promise<SlackStatusResult> {
  const { client, channelId, threadTs, status, loadingMessages, logger, instanceId } = params;

  // ── User-mode guard (#889) ──
  // Both status surfaces are bot-token-only: `agents.sessions.setStatus` and
  // the legacy `assistant.threads.setStatus` reject a user (`xoxp`) token with
  // `not_allowed_token_type`. In `authMode: 'user'` the acting client IS that
  // user token, so every reply used to burn two doomed round-trips and log an
  // info + a warn. There is nothing to attempt here — bail before any Slack
  // call, at debug, because this is expected in user mode rather than a fault.
  if (params.attachment?.authMode === 'user') {
    logger.debug('setSlackThreadStatus: skipped, thread status APIs require a bot token', {
      instanceId,
      channelId,
      reason: 'user_mode',
      clearing: status.length === 0,
    });
    return { delivered: false };
  }

  const memoKey = memoKeyFor(params);

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
  if (typeof client.apiCall === 'function' && !agentApiUnavailable.has(memoKey)) {
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
      // Any failure falls through to the legacy bridge below — a status that
      // worked before this migration must keep working (#914 review). Only
      // errors that can never succeed again memoize the client off this path.
      const code = slackErrorCode(err);
      if (code && AGENT_API_UNAVAILABLE_ERRORS.has(code)) {
        agentApiUnavailable.add(memoKey);
        logger.info('agents.sessions.setStatus unavailable, falling back to assistant.threads.setStatus', {
          instanceId,
          channelId,
          error: code,
        });
      } else {
        logger.warn('agents.sessions.setStatus failed, trying legacy fallback', {
          ...logContext,
          error: String(err),
        });
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
  attachment?: SlackAttachment;
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
  attachment?: SlackAttachment;
}): Promise<SlackStatusResult> {
  return setSlackThreadStatus({ ...params, status: CLEAR_STATUS });
}
