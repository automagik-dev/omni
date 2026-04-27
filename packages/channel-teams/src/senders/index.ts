/**
 * Microsoft Teams outbound senders.
 *
 * Each sender takes a `TeamsSendContext` (built per-call by the plugin from
 * a `BotFrameworkClient` + conversation-scoped `serviceUrl`) and a typed
 * options bag. Senders return the activity ID Teams assigns so the plugin
 * can populate `SendResult.messageId` and downstream events.
 *
 * Capability matrix support (see `capabilities.ts`):
 * - `canSendText`     → `sendTextMessage`
 * - `canSendMedia`    → `sendMediaMessage` (+ `sendMediaFromUrl`, `sendMediaFromBuffer`)
 * - `canSendTyping`   → `sendTyping`
 *
 * `sendReaction` is exported but `canSendReaction` is `false` for Teams: the
 * Bot Framework Connector accepts the activity, but the Teams client does not
 * render bot-authored reactions (Microsoft Graph would be required, out of v1).
 * The sender stays exported for non-Teams Bot Framework channels (Direct Line
 * etc.) — the dispatcher MUST NOT route reaction sends through it for Teams.
 */

export { sendTextMessage } from './text';
export type { TeamsTextFormatMode, TeamsTextSendOptions } from './text';

export { sendMediaMessage, sendMediaFromBuffer, sendMediaFromUrl } from './media';
export type { TeamsMediaKind, TeamsMediaSendOptions } from './media';

export { sendReaction, mapEmojiToTeamsReaction } from './reaction';
export type { TeamsReactionSendOptions } from './reaction';

export { sendTyping } from './typing';
export type { TeamsTypingSendOptions } from './typing';

export { createBotFrameworkSendContext } from './context';
export type { BotFrameworkSendContextOptions } from './context';

export type {
  TeamsOutboundActivity,
  TeamsOutboundActivityType,
  TeamsOutboundAttachment,
  TeamsReactionDescriptor,
  TeamsReactionType,
  TeamsResourceResponse,
  TeamsSendContext,
} from './types';
