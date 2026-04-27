/**
 * Bridge `TeamsSendContext` → `BotFrameworkClient`.
 *
 * Senders only know about `TeamsSendContext.sendActivity`. The connection
 * layer owns:
 * - The AAD-authenticated Bot Framework REST client
 * - The conversation-scoped `serviceUrl` captured at inbound time (Bot
 *   Framework's "trust on first use" pattern)
 * - The conversation ID we are replying into
 *
 * `createBotFrameworkSendContext` welds those three together into a context
 * object the senders can use without leaking any transport details.
 */

import type { BotActivityPayload, BotFrameworkClient } from '../connection';
import type { TeamsOutboundActivity, TeamsResourceResponse, TeamsSendContext } from './types';

export interface BotFrameworkSendContextOptions {
  /** Per-instance Bot Framework REST client */
  client: BotFrameworkClient;
  /** Conversation-scoped service URL (captured from inbound activities) */
  serviceUrl: string;
  /** Teams conversation id we are sending into */
  conversationId: string;
}

/**
 * Create a `TeamsSendContext` backed by a real `BotFrameworkClient`.
 *
 * Routing:
 * - When `activity.replyToId` is present, the call goes through
 *   `replyToActivity` so Teams threads the new message under the target.
 *   `replyToActivity` re-attaches the `replyToId` itself; the adapter still
 *   passes it for symmetry with `sendActivity`.
 * - Otherwise the activity posts to the conversation root via `sendActivity`.
 */
export function createBotFrameworkSendContext(opts: BotFrameworkSendContextOptions): TeamsSendContext {
  const { client, serviceUrl, conversationId } = opts;

  return {
    async sendActivity(activity: TeamsOutboundActivity): Promise<TeamsResourceResponse> {
      const wirePayload: BotActivityPayload = toWirePayload(activity);

      const result = activity.replyToId
        ? await client.replyToActivity(serviceUrl, conversationId, activity.replyToId, wirePayload)
        : await client.sendActivity(serviceUrl, conversationId, wirePayload);

      return { id: result.activityId };
    },
  };
}

/**
 * Map the sender-layer activity onto the connection-layer wire shape.
 *
 * Both interfaces overlap heavily; the only intentional drop is the
 * `thumbnailUrl` field on attachments, which the v1 connection adapter does
 * not relay (Teams ignores it for non-card attachments).
 */
function toWirePayload(activity: TeamsOutboundActivity): BotActivityPayload {
  const payload: BotActivityPayload = {
    type: activity.type,
  };

  if (activity.text !== undefined) payload.text = activity.text;
  if (activity.textFormat !== undefined) payload.textFormat = activity.textFormat;
  if (activity.replyToId !== undefined) payload.replyToId = activity.replyToId;

  if (activity.attachments && activity.attachments.length > 0) {
    payload.attachments = activity.attachments.map((att) => ({
      contentType: att.contentType,
      contentUrl: att.contentUrl,
      name: att.name,
      content: att.content,
    }));
  }

  if (activity.reactionsAdded && activity.reactionsAdded.length > 0) {
    payload.reactionsAdded = activity.reactionsAdded.map((r) => ({ type: r.type }));
  }
  if (activity.reactionsRemoved && activity.reactionsRemoved.length > 0) {
    payload.reactionsRemoved = activity.reactionsRemoved.map((r) => ({ type: r.type }));
  }

  return payload;
}
