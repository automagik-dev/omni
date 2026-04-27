/**
 * Sender-layer transport contract for the Microsoft Teams plugin.
 *
 * Senders are pure functions that build Bot Framework activity payloads and
 * hand them to a `TeamsSendContext`. The plugin (Group 3 connection layer)
 * implements `TeamsSendContext` on top of `BotFrameworkClient` so the
 * outbound path stays decoupled from the underlying transport.
 *
 * Why a thin local payload type instead of the connection-layer
 * `BotActivityPayload`:
 * - Senders compile and unit-test against a tiny in-memory fake context
 *   without having to mock the AAD token cache or the Bot Framework wire.
 * - The connection layer maps `TeamsOutboundActivity` →
 *   `BotActivityPayload` at one well-defined boundary (`createBotFrameworkSendContext`).
 * - Future adapters (CloudAdapter, in-memory test fakes) share the same
 *   shape.
 *
 * Edit / delete activity flows are intentionally absent — Teams capabilities
 * declare `canStreamResponse: false` so v1 has no use for them. They land in
 * a follow-up wish if/when streaming arrives.
 */

/**
 * Single attachment on an outbound activity.
 *
 * Mirrors the Bot Framework `Attachment` shape. For media we set
 * `contentType` + `contentUrl`; adaptive cards use `content`.
 */
export interface TeamsOutboundAttachment {
  /** MIME type or Bot Framework attachment content type */
  contentType: string;
  /** Display name (filename for documents) */
  name?: string;
  /** URL Teams can fetch (image / audio / video / document) — may be a `data:` URL */
  contentUrl?: string;
  /** Inline content payload (used for adaptive cards or hero cards) */
  content?: unknown;
  /** Optional thumbnail URL — currently unused by the connection adapter */
  thumbnailUrl?: string;
}

/**
 * Reaction descriptor for `messageReaction` activities.
 *
 * Teams accepts a fixed set of reaction types when bots add them via the
 * `messageReaction` activity:
 *   `like` | `heart` | `laugh` | `surprised` | `sad` | `angry`.
 * Unknown emoji map to the closest available Teams reaction (see
 * `senders/reaction.ts`).
 */
export interface TeamsReactionDescriptor {
  type: TeamsReactionType;
}

export type TeamsReactionType = 'like' | 'heart' | 'laugh' | 'surprised' | 'sad' | 'angry';

/**
 * Outbound activity types we emit.
 *
 * - `message`: regular text / attachment payload
 * - `typing`: ephemeral typing indicator (no persistent ID)
 * - `messageReaction`: add or remove a reaction on a target activity
 */
export type TeamsOutboundActivityType = 'message' | 'typing' | 'messageReaction';

/**
 * Outbound activity payload — minimal subset of Bot Framework's `Activity`
 * shape that the senders construct. The connection adapter maps this onto
 * `BotActivityPayload` before handing it to `BotFrameworkClient`.
 */
export interface TeamsOutboundActivity {
  /** Activity type (Bot Framework `type` field) */
  type: TeamsOutboundActivityType;

  /** Plain or markdown text body (for `message` activities) */
  text?: string;

  /** How Teams should render `text` — defaults to `markdown` for messages */
  textFormat?: 'plain' | 'markdown' | 'xml';

  /** Attachments (one or more) for `message` activities */
  attachments?: TeamsOutboundAttachment[];

  /**
   * Bot Framework `replyToId` — when set, the connection adapter routes the
   * activity through `BotFrameworkClient.replyToActivity` so Teams threads it
   * underneath the target inside a channel conversation.
   */
  replyToId?: string;

  /** Reactions added (for `messageReaction` activities) */
  reactionsAdded?: TeamsReactionDescriptor[];

  /** Reactions removed (for `messageReaction` activities) */
  reactionsRemoved?: TeamsReactionDescriptor[];

  /**
   * Bot Framework attachment layout hint. Teams ignores this for most
   * scenarios but it improves rendering on legacy clients.
   */
  attachmentLayout?: 'list' | 'carousel';
}

/**
 * Resource response returned by Bot Framework on send.
 *
 * The `id` field is the platform-assigned activity ID — what Omni stores as
 * the `messageId` on outbound state and what `replyToId` references later.
 */
export interface TeamsResourceResponse {
  id: string;
}

/**
 * Transport contract a sender invokes to push an activity to Teams.
 *
 * Implementations:
 * - **Production adapter** (`createBotFrameworkSendContext`): wraps
 *   `BotFrameworkClient.sendActivity` / `replyToActivity` so each call
 *   resolves to the correct connector REST endpoint with a cached AAD token.
 * - **Test fakes**: capture the activity for assertion (see
 *   `__tests__/senders.test.ts`).
 *
 * Senders must NOT assume any side effect beyond the call — connector-level
 * rate-limit retries are handled by the underlying client.
 */
export interface TeamsSendContext {
  /**
   * Send an activity. Returns the resource response with the assigned ID.
   *
   * For `typing` activities the assigned ID is informational and may be an
   * empty string when the connector replies with no body.
   */
  sendActivity(activity: TeamsOutboundActivity): Promise<TeamsResourceResponse>;
}
