/**
 * Conversation classification helpers.
 *
 * Teams reports conversation type via two fields:
 *   - `Activity.conversation.conversationType` — 'personal' | 'channel' | 'groupChat'
 *   - `Activity.channelData.team`              — present only for team channels
 *
 * Channel-vs-DM routing in Omni follows the same rules as Slack: 'personal'
 * is a 1:1 chat (DM); 'channel' is a team channel; 'groupChat' is an ad-hoc
 * Teams group chat (treated as a group, not a DM).
 *
 * Thread detection: in Teams, a reply inside a channel sets `replyToId` on
 * the activity to the root activity id. We surface that as `isThreadReply`
 * + the parent activity id; senders use it to keep replies inside the
 * original thread.
 */

import type { TeamsActivityMeta } from '../types';
import type { InboundActivity, TeamsChannelData } from './activity-types';

export function classifyConversation(activity: InboundActivity): {
  isDm: boolean;
  conversationType: 'personal' | 'channel' | 'groupChat' | undefined;
} {
  const raw = activity.conversation?.conversationType;
  const conversationType = raw === 'personal' || raw === 'channel' || raw === 'groupChat' ? raw : undefined;
  const isDm = conversationType === 'personal';
  return { isDm, conversationType };
}

function extractTeamsChannelData(activity: InboundActivity): TeamsChannelData | undefined {
  return activity.channelData;
}

/**
 * Build the slim `TeamsActivityMeta` struct from a raw inbound activity.
 *
 * Throws if the activity is missing required fields (id, conversation.id,
 * serviceUrl, from.id) — those are non-optional per Bot Framework spec, so
 * a missing field signals a malformed payload.
 */
export function toActivityMeta(activity: InboundActivity): TeamsActivityMeta {
  if (!activity.id) {
    throw new Error('activity.id is required');
  }
  if (!activity.conversation?.id) {
    throw new Error('activity.conversation.id is required');
  }
  if (!activity.serviceUrl) {
    throw new Error('activity.serviceUrl is required');
  }
  if (!activity.from?.id) {
    throw new Error('activity.from.id is required');
  }

  const { isDm, conversationType } = classifyConversation(activity);
  const channelData = extractTeamsChannelData(activity);

  return {
    activityId: activity.id,
    conversationId: activity.conversation.id,
    replyToId: activity.replyToId,
    userId: activity.from.aadObjectId ?? activity.from.id,
    userName: activity.from.name,
    tenantId: channelData?.tenant?.id ?? activity.conversation.tenantId,
    serviceUrl: activity.serviceUrl,
    conversationType,
    isDm,
    isThreadReply: typeof activity.replyToId === 'string' && activity.replyToId.length > 0,
    teamId: channelData?.team?.id,
    channelId: channelData?.channel?.id,
  };
}

/**
 * Build the chat id used by Omni event payloads.
 *
 * For DMs we use the conversation id directly. For channels we prefer the
 * Teams channel id (stable across renames) when present; for group chats
 * the conversation id is the only stable handle.
 */
export function deriveChatId(meta: TeamsActivityMeta): string {
  if (meta.conversationType === 'channel' && meta.channelId) {
    return meta.channelId;
  }
  return meta.conversationId;
}
