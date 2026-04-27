/**
 * Inbound Bot Framework `Activity` envelope — minimal type-only mirror of
 * the fields we care about. The Bot Framework SDK ships a richer type but
 * we want this package to compile without the SDK installed.
 *
 * Spec: https://github.com/microsoft/botframework-sdk/blob/main/specs/botframework-activity/botframework-activity.md
 */

export interface InboundActivity {
  /** 'message' | 'messageReaction' | 'typing' | 'event' | 'invoke' | ... */
  type: string;
  /** Service-assigned activity id (unique per activity within a conversation) */
  id?: string;
  /** ISO 8601 timestamp from the platform */
  timestamp?: string;
  /** Service URL we must reply through */
  serviceUrl: string;
  /** Constant for Teams: 'msteams' (matches the Bot Framework channel id) */
  channelId?: string;
  /** Sender info */
  from?: {
    /** Bot Framework user id (often `29:abc...`) */
    id: string;
    /** Display name */
    name?: string;
    /** Microsoft Entra (AAD) object id when available — preferred stable identifier */
    aadObjectId?: string;
  };
  conversation?: {
    id: string;
    /** 'personal' | 'channel' | 'groupChat' */
    conversationType?: string;
    /** Tenant id when known (Teams populates this on every activity) */
    tenantId?: string;
    /** Conversation name (channel name in Teams) */
    name?: string;
    isGroup?: boolean;
  };
  recipient?: {
    id: string;
    name?: string;
  };
  /** Plain-text body (markdown supported when textFormat === 'markdown') */
  text?: string;
  textFormat?: string;
  /** Locale (e.g. 'en-US') */
  locale?: string;
  /** Attachments — files, cards, images. */
  attachments?: Array<{
    contentType: string;
    contentUrl?: string;
    name?: string;
    content?: unknown;
    thumbnailUrl?: string;
  }>;
  /** Activity entities (mention, clientInfo, etc.) */
  entities?: Array<Record<string, unknown>>;
  /** Reactions added (messageReaction activities) */
  reactionsAdded?: Array<{ type: string; user?: { id: string } }>;
  reactionsRemoved?: Array<{ type: string; user?: { id: string } }>;
  /** Activity id this one is replying to (set for thread replies in channels) */
  replyToId?: string;
  /** Channel-level data, including Teams-specific fields */
  channelData?: TeamsChannelData;
}

/**
 * Teams-specific `channelData` payload — surfaces the team / channel /
 * tenant context that's not present at the top level of the activity.
 */
export interface TeamsChannelData {
  team?: { id: string; name?: string };
  channel?: { id: string; name?: string };
  tenant?: { id: string };
  eventType?: string;
  /** Set when the user replies to a specific thread root. The id is the
   *  starting activity id of the thread (Teams calls this "reply chain"). */
  meta?: { rootMessageId?: string };
}

/**
 * Bot Framework `Mention` entity — pulled from `Activity.entities` where
 * `type === 'mention'`.
 */
export interface MentionEntity {
  type: 'mention';
  /** The XML-encoded mention text as it appears in the message body
   *  (e.g. `<at>Bot</at>`). */
  text?: string;
  mentioned: {
    id: string;
    name?: string;
    aadObjectId?: string;
  };
}
